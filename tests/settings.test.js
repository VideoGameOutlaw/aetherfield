import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, decodeSettings, encodeSettings, PRESETS, SETTING_LIMITS } from '../src/lib/settings.js';

test('settings use the Nebula preset and sanitize unsafe overrides', () => {
  const defaults = createSettings();
  assert.equal(defaults.preset, 'nebula');
  assert.equal(defaults.count, 180000);
  assert.deepEqual(defaults.colors, PRESETS.nebula.colors);

  const settings = createSettings({
    preset: 'not-a-preset',
    seed: '  custom seed  ',
    flow: 99,
    speed: -4,
    turbulence: Number.NaN,
    trail: 1,
    pointSize: -1,
    count: 17,
    colors: ['red', '#123456', 'url(javascript:alert(1))'],
  });

  assert.equal(settings.preset, 'nebula');
  assert.equal(settings.seed, 'custom seed');
  assert.equal(settings.flow, SETTING_LIMITS.flow.max);
  assert.equal(settings.speed, SETTING_LIMITS.speed.min);
  assert.equal(settings.turbulence, defaults.turbulence);
  assert.equal(settings.trail, SETTING_LIMITS.trail.max);
  assert.equal(settings.pointSize, SETTING_LIMITS.pointSize.min);
  assert.equal(settings.count, 180000);
  assert.deepEqual(settings.colors, PRESETS.nebula.colors);
});

test('shared fields round-trip through a URL-safe payload and reject corrupt input', () => {
  const original = createSettings({
    preset: 'tidal',
    seed: '🪐 orbit 42',
    flow: 1.42,
    count: 262144,
  });
  const encoded = encodeSettings(original);

  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeSettings(encoded), original);
  assert.deepEqual(decodeSettings(`#field=${encoded}`), original);
  assert.equal(decodeSettings('not valid base64url!!!'), null);
  assert.equal(decodeSettings(''), null);
});
