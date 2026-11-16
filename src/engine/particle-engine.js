import { createParticleData } from './particle-data.js';
import { PRESETS } from '../lib/settings.js';
import {
  FADE_FRAGMENT_SHADER,
  FULLSCREEN_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
  SIMULATION_FRAGMENT_SHADER,
} from './shaders.js';

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource, uniformNames) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Shader linking failed: ${log}`);
  }

  const uniforms = Object.fromEntries(
    uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]),
  );
  return { program, uniforms };
}

function colorVector(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

export class ParticleEngine {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = { ...settings, colors: [...settings.colors] };
    this.mode = PRESETS[settings.preset].mode;
    this.background = PRESETS[settings.preset].background;
    this.pointer = { x: 0, y: 0, strength: 0, polarity: 1 };
    this.needsClear = true;
    this.frames = 0;
    this.readIndex = 0;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('Aetherfield requires a browser with WebGL2 enabled.');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('This device does not support the floating-point buffers used by the simulation.');
    }
    this.gl = gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.simulationProgram = createProgram(
      gl,
      FULLSCREEN_VERTEX_SHADER,
      SIMULATION_FRAGMENT_SHADER,
      ['u_positions', 'u_velocities', 'u_delta', 'u_time', 'u_aspect', 'u_flow', 'u_speed',
        'u_turbulence', 'u_pointerStrength', 'u_pointerPolarity', 'u_mode', 'u_pointer'],
    );
    this.particleProgram = createProgram(
      gl,
      PARTICLE_VERTEX_SHADER,
      PARTICLE_FRAGMENT_SHADER,
      ['u_positions', 'u_velocities', 'u_textureSize', 'u_pointSize', 'u_pixelRatio',
        'u_colorA', 'u_colorB', 'u_colorC'],
    );
    this.fadeProgram = createProgram(
      gl,
      FULLSCREEN_VERTEX_SHADER,
      FADE_FRAGMENT_SHADER,
      ['u_background', 'u_opacity'],
    );

    gl.useProgram(this.simulationProgram.program);
    gl.uniform1i(this.simulationProgram.uniforms.u_positions, 0);
    gl.uniform1i(this.simulationProgram.uniforms.u_velocities, 1);
    gl.useProgram(this.particleProgram.program);
    gl.uniform1i(this.particleProgram.uniforms.u_positions, 0);
    gl.uniform1i(this.particleProgram.uniforms.u_velocities, 1);

    this.initialize();
  }

  createTexture(size, data) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, data);
    return texture;
  }

  createTarget(size, data) {
    const gl = this.gl;
    const positions = this.createTexture(size, data?.positions ?? null);
    const velocities = this.createTexture(size, data?.velocities ?? null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, positions, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velocities, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('The GPU could not create a complete particle render target.');
    }
    return { positions, velocities, framebuffer };
  }

  initialize() {
    const data = createParticleData(this.settings.count, this.settings.seed);
    const nextTargets = [
      this.createTarget(data.size, data),
      this.createTarget(data.size, null),
    ];

    if (this.targets) {
      for (const target of this.targets) {
        this.gl.deleteTexture(target.positions);
        this.gl.deleteTexture(target.velocities);
        this.gl.deleteFramebuffer(target.framebuffer);
      }
    }

    this.targets = nextTargets;
    this.textureSize = data.size;
    this.readIndex = 0;
    this.needsClear = true;
    this.frames = 0;
  }

  setSettings(settings, { reinitialize = false } = {}) {
    const shouldInitialize = reinitialize
      || settings.seed !== this.settings.seed
      || settings.count !== this.settings.count;
    this.settings = { ...settings, colors: [...settings.colors] };
    this.mode = PRESETS[settings.preset].mode;
    this.background = PRESETS[settings.preset].background;
    if (shouldInitialize) this.initialize();
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.needsClear = true;
    }
    this.pixelRatio = ratio;
  }

  setPointer(x, y, strength = 0.45) {
    this.pointer.x = Math.max(-1, Math.min(1, x));
    this.pointer.y = Math.max(-1, Math.min(1, y));
    this.pointer.strength = strength;
  }

  setPointerFromClient(clientX, clientY, strength = 0.45) {
    const bounds = this.canvas.getBoundingClientRect();
    this.setPointer(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((clientY - bounds.top) / bounds.height) * 2,
      strength,
    );
  }

  clearPointer() {
    this.pointer.strength = 0;
  }

  simulate(delta, time) {
    const gl = this.gl;
    const read = this.targets[this.readIndex];
    const write = this.targets[1 - this.readIndex];
    const { program, uniforms } = this.simulationProgram;

    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.textureSize, this.textureSize);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.positions);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, read.velocities);
    gl.uniform1f(uniforms.u_delta, delta);
    gl.uniform1f(uniforms.u_time, time);
    gl.uniform1f(uniforms.u_aspect, this.canvas.width / this.canvas.height);
    gl.uniform1f(uniforms.u_flow, this.settings.flow);
    gl.uniform1f(uniforms.u_speed, this.settings.speed);
    gl.uniform1f(uniforms.u_turbulence, this.settings.turbulence);
    gl.uniform1f(uniforms.u_pointerStrength, this.pointer.strength);
    gl.uniform1f(uniforms.u_pointerPolarity, this.pointer.polarity);
    gl.uniform1i(uniforms.u_mode, this.mode);
    gl.uniform2f(uniforms.u_pointer, this.pointer.x, this.pointer.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.readIndex = 1 - this.readIndex;
    this.frames += 1;
  }

  render(delta, time, advance = true) {
    this.resize();
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (advance && delta > 0) this.simulate(delta, time);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const background = colorVector(this.background);

    if (this.needsClear) {
      gl.disable(gl.BLEND);
      gl.clearColor(...background, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.needsClear = false;
    } else if (advance) {
      const { program, uniforms } = this.fadeProgram;
      const opacity = 1 - Math.pow(this.settings.trail, Math.max(delta, 0.001) * 60);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.uniform3fv(uniforms.u_background, background);
      gl.uniform1f(uniforms.u_opacity, opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const current = this.targets[this.readIndex];
    const { program, uniforms } = this.particleProgram;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, current.positions);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, current.velocities);
    gl.uniform1i(uniforms.u_textureSize, this.textureSize);
    gl.uniform1f(uniforms.u_pointSize, this.settings.pointSize);
    gl.uniform1f(uniforms.u_pixelRatio, this.pixelRatio);
    gl.uniform3fv(uniforms.u_colorA, colorVector(this.settings.colors[0]));
    gl.uniform3fv(uniforms.u_colorB, colorVector(this.settings.colors[1]));
    gl.uniform3fv(uniforms.u_colorC, colorVector(this.settings.colors[2]));
    gl.drawArrays(gl.POINTS, 0, this.settings.count);
  }

  getStats() {
    return {
      frames: this.frames,
      count: this.settings.count,
      textureSize: this.textureSize,
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }
}
