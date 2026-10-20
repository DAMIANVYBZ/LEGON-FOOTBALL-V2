import test from 'node:test';
import assert from 'node:assert/strict';
import { gamepadFamily, readGamepad } from '../src/gamepad.js';

test('standard controller maps the same physical positions across brands', () => {
  const pad = { connected: true, id: 'Xbox Wireless Controller', mapping: 'standard', axes: [0.8, -0.6, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  pad.buttons[0].pressed = true;
  pad.buttons[7].value = 0.6;
  const snapshot = readGamepad(pad);
  assert.equal(snapshot.family, 'Xbox');
  assert.equal(snapshot.actions.cross, true);
  assert.equal(snapshot.actions.r2, true);
  assert.equal(snapshot.actions.square, false);
  assert.equal(snapshot.x, 0.8);
  assert.equal(snapshot.z, -0.6);
  assert.equal(gamepadFamily('DualSense Wireless Controller'), 'PlayStation');
  assert.equal(gamepadFamily('USB Gamepad'), 'Generic');
  assert.equal(readGamepad({ connected: false }), null);
});

test('custom gamepad bindings change the action without changing stick movement', () => {
  const pad = { connected: true, id: 'DualSense', mapping: 'standard', axes: [-0.5, 0.4, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  pad.buttons[2].pressed = true;
  const result = readGamepad(pad, { cross: 2 });
  assert.equal(result.actions.cross, true);
  assert.equal(result.actions.square, true);
  assert.equal(result.x, -0.5);
  assert.equal(result.z, 0.4);
});

test('the D-pad moves, including generic pads that report it as a hat axis', async () => {
  const { readDpad } = await import('../src/gamepad.js');
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  buttons[15].pressed = true; buttons[12].pressed = true;
  assert.deepEqual(readDpad({ mapping: 'standard', buttons, axes: [0, 0, 0, 0] }), { x: 1, z: -1 });
  const hat = value => readDpad({ mapping: '', buttons: [], axes: [0, 0, 0, 0, 0, value] });
  assert.deepEqual(hat(-1), { x: 0, z: -1 });          // up
  assert.deepEqual(hat(-1 + 2 / 7 * 2), { x: 1, z: 0 }); // right
  assert.deepEqual(hat(-1 + 2 / 7 * 4), { x: 0, z: 1 }); // down
  assert.deepEqual(hat(3.28), { x: 0, z: 0 });         // released
  const pad = { connected: true, id: 'USB Gamepad', mapping: '', axes: [0, 0, 0, 0, 0, -1], buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })) };
  assert.equal(readGamepad(pad).z, -1);
});

test('a real controller is chosen over other devices Windows lists as gamepads', async () => {
  const { activeGamepad } = await import('../src/gamepad.js');
  const button = pressed => ({ pressed, value: pressed ? 1 : 0 });
  const receiver = { index: 0, connected: true, id: 'Wireless Receiver', mapping: '', axes: [0, 0], buttons: [button(false)] };
  const xbox = { index: 1, connected: true, id: 'Xbox Controller', mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => button(false)) };
  assert.equal(activeGamepad([receiver, xbox]), xbox);
  assert.equal(activeGamepad([null, receiver]), null);
});
