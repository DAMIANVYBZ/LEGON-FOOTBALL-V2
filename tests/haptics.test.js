import test from 'node:test';
import assert from 'node:assert/strict';
import { vibrate } from '../src/haptics.js';

test('a controller rumbles through its vibration actuator', () => {
  const calls = [];
  const pad = { vibrationActuator: { playEffect: (type, params) => { calls.push([type, params]); return Promise.resolve(); } } };
  assert.equal(vibrate('post', pad, {}), true);
  assert.equal(calls[0][0], 'dual-rumble');
  assert.equal(calls[0][1].strongMagnitude, 1);
});

test('without a controller a phone vibrates, and nothing breaks without either', () => {
  const patterns = [];
  assert.equal(vibrate('goal', null, { vibrate: pattern => { patterns.push(pattern); return true; } }), true);
  assert.ok(patterns[0].length > 1);
  assert.equal(vibrate('goal', null, {}), false);
  assert.equal(vibrate('unknown', null, {}), false);
});
