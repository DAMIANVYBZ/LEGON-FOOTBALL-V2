import test from 'node:test';
import assert from 'node:assert/strict';
import { createBallControl, footTouch, possessionTouch, controlStrideLimit, controlStrideInput, needsControlTrap, withinKickReach } from '../src/ballControl.js';

import { advancePlayer } from '../src/gameplay.js';

const player = { x: 0, z: 0, vx: 4.7, vz: 0, heading: 0 };
const ball = { x: 0.35, y: 0.11, z: 0 };
const foot = { x: 0.25, y: 0.05, z: 0.08 };

test('dribbling changes velocity only at a reachable grounded boot, leaving position to physics', () => {
  const state = createBallControl(-1), velocity = { x: 3, y: 0, z: 0 };
  const before = structuredClone({ ball, velocity, player });
  assert.equal(footTouch(state, ball, velocity, player, [{ ...foot, x: -0.6 }], 0), null);
  assert.equal(footTouch(state, ball, velocity, player, [{ ...foot, y: 0.5 }], 0), null);
  assert.equal(footTouch(state, { ...ball, y: 0.6 }, velocity, player, [foot], 0), null);
  const touch = footTouch(state, ball, velocity, player, [foot], 0);
  assert.equal(touch.contact, true); assert.equal(state.touches, 1);
  assert.ok(touch.velocity.x > player.vx);
  assert.ok(Math.abs(touch.spin.z * 0.11 + touch.velocity.x) < 1e-8);
  assert.equal(footTouch(state, ball, touch.velocity, player, [foot], 0.02), null);
  assert.deepEqual({ ball, velocity, player }, before, 'the helper cannot weld or teleport the ball');
});

test('a reachable trap checks momentum during braking and turning without pulling a distant ball', () => {
  const stopped = { ...player, vx: 0 };
  const velocity = { x: 5, y: 0, z: 0 };
  assert.equal(needsControlTrap(ball, velocity, stopped), true);
  const state = createBallControl(-1); state.lastTouch = 0; state.lastMotion = player;
  const touch = footTouch(state, ball, velocity, stopped, [foot], 0.05);
  assert.deepEqual(touch.velocity, { x: 0, y: 0, z: 0 });
  assert.equal(needsControlTrap({ ...ball, x: 1.1 }, velocity, stopped), false);
  assert.equal(footTouch(state, { ...ball, x: 1.1 }, velocity, stopped, [foot], 0.2), null);
  const turning = { ...player, vx: 0, vz: 4.7, heading: Math.PI / 2 };
  const turningState = createBallControl(-1); turningState.lastMotion = player;
  const turn = footTouch(turningState, ball, velocity, turning, [foot], 0);
  assert.ok(turn.velocity.x < 1.1 && turn.velocity.z >= 4.7);
});

test('receiving guides a nearby ground ball through bounded velocity, never flattens a high ball', () => {
  const still = { ...player, vx: 0 }, incoming = { x: 2, y: -1, z: 0 };
  const state = createBallControl(0), behind = { x: -0.7, y: 0.11, z: 0 };
  const trap = footTouch(state, behind, incoming, still, [foot], 0.1);
  assert.equal(trap.contact, false);
  assert.ok(Math.hypot(trap.velocity.x, trap.velocity.z) <= 2.5);
  assert.equal(trap.velocity.y, -1);
  const contact = footTouch(createBallControl(-1), ball, { x: 2, y: -3, z: 0 }, still, [foot], 0);
  assert.equal(contact.velocity.y, -0.6, 'a reachable boot cushions a falling ball without changing its position');
  assert.equal(footTouch(state, behind, incoming, still, [foot], 0.7), null);
  assert.equal(footTouch(state, { ...behind, y: 0.7 }, incoming, still, [foot], 0.1), null);
});

test('kick reach uses ground distance and rejects balls above playable height', () => {
  assert.equal(withinKickReach(player, { x: 1.2, y: 0.5, z: 0 }), true);
  assert.equal(withinKickReach(player, { x: 1.26, y: 0.11, z: 0 }), false);
  assert.equal(withinKickReach(player, { x: 0.35, y: 1.5, z: 0 }), false);
});

