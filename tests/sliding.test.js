import test from 'node:test';
import assert from 'node:assert/strict';
import { slideAim, slideVelocity, sweepContact, slideBallContact, slideDeflection, slideVerdict, slideApproachSpeed } from '../src/sliding.js';

test('slide entry retains momentum and coasts to rest instead of stopping at a touch', () => {
  const initial = { x: 7, z: 1 };
  assert.deepEqual(slideVelocity(initial, 0, 0), initial);
  assert.ok(slideVelocity(initial, 0, .02).x > 6);
  const samples = [.3, .6, .9, 1.1].map(t => slideVelocity(initial, 0, t).x);
  assert.ok(samples[0] > samples[1] && samples[1] > samples[2] && samples[2] > 0);
  assert.equal(samples[3], 0);
});

test('interception leads a crossing ball with bounded assistance and respects a deliberate miss', () => {
  const p = { x: 0, z: 0, vx: 5, vz: 0, heading: 0 }, ball = { x: 2, y: .11, z: 0 };
  const angle = slideAim({ x: 1, z: 0 }, p, ball, { x: 0, z: 2 });
  assert.ok(angle > 0 && angle <= .22);
  assert.equal(slideAim({ x: 0, z: -1 }, p, ball, { x: 0, z: 2 }), -Math.PI / 2);
  assert.equal(slideAim({ x: 0, z: 0 }, p, { x: 20, y: .11, z: 0 }, { x: 0, z: 0 }), 0);
});

test('swept boots find a fast ball between frames but miss a sideways or high ball', () => {
  const from = [{ x: 0, y: .06, z: 0 }], to = [{ x: .2, y: .06, z: 0 }];
  assert.ok(slideBallContact(from, to, { x: 1, y: .11, z: 0 }, { x: -1, y: .11, z: 0 }));
  assert.equal(slideBallContact(from, to, { x: .1, y: .11, z: 1 }, { x: .1, y: .11, z: 1 }), null);
  assert.equal(slideBallContact(from, to, { x: .1, y: .8, z: 0 }, { x: .1, y: .8, z: 0 }), null);
  assert.equal(sweepContact(from[0], from[0], { x: 3, y: .06, z: 0 }, { x: 3, y: .06, z: 0 }, .2), null);
});

test('aim compensation puts the extended boot on the ball instead of the body centre line', () => {
  const heading = slideAim({ x: 1, z: 0 }, { x: 0, z: 0, vx: 0, vz: 0, heading: 0 }, { x: 1.8, y: .11, z: 0 }, { x: 0, z: 0 });
  const travel = (1.8 - Math.sin(heading) * .12) / Math.cos(heading);
  assert.ok(Math.abs(Math.sin(heading) * travel - Math.cos(heading) * .12) < .02);
});

test('tackle deflection rotates with the boot and preserves tangential ball motion', () => {
  const result = slideDeflection({ x: 0, y: 0, z: 2 }, { x: 5, z: 0 }, { x: 0, z: 0 }, { x: .2, z: 0 }, 0);
  assert.ok(result.velocity.x > 5); assert.equal(result.velocity.z, 2);
  for (const angle of [Math.PI / 2, Math.PI, -.8]) {
    const rotate = p => ({ x: p.x * Math.cos(angle) - p.z * Math.sin(angle), y: p.y, z: p.x * Math.sin(angle) + p.z * Math.cos(angle) });
    const actual = slideDeflection(rotate({ x: 0, y: 0, z: 2 }), rotate({ x: 5, z: 0 }), { x: 0, z: 0 }, rotate({ x: .2, z: 0 }), angle);
    const expected = rotate(result.velocity);
    assert.ok(Math.hypot(actual.velocity.x - expected.x, actual.velocity.z - expected.z) < 1e-9);
  }
});

test('body contact before the ball is sanctioned while a ball-first follow-through is separate', () => {
  assert.deepEqual(slideVerdict(.8, .2, false, 6), { ballFirst: false, foul: true, card: 'red' });
  assert.equal(slideVerdict(null, .2, false, 3).card, 'yellow');
  assert.equal(slideVerdict(.2, .8, false, 6).foul, false);
  assert.equal(slideVerdict(null, .2, true, 6).foul, false);
  assert.equal(slideVerdict(null, null, false, 6).foul, false);
  assert.equal(slideVerdict(null, .2, false, .5).foul, false);
});

test('a carrier running into a stopped tackler does not create a reckless slide foul', () => {
  const player = { x: 0, z: 0, vx: 0, vz: 0 }, opponent = { x: .5, z: 0, vx: -6, vz: 0 };
  assert.equal(slideApproachSpeed(player, opponent), 0);
  assert.equal(slideApproachSpeed({ ...player, vx: 3 }, opponent), 3);
  assert.equal(slideApproachSpeed({ ...player, vx: 3 }, { ...opponent, vx: 4 }), 0);
});
