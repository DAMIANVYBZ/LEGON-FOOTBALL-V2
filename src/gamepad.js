// The browser's "standard" mapping uses the same face-button positions for
// Xbox, PlayStation and most PC controllers, regardless of their printed labels.
// Physical buttons, named by their PlayStation symbols (Xbox: A, B, X, Y,
// LB, RB, LT, RT, LS, RS). What each does depends on attacking or defending,
// following the EA FC classic layout (see Game.jsx pollGamepad).
export const GAMEPAD_BUTTONS = Object.freeze({
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7, pause: 9, l3: 10, r3: 11,
});

export function gamepadFamily(id = '') {
  if (/playstation|dualshock|dualsense|sony|054c/i.test(id)) return 'PlayStation';
  if (/xbox|xinput|microsoft|045e/i.test(id)) return 'Xbox';
  return 'Generic';
}

export function readGamepad(pad, mapping = GAMEPAD_BUTTONS) {
  if (!pad?.connected) return null;
  const button = index => {
    const value = pad.buttons?.[index];
    return Boolean(value?.pressed || value?.value > 0.35);
  };
  const deadzone = value => Math.abs(value || 0) < 0.16 ? 0 : value;
  const dpad = readDpad(pad);
  return {
    family: gamepadFamily(pad.id),
    standard: pad.mapping === 'standard',
    // The D-pad moves too; the left stick wins when both are used.
    x: deadzone(pad.axes?.[0]) || dpad.x, z: deadzone(pad.axes?.[1]) || dpad.z,
    rightX: deadzone(pad.axes?.[2]), rightZ: deadzone(pad.axes?.[3]),
    actions: Object.fromEntries(Object.entries(GAMEPAD_BUTTONS).map(([name, index]) => [name, button(mapping[name] ?? index)])),
  };
}

// D-pad direction: buttons 12-15 on standard controllers; many generic USB
// pads report it instead as one "hat" axis stepping from -1 to 1 clockwise.
export function readDpad(pad) {
  const button = index => Boolean(pad.buttons?.[index]?.pressed);
  if (pad.mapping === 'standard') return { x: button(15) - button(14), z: button(13) - button(12) };
  const hat = pad.axes?.length > 4 ? pad.axes[pad.axes.length - 1] : undefined;
  if (hat === undefined || hat < -1.05 || hat > 1.05) return { x: 0, z: 0 };
  const angle = Math.round((hat + 1) / (2 / 7)) * Math.PI / 4; // 0 = up, clockwise
  return { x: Math.round(Math.sin(angle)) || 0, z: -Math.round(Math.cos(angle)) || 0 };
}

// Windows lists some keyboards, mice, receivers and headsets as gamepads too.
// Prefer a real controller (standard layout, enough buttons), and among those
// the one used most recently.
let lastActive = -1;
export function activeGamepad(pads) {
  // Read inside the body: as a default parameter, the build tool mistranslates
  // this optional call and every controller check fails in production.
  const list = pads || (typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()) : []);
  const candidates = list.filter(pad => pad?.connected && (pad.buttons?.length || 0) >= 4 && (pad.axes?.length || 0) >= 2);
  const touched = candidates.find(pad => pad.buttons.some(b => b.pressed) || pad.axes.slice(0, 4).some(v => Math.abs(v) > 0.5));
  if (touched) lastActive = touched.index;
  const remembered = candidates.find(pad => pad.index === lastActive);
  if (remembered) return remembered;
  return candidates.sort((a, b) => (b.mapping === 'standard') - (a.mapping === 'standard') || b.buttons.length - a.buttons.length)[0] || null;
}
