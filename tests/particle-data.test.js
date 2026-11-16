import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticleData, getParticleTextureSize } from '../src/engine/particle-data.js';

test('particle buffers are deterministic, GPU-sized, and stagger particle lifetimes', () => {
  assert.equal(getParticleTextureSize(1), 1);
  assert.equal(getParticleTextureSize(180000), 425);
  assert.equal(getParticleTextureSize(262144), 512);

  const first = createParticleData(1000, 'same-seed');
  const second = createParticleData(1000, 'same-seed');
  assert.equal(first.size, 32);
  assert.equal(first.positions.length, 32 * 32 * 4);
  assert.equal(first.velocities.length, 32 * 32 * 4);
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.velocities, second.velocities);

  for (let particle = 0; particle < 1000; particle += 1) {
    const offset = particle * 4;
    const [x, y, age, life] = first.positions.subarray(offset, offset + 4);
    assert.ok(Math.hypot(x, y) <= 0.9001);
    assert.ok(age >= 0 && age < life);
    assert.ok(life >= 8 && life <= 20);
    assert.ok(first.velocities[offset + 2] >= 0 && first.velocities[offset + 2] < 1);
  }
});
