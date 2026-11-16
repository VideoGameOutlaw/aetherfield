import { normalizeSeed } from './prng.js';

export const PRESETS = Object.freeze({
  nebula: Object.freeze({
    id: 'nebula',
    number: '01',
    name: 'Nebula',
    tagline: 'Chaotic beauty, held in orbit.',
    description: 'A violet deep-space current with electric edges and a softly glowing core.',
    mode: 0,
    background: '#030309',
    colors: Object.freeze(['#8b5cf6', '#22d3ee', '#fb7185']),
    flow: 0.95,
    speed: 0.72,
    turbulence: 1.15,
    trail: 0.955,
    pointSize: 1.35,
  }),
  solaris: Object.freeze({
    id: 'solaris',
    number: '02',
    name: 'Solaris',
    tagline: 'A star on the edge of collapse.',
    description: 'Incandescent plasma spirals outward through a turbulent magnetic field.',
    mode: 1,
    background: '#080402',
    colors: Object.freeze(['#ffb86b', '#ff5d45', '#ffe8a3']),
    flow: 0.72,
    speed: 0.88,
    turbulence: 0.8,
    trail: 0.95,
    pointSize: 1.25,
  }),
  tidal: Object.freeze({
    id: 'tidal',
    number: '03',
    name: 'Tidal',
    tagline: 'An ocean with no surface.',
    description: 'Cool currents fold into luminous ribbons, suspended somewhere below the waves.',
    mode: 2,
    background: '#02090c',
    colors: Object.freeze(['#5eead4', '#38bdf8', '#a7f3d0']),
    flow: 1.15,
    speed: 0.55,
    turbulence: 0.65,
    trail: 0.97,
    pointSize: 1.15,
  }),
  monolith: Object.freeze({
    id: 'monolith',
    number: '04',
    name: 'Monolith',
    tagline: 'Order emerges from static.',
    description: 'A study in silver and shadow, carved by a sharper and less forgiving current.',
    mode: 3,
    background: '#050505',
    colors: Object.freeze(['#f4f4f5', '#a1a1aa', '#64748b']),
    flow: 0.55,
    speed: 0.48,
    turbulence: 1.5,
    trail: 0.965,
    pointSize: 1.0,
  }),
});

export const SETTING_LIMITS = Object.freeze({
  flow: Object.freeze({ min: 0, max: 2 }),
  speed: Object.freeze({ min: 0.1, max: 1.8 }),
  turbulence: Object.freeze({ min: 0, max: 2 }),
  trail: Object.freeze({ min: 0.8, max: 0.985 }),
  pointSize: Object.freeze({ min: 0.6, max: 2.6 }),
});

export const PARTICLE_COUNTS = Object.freeze([60000, 120000, 180000, 262144]);

function clampNumber(value, fallback, limits) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, number));
}

function validColors(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return value.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    ? [...value]
    : [...fallback];
}

export function createSettings(overrides = {}) {
  const preset = PRESETS[overrides.preset] ?? PRESETS.nebula;
  const settings = {
    preset: preset.id,
    seed: normalizeSeed(overrides.seed).slice(0, 64),
    flow: clampNumber(overrides.flow, preset.flow, SETTING_LIMITS.flow),
    speed: clampNumber(overrides.speed, preset.speed, SETTING_LIMITS.speed),
    turbulence: clampNumber(overrides.turbulence, preset.turbulence, SETTING_LIMITS.turbulence),
    trail: clampNumber(overrides.trail, preset.trail, SETTING_LIMITS.trail),
    pointSize: clampNumber(overrides.pointSize, preset.pointSize, SETTING_LIMITS.pointSize),
    count: PARTICLE_COUNTS.includes(Number(overrides.count)) ? Number(overrides.count) : 180000,
    colors: validColors(overrides.colors, preset.colors),
  };

  return settings;
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(payload) {
  const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSettings(value) {
  const settings = createSettings(value);
  return toBase64Url(JSON.stringify([
    1,
    settings.preset,
    settings.seed,
    settings.flow,
    settings.speed,
    settings.turbulence,
    settings.trail,
    settings.pointSize,
    settings.count,
    settings.colors,
  ]));
}

export function decodeSettings(input) {
  try {
    const payload = String(input).replace(/^#field=/, '');
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
    const data = JSON.parse(fromBase64Url(payload));
    if (!Array.isArray(data) || data.length !== 10 || data[0] !== 1) return null;

    return createSettings({
      preset: data[1],
      seed: data[2],
      flow: data[3],
      speed: data[4],
      turbulence: data[5],
      trail: data[6],
      pointSize: data[7],
      count: data[8],
      colors: data[9],
    });
  } catch {
    return null;
  }
}
