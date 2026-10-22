import test from 'node:test';
import assert from 'node:assert/strict';
import { applySurfaceGrip } from '../src/ballContact.js';
import { BALL } from '../src/physicsConfig.js';
import { createMatchPhysics } from '../src/matchPhysics.js';
import { groundPassSpeed } from '../src/ballistics.js';

const energy = (v, w) => v.x * v.x + v.z * v.z
  + BALL.inertia * BALL.radius * BALL.radius * (w.x * w.x + w.z * w.z);

test('surface grip transfers spin into travel without adding energy or reversing slip', () => {
  for (const x of [-15, -3, 0, 3, 15]) for (const z of [-8, 0, 8]) {
    for (const turn of [-180, -60, 0, 60, 180]) {
      const v = { x, y: 2, z }, w = { x: -turn / 2, y: 20, z: turn };
      const before = energy(v, w);
      const slip = { x: v.x + w.z * BALL.radius, z: v.z - w.x * BALL.radius };
      applySurfaceGrip(v, w, 6, 0.35);
      assert.ok(energy(v, w) <= before + 1e-8);
      const after = { x: v.x + w.z * BALL.radius, z: v.z - w.x * BALL.radius };
      assert.ok(Math.hypot(after.x, after.z) <= Math.hypot(slip.x, slip.z) + 1e-8);
      assert.ok(after.x * slip.x + after.z * slip.z >= -1e-8);
      assert.equal(v.y, 2, 'Rapier handles the normal bounce');
      assert.equal(w.y, 20, 'vertical spin has no slip at the bottom contact');
    }
  }
});

test('pure rolling is unchanged by grip and friction is bounded by the impact', () => {
  const v = { x: 12, y: 0, z: 3 }, w = { x: 3 / BALL.radius, y: 0, z: -12 / BALL.radius };
  applySurfaceGrip(v, w, 5, 0.4);
  assert.deepEqual(v, { x: 12, y: 0, z: 3 });
  const sliding = { x: 12, y: 0, z: 0 }, noSpin = { x: 0, y: 0, z: 0 };
  applySurfaceGrip(sliding, noSpin, 0.2, 0.35);
  assert.ok(Math.abs(sliding.x - 11.93) < 1e-8);
  const stopped = { x: 0, y: 0, z: 0 }, overspin = { x: 0, y: 0, z: -60 };
  applySurfaceGrip(stopped, overspin, 2, 0.35);
  assert.ok(stopped.x > 0, 'spin can start the ball moving');
});

test('in Rapier a backspun landing checks while an overspun landing kicks forward', async () => {
  const physics = await createMatchPhysics({ length: 95, width: 60, goalWidth: 7.32, goalHeight: 2.44 });
  try {
    const bounce = turn => {
      let position = { x: 0, y: 0.18, z: 0 }, velocity = { x: 3, y: -4, z: 0 };
      physics.reset(position, velocity, { x: 0, y: 0, z: turn });
      for (let i = 0; i < 15; i++) {
        const next = physics.step(1 / 60, position, velocity);
        position = next.position; velocity = next.velocity;
        if (velocity.y > 0.3) return velocity.x;
      }
      assert.fail('the ball never bounced');
    };
    const backspin = bounce(60), topspin = bounce(-60);
    assert.ok(backspin < 2 && topspin > 3.5, `${backspin} vs ${topspin}`);
  } finally { physics.free(); }
});

test('ground contact settles to rest without reversing a slow pass', async () => {
  const physics = await createMatchPhysics({ length: 95, width: 60, goalWidth: 7.32, goalHeight: 2.44 });
  try {
    let p = { x: 0, y: BALL.radius, z: 0 }, v = { x: 2, y: 0, z: 0 };
    physics.reset(p, v, { x: 0, y: 0, z: -2 / BALL.radius });
    for (let i = 0; i < 300; i++) {
      const next = physics.step(1 / 60, p, v);
      assert.ok(next.position.x >= p.x - 1e-6);
      p = next.position; v = next.velocity;
    }
    assert.ok(Math.hypot(v.x, v.z) < 0.01);
    assert.ok(p.x > 0.5 && p.x < 3);
  } finally { physics.free(); }
});

test('weighted passes reach their receiver at a controllable speed on every surface', async () => {
  for (const surface of ['grass', 'worn', 'mixed', 'soil', 'astro']) {
    const physics = await createMatchPhysics({ length: 95, width: 60, goalWidth: 7.32, goalHeight: 2.44, surface });
    try {
      for (const distance of [5, 15, 30]) {
        const speed = groundPassSpeed(distance, surface, 4.5);
        let p = { x: 0, y: BALL.radius, z: 0 }, v = { x: speed, y: 0.2, z: 0 };
        physics.reset(p, v, { x: 0, y: 0, z: -6 });
        for (let i = 0; i < 480 && p.x < distance; i++) {
          const next = physics.step(1 / 60, p, v);
          p = next.position; v = next.velocity;
        }
        assert.ok(p.x >= distance, `${surface} pass stopped short of ${distance}m: ${p.x}`);
        assert.ok(Math.abs(v.x - 4.5) < 0.35, `${surface} ${distance}m pass arrived at ${v.x}m/s`);
      }
    } finally { physics.free(); }
  }
  assert.ok(groundPassSpeed(25, 'soil') > groundPassSpeed(25, 'astro'));
  assert.ok(groundPassSpeed(100, 'soil', 5, 20) <= 20, 'never exceed the kick speed cap');
});

test('a sliding player has no invisible upright ball collision and normal collision returns afterwards', async () => {
  const players = [{ x: 0, z: 0 }];
  const physics = await createMatchPhysics({ length: 70, width: 45, goalWidth: 7.32, goalHeight: 2.44, playerPositions: players });
  try {
    for (const sliding of [0, -1]) {
      let position = { x: -1, y: .8, z: 0 }, velocity = { x: 8, y: 0, z: 0 }, touched = false;
      physics.reset(position, velocity, undefined, players);
      for (let i = 0; i < 15; i++) {
        const next = physics.step(1 / 60, position, velocity, players, -1, sliding);
        position = next.position; velocity = next.velocity; touched ||= next.lastTouch === 0;
      }
      assert.equal(touched, sliding < 0);
      if (sliding === 0) assert.ok(position.x > .7, 'an overhead ball must clear the prone player');
    }
  } finally { physics.free(); }
});
