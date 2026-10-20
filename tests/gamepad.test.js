import test from 'node:test';
import assert from 'node:assert/strict';
import { gamepadFamily, readGamepad } from '../src/gamepad.js';

test('standard controller maps the same physical positions across brands', () => {
  const pad = { connected: true, id: 'Xbox Wireless Controller', mapping: 'standard', axes: [0.8, -0.6, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  pad.buttons[0].pressed = true;
  pad.buttons[7].value = 0.6;
  const snapshot = readGamepad(pad);
  assert.equal(snapshot.family, 'Xbox');
  assert.equal(snapshot.actions.pass, true);
  assert.equal(snapshot.actions.sprint, true);
  assert.equal(snapshot.actions.shoot, false);
  assert.equal(snapshot.x, 0.8);
  assert.equal(snapshot.z, -0.6);
  assert.equal(gamepadFamily('DualSense Wireless Controller'), 'PlayStation');
  assert.equal(gamepadFamily('USB Gamepad'), 'Generic');
  assert.equal(readGamepad({ connected: false }), null);
});

test('custom gamepad bindings change the action without changing stick movement', () => {
  const pad = { connected: true, id: 'DualSense', mapping: 'standard', axes: [-0.5, 0.4, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  pad.buttons[2].pressed = true;
  const result = readGamepad(pad, { pass: 2 });
  assert.equal(result.actions.pass, true);
  assert.equal(result.actions.lob, true);
  assert.equal(result.x, -0.5);
  assert.equal(result.z, 0.4);
});
