import { GAMEPAD_BUTTONS } from './gamepad.js';
import { passingMode } from './passing.js';

export const KEYBOARD_PRESETS = Object.freeze({
  classic: Object.freeze({ up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', pass: 's', through: 'w', shoot: 'd', lob: 'a', sprint: 'e', switch: 'q', shield: 'c', finesse: 'z', slide: 's', tackle: 'd', teammate: 'shift', jockey: 'capslock', keeperRush: 'a', skill: 'x' }),
  wasd: Object.freeze({ up: 'w', down: 's', left: 'a', right: 'd', pass: 'j', through: 'i', shoot: 'k', lob: 'l', sprint: 'e', switch: 'q', shield: 'c', finesse: 'z', slide: 'j', tackle: 'k', teammate: 'shift', jockey: 'capslock', keeperRush: 'u', skill: 'o' }),
});

export const DEFAULT_PREFERENCES = Object.freeze({
  passingAssistance: 'assisted',
  keyboardPreset: 'classic',
  keyboard: KEYBOARD_PRESETS.classic,
  gamepad: GAMEPAD_BUTTONS,
  touch: { joystick: 'left', actions: 'right', size: 1 },
  hud: { player: true, radar: true, hints: true, score: true, messages: true, sound: true, music: true, commentary: true, vibration: true },
  musicTrack: 'amapiano',
});

const STORAGE_KEY = 'legon-football-preferences-v2';
const PREVIOUS_STORAGE_KEY = 'legon-football-preferences-v1';
const allowedPosition = value => ['left', 'center', 'right'].includes(value) ? value : 'left';
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function normalizePreferences(value = {}) {
  const keyboardPreset = value.keyboardPreset === 'wasd' ? 'wasd' : 'classic';
  const preset = KEYBOARD_PRESETS[keyboardPreset];
  return {
    passingAssistance: passingMode(value.passingAssistance),
    keyboardPreset,
    keyboard: Object.fromEntries(Object.keys(preset).map(action => [action, typeof value.keyboard?.[action] === 'string' ? value.keyboard[action].toLowerCase() : preset[action]])),
    gamepad: Object.fromEntries(Object.entries(GAMEPAD_BUTTONS).map(([action, index]) => [action, Number.isInteger(value.gamepad?.[action]) && value.gamepad[action] >= 0 && value.gamepad[action] <= 16 ? value.gamepad[action] : index])),
    touch: { joystick: allowedPosition(value.touch?.joystick), actions: allowedPosition(value.touch?.actions || 'right'), size: clamp(value.touch?.size, 0.75, 1.25, 1) },
    hud: Object.fromEntries(Object.keys(DEFAULT_PREFERENCES.hud).map(key => [key, value.hud?.[key] !== false])),
    musicTrack: ['amapiano', 'anthem'].includes(value.musicTrack) ? value.musicTrack : 'amapiano',
  };
}

export function readPreferences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizePreferences(JSON.parse(saved));
    const previous = JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY) || '{}');
    return normalizePreferences(previous);
  }
  catch { return normalizePreferences(); }
}

export function savePreferences(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePreferences(value))); }
  catch { /* Private browsing may disable local storage. */ }
}

export function keyLabel(key) {
  return ({ arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', shift: 'SHIFT', capslock: 'CAPS LOCK', control: 'CTRL', ' ': 'SPACE' })[key] || key.toUpperCase();
}
