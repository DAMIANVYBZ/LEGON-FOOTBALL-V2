export const RUN_PACE = Object.freeze({ jog: 5.8, sprint: 8.1, controlled: 8.1 * .75,
  dribble: 4.7, dribbleSprint: 7.8, dribbleControlled: 7.8 * .75 });

export function dribbleTouchProfile({ sprint = false, controlledSprint = false } = {}) {
  if (sprint && controlledSprint) return { interval: .14, lead: .30, pushMax: 1.05, recovery: .9, pace: RUN_PACE.dribbleControlled };
  if (sprint) return { interval: .24, lead: .62, pushMax: 2.6, recovery: 2.1, pace: RUN_PACE.dribbleSprint };
  return { interval: .23, lead: .32, pushMax: 1.5, recovery: .7, pace: RUN_PACE.dribble };
}

// Movement model. Acceleration falls off as a player approaches top speed, so
// getting to full sprint takes about two seconds instead of a third of one;
// changing direction is limited by a sideways-acceleration budget, so a
// sprinting player has a real turning circle (about 6 m at full sprint).
export const MOVEMENT = Object.freeze({
  // m/s^2 at a standstill, per movement mode (scaled by the player's acceleration attribute)
  accel: Object.freeze({ jog: 8.5, sprint: 9, controlled: 9.5, keeper: 7 }),
  // acceleration reaches zero at this speed (m/s)
  accelZeroAt: 10.5,
  accelFloor: 0.12, // never drop below this share of the standstill acceleration
  brake: Object.freeze({ normal: 12, controlled: 14 }), // slowing along the line of travel
  reverse: Object.freeze({ normal: 9, controlled: 11 }), // pushing back against the direction of travel
  idleBrake: 14, // no input at all
  // largest sideways acceleration (m/s^2): speed^2 / radius. Scaled by the agility attribute.
  lateral: Object.freeze({ normal: 13, sprint: 10.5, controlled: 15 }),
  // heading (visual facing) turn rate in rad/s at a standstill, falling with speed
  turn: Object.freeze({ normal: 11, controlled: 14, speedLoss: 0.6 }),
});
