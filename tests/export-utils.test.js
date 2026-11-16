import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportFilename, selectRecorderMimeType } from '../src/lib/export-utils.js';

test('export filenames are portable, dated, and tied to the field', () => {
  const date = new Date('2026-11-10T23:59:05.000Z');
  assert.equal(
    createExportFilename({ preset: 'nebula', seed: 'My / favorite field!' }, 'png', date),
    'aetherfield-nebula-my-favorite-field-20261110-235905.png',
  );
});

test('recording picks the first actually supported video format', () => {
  const supported = selectRecorderMimeType((type) => type === 'video/webm;codecs=vp8');
  assert.equal(supported, 'video/webm;codecs=vp8');
  assert.equal(selectRecorderMimeType(() => false), '');
});
