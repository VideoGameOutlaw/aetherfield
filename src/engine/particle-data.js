import { createRandom } from '../lib/prng.js';

export function getParticleTextureSize(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('Particle count must be a positive integer.');
  }
  return Math.ceil(Math.sqrt(count));
}

export function createParticleData(count, seed) {
  const size = getParticleTextureSize(count);
  const positions = new Float32Array(size * size * 4);
  const velocities = new Float32Array(size * size * 4);
  const random = createRandom(seed);

  for (let particle = 0; particle < count; particle += 1) {
    const offset = particle * 4;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 0.9;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const life = 8 + random() * 12;
    const velocity = 0.015 + random() * 0.04;

    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = random() * life;
    positions[offset + 3] = life;

    velocities[offset] = -y * velocity;
    velocities[offset + 1] = x * velocity;
    velocities[offset + 2] = random();
    velocities[offset + 3] = 0.45 + random() * 1.1;
  }

  return { positions, velocities, size };
}
