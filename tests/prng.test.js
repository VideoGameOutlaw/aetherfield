import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom, normalizeSeed } from '../src/lib/prng.js';

test('seeded random sequences are deterministic and normalized', () => {
  const first = createRandom('ultraviolet-42');
  const second = createRandom('ultraviolet-42');
  const sequenceA = Array.from({ length: 8 }, first);
  const sequenceB = Array.from({ length: 8 }, second);

  assert.deepEqual(sequenceA, sequenceB);
  assert.ok(sequenceA.every((value) => value >= 0 && value < 1));
  assert.notDeepEqual(sequenceA, Array.from({ length: 8 }, createRandom('different')));
  assert.equal(normalizeSeed('  hello world  '), 'hello world');
  assert.equal(normalizeSeed(''), 'aetherfield');
});
