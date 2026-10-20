// Feeling the big moments. A controller rumbles where the browser allows it
// (Chrome and Edge: DualSense, DualShock, Xbox and most pads; Firefox through
// hapticActuators), and a phone buzzes its vibration motor (Android). iPhones
// and keyboards have neither, so the game also shakes the camera (see Game.jsx).
export const HAPTIC_EFFECTS = Object.freeze({
  post: { strong: 1, weak: 0.8, duration: 260, pattern: [70, 40, 110] },
  goal: { strong: 0.55, weak: 1, duration: 500, pattern: [120, 60, 120, 60, 220] },
  net: { strong: 0.35, weak: 0.6, duration: 160, pattern: [50] },
});

// Returns true when some device was asked to vibrate.
export function vibrate(effect, pad = null, nav = globalThis.navigator) {
  const spec = HAPTIC_EFFECTS[effect];
  if (!spec) return false;
  const actuator = pad?.vibrationActuator;
  if (actuator?.playEffect) {
    actuator.playEffect('dual-rumble', { startDelay: 0, duration: spec.duration, strongMagnitude: spec.strong, weakMagnitude: spec.weak })
      .catch?.(() => {});
    return true;
  }
  const legacy = pad?.hapticActuators?.[0];
  if (legacy?.pulse) { legacy.pulse(spec.strong, spec.duration); return true; }
  if (typeof nav?.vibrate === 'function') {
    try { return nav.vibrate(spec.pattern); } catch { return false; }
  }
  return false;
}
