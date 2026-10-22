export const RUN_PACE = Object.freeze({ jog: 5.8, sprint: 8.1, controlled: 8.1 * .75,
  dribble: 4.7, dribbleSprint: 7.8, dribbleControlled: 7.8 * .75 });

export function dribbleTouchProfile({ sprint = false, controlledSprint = false } = {}) {
  if (sprint && controlledSprint) return { interval: .14, lead: .30, pushMax: 1.05, recovery: .9, pace: RUN_PACE.dribbleControlled };
  if (sprint) return { interval: .24, lead: .62, pushMax: 2.6, recovery: 2.1, pace: RUN_PACE.dribbleSprint };
  return { interval: .23, lead: .32, pushMax: 1.5, recovery: .7, pace: RUN_PACE.dribble };
}
