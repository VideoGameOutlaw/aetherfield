import './style.css';
import { ParticleEngine } from './engine/particle-engine.js';
import { createSettings, decodeSettings, encodeSettings, PRESETS } from './lib/settings.js';
import { createExportFilename, selectRecorderMimeType } from './lib/export-utils.js';

const MODE_LABELS = ['CURL / ORBIT', 'RADIAL / DRIFT', 'FLOW / CURRENT', 'CURL / ORDER'];
const SLIDER_IDS = ['flow', 'speed', 'turbulence', 'trail', 'pointSize'];
const byId = (id) => document.getElementById(id);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function boot() {
  const canvas = byId('field');
  const panel = byId('control-panel');
  const mobileQuery = window.matchMedia('(max-width: 800px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let settings = decodeSettings(window.location.hash) ?? createSettings();
  let isPlaying = !reducedMotion.matches;
  let isRecording = false;
  let recorder = null;
  let recordingStarted = 0;
  let elapsed = 0;
  let previousTime = performance.now();
  let toastTimeout = 0;
  let pointerPolarity = 1;
  let needsRender = true;

  const engine = new ParticleEngine(canvas, settings);

  function showToast(message) {
    window.clearTimeout(toastTimeout);
    const toast = byId('toast');
    toast.textContent = message;
    toast.dataset.visible = 'true';
    toastTimeout = window.setTimeout(() => { toast.dataset.visible = 'false'; }, 2600);
  }

  function syncAccent() {
    const color = settings.colors[0];
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-rgb', `${red}, ${green}, ${blue}`);
  }

  function syncPlayback() {
    byId('play-toggle').setAttribute('aria-label', isPlaying ? 'Pause field' : 'Resume field');
    byId('play-icon').setAttribute('href', isPlaying ? '#icon-pause' : '#icon-play');
    byId('engine-state').textContent = isRecording ? 'REC' : (isPlaying ? 'LIVE' : 'PAUSED');
    document.documentElement.dataset.playing = String(isPlaying);
  }

  function syncRecording() {
    byId('record').dataset.recording = String(isRecording);
    byId('record').setAttribute('aria-label', isRecording ? 'Stop video recording' : 'Start video recording');
    byId('record-label').textContent = isRecording ? 'Stop' : 'Record';
    byId('recording-status').hidden = !isRecording;
    syncPlayback();
  }

  function syncSettings() {
    const preset = PRESETS[settings.preset];
    byId('preset-name').textContent = preset.name;
    byId('preset-number').textContent = `FIELD ${preset.number}`;
    byId('preset-mode').textContent = MODE_LABELS[preset.mode];
    byId('preset-tagline').textContent = preset.tagline;
    byId('preset-description').textContent = preset.description;
    byId('header-seed').textContent = settings.seed.toUpperCase();
    byId('particle-count').value = String(settings.count);
    byId('particle-stat').textContent = `${Math.round(settings.count / 1000)}K PTS`;

    for (const button of document.querySelectorAll('[data-preset]')) {
      button.setAttribute('aria-pressed', String(button.dataset.preset === settings.preset));
    }

    for (const id of SLIDER_IDS) {
      const input = byId(id);
      const value = settings[id];
      input.value = String(value);
      const progress = ((value - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
      input.style.setProperty('--range-progress', `${progress}%`);
      byId(`${id}-value`).textContent = id === 'trail' ? `${Math.round(value * 100)}%` : value.toFixed(2);
    }

    ['a', 'b', 'c'].forEach((letter, index) => {
      byId(`color-${letter}`).value = settings.colors[index];
    });
    syncAccent();
  }

  function applySettings(nextSettings, options) {
    settings = nextSettings;
    engine.setSettings(settings, options);
    needsRender = true;
    syncSettings();
  }

  function selectPreset(presetId) {
    if (!PRESETS[presetId]) return;
    applySettings(createSettings({
      preset: presetId,
      seed: settings.seed,
      count: settings.count,
    }));
  }

  function togglePlayback() {
    isPlaying = !isPlaying;
    previousTime = performance.now();
    needsRender = true;
    syncPlayback();
  }

  function restartField() {
    elapsed = 0;
    previousTime = performance.now();
    engine.initialize();
    needsRender = true;
    showToast('Field restarted from the same seed');
  }

  function randomizeField() {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    const seed = `field-${values[0].toString(16).padStart(8, '0')}${values[1].toString(16).padStart(8, '0')}`;
    applySettings(createSettings({ ...settings, seed }));
    elapsed = 0;
    showToast(`New seed · ${seed}`);
  }

  function setControlsOpen(open) {
    panel.dataset.open = String(open);
    byId('controls-toggle').setAttribute('aria-expanded', String(open && mobileQuery.matches));
  }

  async function shareField() {
    const url = new URL(window.location.href);
    url.hash = `field=${encodeSettings(settings)}`;
    window.history.replaceState(null, '', url);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url.href);
      showToast('Field link copied to clipboard');
    } catch {
      showToast('Share link ready in the address bar');
    }
  }

  async function exportPNG() {
    const button = byId('export-png');
    button.disabled = true;
    try {
      engine.render(0, elapsed, false);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not encode this frame.');
      downloadBlob(blob, createExportFilename(settings, 'png'));
      showToast('PNG captured at canvas resolution');
    } catch (error) {
      showToast(error.message || 'PNG export failed');
    } finally {
      button.disabled = false;
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  function startRecording() {
    if (isRecording) {
      stopRecording();
      return;
    }
    if (!window.MediaRecorder || !canvas.captureStream) {
      showToast('Video capture is not supported in this browser');
      return;
    }

    try {
      const mimeType = selectRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('No supported video format was found.');
      const stream = canvas.captureStream(60);
      const chunks = [];
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunks, { type: mimeType });
        downloadBlob(blob, createExportFilename(settings, mimeType.includes('mp4') ? 'mp4' : 'webm'));
        for (const track of stream.getTracks()) track.stop();
        isRecording = false;
        recorder = null;
        syncRecording();
        showToast('Video recording saved');
      });
      recorder.addEventListener('error', () => {
        isRecording = false;
        recorder = null;
        syncRecording();
        showToast('Video recording failed');
      });
      isRecording = true;
      recordingStarted = performance.now();
      recorder.start(200);
      syncRecording();
    } catch (error) {
      recorder = null;
      isRecording = false;
      syncRecording();
      showToast(error.message || 'Video recording could not start');
    }
  }

  function openAbout() {
    if (!byId('about').open) byId('about').showModal();
  }

  const presetGrid = byId('preset-grid');
  for (const preset of Object.values(PRESETS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-button';
    button.dataset.preset = preset.id;
    button.setAttribute('aria-label', `${preset.name} preset`);
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--preset-a', preset.colors[0]);
    button.style.setProperty('--preset-b', preset.colors[1]);
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.name;
    const number = document.createElement('span');
    number.className = 'preset-number';
    number.textContent = preset.number;
    button.append(name, number);
    button.addEventListener('click', () => selectPreset(preset.id));
    presetGrid.append(button);
  }

  for (const id of SLIDER_IDS) {
    byId(id).addEventListener('input', (event) => {
      applySettings(createSettings({ ...settings, [id]: Number(event.target.value) }));
    });
  }

  ['a', 'b', 'c'].forEach((letter, index) => {
    byId(`color-${letter}`).addEventListener('input', (event) => {
      const colors = [...settings.colors];
      colors[index] = event.target.value;
      applySettings(createSettings({ ...settings, colors }));
    });
  });

  byId('particle-count').addEventListener('change', (event) => {
    applySettings(createSettings({ ...settings, count: Number(event.target.value) }));
  });
  byId('play-toggle').addEventListener('click', togglePlayback);
  byId('reset').addEventListener('click', restartField);
  byId('randomize').addEventListener('click', randomizeField);
  byId('pointer-mode').addEventListener('click', () => {
    pointerPolarity *= -1;
    engine.pointer.polarity = pointerPolarity;
    byId('pointer-mode-label').textContent = pointerPolarity === 1 ? 'Attract' : 'Repel';
    byId('pointer-mode').setAttribute('aria-label', `Switch pointer force to ${pointerPolarity === 1 ? 'repel' : 'attract'}`);
  });
  byId('share').addEventListener('click', shareField);
  byId('export-png').addEventListener('click', exportPNG);
  byId('record').addEventListener('click', startRecording);
  byId('about-open').addEventListener('click', openAbout);
  byId('about-close').addEventListener('click', () => byId('about').close());
  byId('about-explore').addEventListener('click', () => byId('about').close());
  byId('controls-toggle').addEventListener('click', () => setControlsOpen(panel.dataset.open !== 'true'));
  byId('controls-close').addEventListener('click', () => setControlsOpen(false));
  mobileQuery.addEventListener('change', (event) => setControlsOpen(!event.matches));

  canvas.addEventListener('pointermove', (event) => {
    engine.setPointerFromClient(event.clientX, event.clientY, event.buttons === 1 ? 1.5 : 0.4);
  });
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    engine.setPointerFromClient(event.clientX, event.clientY, 1.5);
  });
  canvas.addEventListener('pointerup', (event) => {
    engine.setPointerFromClient(event.clientX, event.clientY, 0.4);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerleave', () => engine.clearPointer());
  canvas.addEventListener('pointercancel', () => engine.clearPointer());
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    isPlaying = false;
    syncPlayback();
    showToast('Graphics context lost — reload to restart the field');
  });

  window.addEventListener('hashchange', () => {
    const shared = decodeSettings(window.location.hash);
    if (shared) {
      applySettings(shared);
      showToast('Shared field loaded');
    }
  });
  window.addEventListener('resize', () => { needsRender = true; });
  document.addEventListener('visibilitychange', () => {
    previousTime = performance.now();
    needsRender = true;
  });
  document.addEventListener('keydown', (event) => {
    if (byId('about').open || event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === ' ') {
      event.preventDefault();
      togglePlayback();
    } else if (key === 'h') {
      document.body.dataset.uiHidden = String(document.body.dataset.uiHidden !== 'true');
    } else if (key === 'r') {
      restartField();
    } else if (key === 'n') {
      randomizeField();
    } else if (key === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => showToast('Fullscreen is unavailable'));
    } else if (['1', '2', '3', '4'].includes(key)) {
      selectPreset(Object.keys(PRESETS)[Number(key) - 1]);
    } else if (key === '?') {
      openAbout();
    }
  });

  let statsStarted = performance.now();
  let statsFrames = 0;
  function frame(now) {
    const delta = Math.min(Math.max((now - previousTime) / 1000, 0), 0.04);
    previousTime = now;
    if (isPlaying) elapsed += delta;
    if (isPlaying || isRecording || needsRender) {
      engine.render(delta, elapsed, isPlaying);
      needsRender = false;
      statsFrames += 1;
    }

    if (now - statsStarted >= 600) {
      byId('fps').textContent = isPlaying || isRecording
        ? String(Math.round((statsFrames * 1000) / (now - statsStarted)))
        : '—';
      statsFrames = 0;
      statsStarted = now;
    }
    if (isRecording) {
      const seconds = Math.floor((now - recordingStarted) / 1000);
      byId('recording-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    requestAnimationFrame(frame);
  }

  setControlsOpen(!mobileQuery.matches);
  syncSettings();
  syncPlayback();
  engine.resize();
  document.documentElement.dataset.renderer = 'ready';
  window.aetherfield = {
    engine,
    get settings() { return settings; },
    getState: () => ({
      settings: { ...settings, colors: [...settings.colors] },
      isPlaying,
      isRecording,
      pointerPolarity,
      uiHidden: document.body.dataset.uiHidden === 'true',
    }),
  };
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (error) {
  document.documentElement.dataset.renderer = 'error';
  byId('unsupported').hidden = false;
  byId('unsupported-message').textContent = error.message || 'The renderer could not start.';
  console.error(error);
}
