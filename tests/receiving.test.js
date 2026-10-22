import test from 'node:test';
import assert from 'node:assert/strict';
import { assistedReceivingInput, receivingPath, receivingPoint, RECEIVING_ASSIST } from '../src/receiving.js';
import { throwInPlan } from '../src/throwIns.js';
import { advancePlayer } from '../src/gameplay.js';
import { flight, liftFor } from '../src/ballistics.js';
import { createMatchPhysics } from '../src/matchPhysics.js';

const field = { length: 71, width: 45 }, player = { x: 0, z: 0 };
test('receiving is a 30/70 input blend, including diagonal and opposing manual input', () => {
  assert.equal(RECEIVING_ASSIST, 0.7);
  const blended = assistedReceivingInput({ x: 0, z: 1 }, player, { x: 10, z: 0 }, 5.8);
  assert.ok(Math.abs(blended.x - .7) < 1e-9 && Math.abs(blended.z - .3) < 1e-9);
  assert.ok(Math.abs(assistedReceivingInput({ x: -1, z: 0 }, player, { x: 10, z: 0 }, 5.8).x - 0.4) < 1e-9);
  const diagonal = assistedReceivingInput({ x: -1, z: -1 }, player, { x: 10, z: 0 }, 5.8);
  assert.ok(diagonal.x > 0 && diagonal.x < .7 && diagonal.z < 0 && Math.hypot(diagonal.x, diagonal.z) <= 1);
  assert.deepEqual(assistedReceivingInput({ x: 0.2, z: 0.3 }, player, null, 5.8), { x: 0.2, z: 0.3 });
});

test('70% idle assistance approaches and brakes at the receiving point at multiple frame rates', () => {
  for (const hz of [30, 60, 120]) {
    const p = { ...player, vx: 0, vz: 0, heading: 0 };
    let furthest = 0;
    for (let i = 0; i < hz * 3; i++) {
      advancePlayer(p, assistedReceivingInput({ x: 0, z: 0 }, p, { x: 3, z: 0 }, 5.8), 1 / hz);
      furthest = Math.max(furthest, p.x);
    }
    assert.ok(Math.abs(p.x - 3) < 0.1 && Math.abs(p.vx) < 0.05, JSON.stringify(p));
    assert.ok(furthest < 3.15);
  }
});

test('receiving forecast follows actual free flight and rolling physics on three surfaces', async () => {
  for (const surface of ['grass', 'astro', 'soil']) for (const airborne of [false, true]) {
    const start = { x: 0, y: airborne ? 1.8 : 0.11, z: 0 }, velocity = { x: 9, y: airborne ? 4 : 0, z: 1 };
    const spin = { x: 0, y: 0, z: -6 };
    const forecast = receivingPath(start, velocity, spin, surface, 0.6).at(-1);
    const physics = await createMatchPhysics({ length: 71, width: 45, goalWidth: 7.32, goalHeight: 2.44, surface });
    let p = { ...start }, v = { ...velocity };
    physics.reset(p, v, spin);
    for (let i = 0; i < 36; i++) { const next = physics.step(1 / 60, p, v); p = next.position; v = next.velocity; }
    assert.ok(Math.hypot(p.x - forecast.x, p.z - forecast.z) < 0.25, `${surface} airborne=${airborne}: ${JSON.stringify({ p, forecast })}`);
    assert.ok(Math.abs(p.y - forecast.y) < 0.25);
    physics.free();
  }
});

test('interception ignores high/fast/out-of-play samples and stale past points', () => {
  const path = [{ x: 1, y: 2, z: 0, t: .1, speed: 5 }, { x: 2, y: .11, z: 0, t: .2, speed: 22 },
    { x: 3, y: .11, z: 0, t: .6, speed: 6 }, { x: 40, y: .11, z: 0, t: 1, speed: 5 }];
  assert.equal(receivingPoint(player, path, 5.8, field).x, 3);
  assert.equal(receivingPoint(player, path, 5.8, field, .7), null);
});

test('throw-ins aim inward from either touchline, stay in range and produce an overhead arc', () => {
  for (const side of [-1, 1]) for (const power of [0, .5, 1]) for (const aim of [{ x: 10, z: 0 }, { x: 100, z: side * 100 }, { x: 0, z: side * 22.4 }]) {
    const spot = { x: 0, z: side * 22.4 }, plan = throwInPlan(spot, aim, power, field);
    const distance = Math.hypot(plan.target.x - spot.x, plan.target.z - spot.z);
    assert.ok(distance <= 22.001 && distance >= 3.999);
    assert.ok(Math.abs(plan.target.z) < 22.5 && (plan.target.z - spot.z) * side < 0);
    const ground = { x: (plan.target.x - spot.x) / distance * plan.speed, z: (plan.target.z - spot.z) / distance * plan.speed };
    const y = liftFor({ from: plan.origin, ground, spin: plan.spin(), distance, height: plan.height, minLift: plan.minLift });
    const path = flight(plan.origin, { ...ground, y }, plan.spin(), { distance });
    assert.ok(Math.max(...path.points.map(p => p.y)) > 1.85);
    assert.ok(Math.hypot(path.position.x - plan.target.x, path.position.z - plan.target.z) < .35, JSON.stringify({ plan, end: path.position }));
  }
});
