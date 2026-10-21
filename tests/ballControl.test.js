import test from 'node:test';
import assert from 'node:assert/strict';
import { createBallControl, footTouch, needsControlTrap, withinKickReach } from '../src/ballControl.js';

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
