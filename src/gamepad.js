// The browser's "standard" mapping uses the same face-button positions for
// Xbox, PlayStation and most PC controllers, regardless of their printed labels.
export const GAMEPAD_BUTTONS = Object.freeze({
  pass: 0, shoot: 1, lob: 2, through: 3,
  switch: 4, skill: 5, shield: 6, sprint: 7, pause: 9,
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
  return {
    family: gamepadFamily(pad.id),
    standard: pad.mapping === 'standard',
    x: deadzone(pad.axes?.[0]), z: deadzone(pad.axes?.[1]),
    rightX: deadzone(pad.axes?.[2]), rightZ: deadzone(pad.axes?.[3]),
    actions: Object.fromEntries(Object.entries(GAMEPAD_BUTTONS).map(([name, index]) => [name, button(mapping[name] ?? index)])),
  };
}
