import test from 'node:test';
import assert from 'node:assert/strict';
import { planPass } from '../src/passing.js';
import { flight } from '../src/ballistics.js';

const origin = { x: 0, y: .11, z: 0 }, direction = { x: 1, z: 0 };
const mate = (index, x, z = 0) => ({ index, x, z, home: true, keeper: false });
const plan = options => planPass({ origin, direction, controlled: 5, ...options });
test('Manual passes and crosses obey direction/power independently of teammates and marking', () => {
  for (const lofted of [false, true]) for (const power of [0, .35, 1]) {
    const a = plan({ mode: 'manual', power, lofted, direction: { x: 3, z: 4 } });
    const b = plan({ mode: 'manual', power, lofted, direction: { x: 3, z: 4 }, players: [mate(6, 25, 3)], opponents: [mate(12, 4, 2)] });
    assert.deepEqual(a, b); assert.equal(a.receiver, -1);
    assert.ok(Math.abs(a.velocity.z / a.velocity.x - 4 / 3) < 1e-9);
    assert.equal(a.spin.y, 0);
    if (lofted) {
      const path = flight(origin, a.velocity, a.spin);
      assert.ok(path.points.every(p => Math.abs(p.z * 3 - p.x * 4) < 1e-8), 'manual cross bent away from aim');
    }
  }
  assert.ok(plan({ mode: 'manual', power: 1 }).speed > plan({ mode: 'manual', power: 0 }).speed + 15);
});
test('Semi gives bounded aim/power correction while Assisted fully targets the receiver', () => {
  const players = [mate(6, 12, 3)], raw = plan({ mode: 'manual', power: .4, players });
  const semi = plan({ mode: 'semi', power: .4, players }), assisted = plan({ mode: 'assisted', power: .4, players });
  const bearing = p => Math.atan2(p.direction.z, p.direction.x);
  assert.equal(semi.receiver, 6); assert.equal(assisted.receiver, 6);
  assert.ok(bearing(raw) < bearing(semi) && bearing(semi) < bearing(assisted));
  assert.ok(bearing(semi) <= .1);
  assert.ok(Math.abs(bearing(assisted) - Math.atan2(3, 12)) < 1e-9);
  assert.ok(Math.abs(semi.speed - raw.speed) < Math.abs(assisted.speed - raw.speed));
});
test('Semi rejects teammates outside the aiming lane and charge selects nearer/further recipients', () => {
  assert.equal(plan({ mode: 'semi', players: [mate(6, 12, 12)] }).receiver, -1);
  const players = [mate(6, 8), mate(4, 30)];
  const short = plan({ mode: 'semi', power: 0, players }), long = plan({ mode: 'semi', power: 1, players });
  assert.equal(short.receiver, 6); assert.equal(long.receiver, 4); assert.ok(long.speed > short.speed + 10);
});
test('Assisted compensates a light pass for the recipient distance', () => {
  const near = plan({ power: 0, players: [mate(6, 6)] }), far = plan({ power: 0, players: [mate(6, 32)] });
  assert.equal(near.receiver, 6); assert.equal(far.receiver, 6);
  assert.ok(far.speed > near.speed + 4);
  assert.ok(far.speed > plan({ mode: 'manual', power: 0 }).speed + 4);
});
