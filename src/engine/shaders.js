export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;
void main() {
  vec2 point = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(point * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SIMULATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_positions;
uniform sampler2D u_velocities;
uniform float u_delta;
uniform float u_time;
uniform float u_aspect;
uniform float u_flow;
uniform float u_speed;
uniform float u_turbulence;
uniform float u_pointerStrength;
uniform float u_pointerPolarity;
uniform int u_mode;
uniform vec2 u_pointer;

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outVelocity;

float hash21(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 point) {
  float n = hash21(point);
  return vec2(n, hash21(point + n + 19.19));
}

float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.55;
  mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(point);
    point = rotation * point * 2.03 + 11.7;
    amplitude *= 0.5;
  }
  return value;
}

float potential(vec2 point) {
  vec2 drift = vec2(u_time * 0.035, -u_time * 0.024);
  return fbm(point + drift);
}

vec2 curlNoise(vec2 point) {
  const float epsilon = 0.075;
  float left = potential(point - vec2(epsilon, 0.0));
  float right = potential(point + vec2(epsilon, 0.0));
  float down = potential(point - vec2(0.0, epsilon));
  float up = potential(point + vec2(0.0, epsilon));
  return vec2(up - down, left - right) / (2.0 * epsilon);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 positionLife = texelFetch(u_positions, cell, 0);
  vec4 velocityMeta = texelFetch(u_velocities, cell, 0);
  vec2 position = positionLife.xy;
  vec2 velocity = velocityMeta.xy;
  float age = positionLife.z + u_delta * u_speed;
  float life = positionLife.w;
  vec2 world = position * vec2(u_aspect, 1.0);

  vec2 flow = curlNoise(world * (0.9 + u_turbulence * 0.48));
  flow *= 0.15 * u_flow * u_turbulence;

  if (u_mode == 0) {
    flow += vec2(-position.y, position.x) * 0.19;
    flow -= position * 0.025;
  } else if (u_mode == 1) {
    vec2 radial = normalize(position + vec2(0.0001));
    flow += radial * 0.13 + vec2(-radial.y, radial.x) * 0.31;
    flow -= position * 0.018;
  } else if (u_mode == 2) {
    flow += vec2(0.2, sin(position.x * 3.2 + u_time * 0.28) * 0.09);
    flow += curlNoise(world * 0.42 + 7.0) * 0.055 * u_flow;
  } else {
    flow *= 1.5;
    flow += vec2(-position.y, position.x) * 0.07;
    flow -= position * 0.055;
  }

  vec2 pointerDelta = u_pointer - position;
  float pointerDistance = dot(pointerDelta, pointerDelta);
  flow += normalize(pointerDelta + vec2(0.0001))
    * u_pointerPolarity * u_pointerStrength * 0.24 / (pointerDistance * 9.0 + 0.16);

  float response = 1.0 - exp(-u_delta * 2.25);
  velocity = mix(velocity, flow, response);
  velocity *= exp(-u_delta * 0.07);
  position += velocity * u_delta * u_speed * 1.85;

  bool expired = age >= life || abs(position.x) > 1.24 || abs(position.y) > 1.2;
  if (expired) {
    vec2 random = hash22(vec2(velocityMeta.z * 913.7 + u_time, float(cell.x + cell.y * 701)));
    float angle = random.x * 6.28318530718;
    float radius = sqrt(random.y) * (u_mode == 1 ? 0.2 : 0.9);
    position = vec2(cos(angle), sin(angle)) * radius;
    if (u_mode == 2 && positionLife.x > 1.1) {
      position = vec2(-1.08, random.y * 1.8 - 0.9);
    }
    velocity = vec2(-position.y, position.x) * 0.035;
    age = 0.0;
    life = 8.0 + random.x * 12.0;
  }

  outPosition = vec4(position, age, life);
  outVelocity = vec4(velocity, velocityMeta.zw);
}
`;

export const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_positions;
uniform sampler2D u_velocities;
uniform int u_textureSize;
uniform float u_pointSize;
uniform float u_pixelRatio;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;

out vec3 v_color;
out float v_opacity;

void main() {
  ivec2 cell = ivec2(gl_VertexID % u_textureSize, gl_VertexID / u_textureSize);
  vec4 positionLife = texelFetch(u_positions, cell, 0);
  vec4 velocityMeta = texelFetch(u_velocities, cell, 0);
  float speed = length(velocityMeta.xy);
  float colorPosition = fract(velocityMeta.z * 2.73 + speed * 2.4);

  if (colorPosition < 0.5) {
    v_color = mix(u_colorA, u_colorB, colorPosition * 2.0);
  } else {
    v_color = mix(u_colorB, u_colorC, (colorPosition - 0.5) * 2.0);
  }

  float lifeFade = smoothstep(0.0, 0.65, positionLife.z)
    * (1.0 - smoothstep(positionLife.w - 1.0, positionLife.w, positionLife.z));
  v_opacity = (0.055 + velocityMeta.w * 0.085) * lifeFade;
  gl_PointSize = max(1.0, u_pointSize * u_pixelRatio * (0.65 + velocityMeta.w * 0.5));
  gl_Position = vec4(positionLife.xy, 0.0, 1.0);
}
`;

export const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_color;
in float v_opacity;
out vec4 outColor;

void main() {
  vec2 point = gl_PointCoord - 0.5;
  float radiusSquared = dot(point, point);
  if (radiusSquared > 0.25) discard;
  float profile = exp(-radiusSquared * 18.0) * smoothstep(0.25, 0.0, radiusSquared);
  outColor = vec4(v_color * profile * v_opacity, 1.0);
}
`;

export const FADE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 u_background;
uniform float u_opacity;
out vec4 outColor;
void main() {
  outColor = vec4(u_background, u_opacity);
}
`;