test('accelerating through a slow ball schedules a catch-up touch before the normal sprint cadence', () => {
  const runner = { ...player, vx: 7.2 };
  const behind = { x: -.2, y: .11, z: 0 }, slow = { x: 3, y: 0, z: 0 };
  const boot = { x: -.1, y: .05, z: .04 };
  const state = createBallControl(-1); state.lastTouch = 0;
  state.lastMotion = { ...runner, vx: 6.9 };
  const touch = footTouch(state, behind, slow, runner, [boot], .08, { sprint: true });
  assert.equal(touch?.contact, true, 'do not wait 0.3 s while the runner leaves this ball behind');
  assert.ok(touch.velocity.x > runner.vx, 'the touch must bring the ball onto the next stride');
  assert.ok(touch.velocity.x <= runner.vx + 3);
  assert.deepEqual(behind, { x: -.2, y: .11, z: 0 });
  assert.equal(footTouch(createBallControl(-1), { ...behind, x: -1.3 }, slow, runner, [boot], .08, { sprint: true }), null);
  assert.equal(footTouch(createBallControl(-1), behind, slow, runner, [{ ...boot, x: 1 }], .08, { sprint: true }), null);
});


test('the carrier checks their stride for a lagging ball without snapping speed or limiting an ahead touch', () => {
  const runner = { ...player, vx: 7.2 }, input = { x: 1, z: 0 };
  const behind = { x: -.2, y: .11, z: 0 }, rolling = { x: 3, y: 0, z: 0 };
  const limit = controlStrideLimit(runner, input, behind, rolling);
  assert.ok(limit < runner.vx && limit >= 1.2);
  advancePlayer(runner, input, .1, { sprint: true, dribbling: true, speedLimit: limit });
  assert.ok(runner.vx < 7.2 && runner.vx >= 5.7 - 1e-9, 'keep the normal acceleration/deceleration bound');
  assert.ok(controlStrideLimit(player, input, { x: .5, y: .11, z: 0 }, { x: 7, y: 0, z: 0 }) > 7.2);
  const sideways = controlStrideLimit(player, { x: 0, z: 1 }, { x: 0, y: .11, z: -.2 }, { x: 0, y: 0, z: 3 });
  assert.ok(Math.abs(sideways - limit) < 1e-9);
  assert.equal(controlStrideLimit(player, { x: 0, z: 0 }, behind, rolling), Infinity);
  assert.equal(controlStrideLimit(player, input, { ...behind, y: 1 }, rolling), Infinity);
  assert.equal(controlStrideLimit(player, input, { ...behind, x: -2 }, rolling), Infinity);
});


test('a slow recovery step nudges a trapped ball forward instead of leaving it behind', () => {
  const runner = { ...player, vx: .2 }, behind = { x: -.3, y: .11, z: 0 };
  const touch = footTouch(createBallControl(-1), behind, { x: 0, y: 0, z: 0 }, runner,
    [{ x: -.2, y: .05, z: 0 }], 0, { sprint: true });
  assert.equal(touch?.contact, true);assert.ok(touch.velocity.x > runner.vx + 1);
});


test('a wide controlled touch gets a small lateral recovery step without reversing input or changing stick strength', () => {
  const input = { x: .8, z: 0 }, wide = { x: .2, y: .11, z: .7 };
  const stride = controlStrideInput(player, input, wide);
  assert.ok(stride.x > 0 && stride.z > 0);
  assert.ok(Math.abs(Math.hypot(stride.x, stride.z) - .8) < 1e-9);
  const mirrored = controlStrideInput(player, input, { ...wide, z: -.7 });
  assert.equal(mirrored.x, stride.x);assert.equal(mirrored.z, -stride.z);
  assert.equal(controlStrideInput(player, input, { ...wide, z: .1 }), input);
  assert.equal(controlStrideInput(player, input, { ...wide, y: 1 }), input);
  assert.equal(controlStrideInput(player, input, { ...wide, z: 2 }), input);
});


test('owned ground ball stays at the stride through sprints, turns and stops', () => {
  for (const hz of [30, 60, 120]) {
    const p = { x: 0, z: 0, vx: 0, vz: 0, heading: 0 };
    const b = { x: .34, y: .11, z: .1 };
    let v = { x: 0, y: 0, z: 0 }, maxGap = 0;
    for (let frame = 0; frame < hz * 12; frame++) {
      const t = frame / hz;
      const input = t < 5 ? { x: 1, z: 0 } : t < 8 ? { x: 0, z: 1 } : { x: 0, z: 0 };
      advancePlayer(p, input, 1 / hz, { sprint: true, dribbling: true });
      v = possessionTouch(b, v, p).velocity;
      b.x += v.x / hz; b.z += v.z / hz;
      maxGap = Math.max(maxGap, Math.hypot(b.x - p.x, b.z - p.z));
    }
    assert.ok(maxGap < .7, `hz=${hz}, gap=${maxGap}`);
    assert.ok(Math.hypot(v.x, v.z) < .01);
  }
  assert.equal(possessionTouch({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, player), null);
});
