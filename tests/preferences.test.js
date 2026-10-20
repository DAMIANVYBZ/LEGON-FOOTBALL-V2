import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYBOARD_PRESETS, normalizePreferences } from '../src/preferences.js';

test('classic arrows leave S W D A available for football actions', () => {
  const prefs = normalizePreferences();
  assert.equal(prefs.keyboard.up, 'arrowup');
  assert.deepEqual([prefs.keyboard.pass, prefs.keyboard.through, prefs.keyboard.shoot, prefs.keyboard.lob], ['s', 'w', 'd', 'a']);
  assert.deepEqual(Object.values(prefs.keyboard).slice(0, 4), Object.values(KEYBOARD_PRESETS.classic).slice(0, 4));
});

test('saved touch and HUD choices are retained while invalid values are bounded', () => {
  const prefs = normalizePreferences({ keyboardPreset: 'wasd', touch: { joystick: 'right', actions: 'left', size: 2, opacity: -1 }, hud: { player: false } });
  assert.equal(prefs.keyboard.up, 'w');
  assert.equal(prefs.touch.joystick, 'right');
  assert.equal(prefs.touch.actions, 'left');
  assert.equal(prefs.touch.size, 1.25);
  assert.equal(prefs.touch.opacity, 0.08);
  assert.equal(prefs.hud.player, false);
  assert.equal(prefs.hud.score, true);
});

test('menu music defaults to the amapiano track and keeps a valid choice', async () => {
  const { normalizePreferences } = await import('../src/preferences.js');
  assert.equal(normalizePreferences().musicTrack, 'amapiano');
  assert.equal(normalizePreferences({ musicTrack: 'anthem' }).musicTrack, 'anthem');
  assert.equal(normalizePreferences({ musicTrack: 'highlife' }).musicTrack, 'amapiano');
});
