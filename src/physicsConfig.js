// Real-world units throughout: metres, seconds, kilograms, radians.

// The match simulates at a fixed rate, so every device plays the same game at
// the same real-time speed. Rendering runs at whatever rate the screen allows.
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
// At most this many simulation steps per rendered frame. Below 7.5 fps the
// game slows down rather than freezing to catch up.
export const MAX_SIM_STEPS = 8;

export const BALL = {
  radius: 0.11,
  mass: 0.43, // FIFA size 5: 410-450 g
  airDensity: 1.2,
  // Drag coefficient falls at high speed (the "drag crisis"), so hard shots
  // hold their pace and then dip as they slow.
  dragLowSpeed: 0.45, dragHighSpeed: 0.25, dragCrisisStart: 12, dragCrisisEnd: 20,
  // Magnus lift coefficient = liftPerSpin x spin ratio (r x |omega| / |v|).
  liftPerSpin: 0.8, maxLift: 0.3,
  airSpinDecay: 0.05, // per second while airborne
  inertia: 2 / 3, // I / (mass * radius^2): a football is a thin shell
  // Google Research Football ball.cpp uses 0.62 restitution and subtracts
  // 0.06 m/s after impact. Surfaces below vary around this grass baseline.
  restitution: 0.62,
  bounceLoss: 0.06,
};

// Each campus surface plays differently: astroturf is fast and true, red earth
// is slower, livelier and kicks the ball off line on a bounce.
// rolling: deceleration of a rolling ball in m/s^2.
// sliding: friction coefficient while the contact point skids on the surface.
// bounceGrip: share of the horizontal speed kept when the ball lands.
// bounceScatter: maximum change of direction on a bounce, in radians.
export const SURFACES = {
  grass: { restitution: BALL.restitution, rolling: 1.6, sliding: 0.35, bounceGrip: 0.88, bounceScatter: 0 },
  worn: { restitution: 0.64, rolling: 1.8, sliding: 0.38, bounceGrip: 0.86, bounceScatter: 0.06 },
  mixed: { restitution: 0.65, rolling: 1.9, sliding: 0.4, bounceGrip: 0.85, bounceScatter: 0.1 },
  soil: { restitution: 0.68, rolling: 2.1, sliding: 0.45, bounceGrip: 0.82, bounceScatter: 0.16 },
  astro: { restitution: 0.66, rolling: 1.2, sliding: 0.3, bounceGrip: 0.92, bounceScatter: 0 },
};
export const surfaceFor = name => SURFACES[name] || SURFACES.grass;

export const GOAL = {
  postRadius: 0.06, // 12 cm round posts and crossbar
  postRestitution: 0.55,
  depth: 2, // net depth behind the goal line
};

// Spin given to the ball by each kind of contact, in radians per second.
// Topspin makes driven shots dip, backspin makes chips float and check up,
// side spin curls finesse shots.
export const KICK_SPIN = {
  pass: { top: 6, side: 0 },
  shot: { top: 18, side: 0 },
  powerShot: { top: 30, side: 0 },
  finesse: { top: 8, side: 45 },
  chip: { top: -40, side: 0 },
  cross: { top: -14, side: 12 },
  cpuShot: { top: 16, side: 10 },
};

// CPU behaviour per difficulty.
// pace: CPU outfielders' speed. keeper: CPU keeper's reach. shot: CPU shot speed.
// reaction: seconds between a CPU ball carrier's decisions. shotRange: how far
// out the CPU will shoot (m). accuracy: CPU aiming error (m).
// Tackles use reach and shielding geometry rather than a random success roll.
export const DIFFICULTY = {
  Easy: { pace: 0.9, pressDistance: 18, tackleCooldown: 2, kickoffGrace: 3, keeper: 0.9, shot: 0.9,
    reaction: 0.7, shotRange: 15, accuracy: 1.3 },
  Medium: { pace: 0.97, pressDistance: 26, tackleCooldown: 1.4, kickoffGrace: 2, keeper: 1, shot: 1,
    reaction: 0.5, shotRange: 18, accuracy: 0.85 },
  Hard: { pace: 1.04, pressDistance: 34, tackleCooldown: 1, kickoffGrace: 1, keeper: 1.08, shot: 1.08,
    reaction: 0.35, shotRange: 20, accuracy: 0.5 },
};

// Stamina, from 1 (fresh) to 0: sprinting drains it, jogging and standing
// restore it. A tired player's top speed drops by up to 10%.
export const STAMINA = { sprintDrain: 0.055, jogRecover: 0.03, restRecover: 0.06, minimumToSprint: 0.06, speedLoss: 0.1 };
export const difficultyFor = name => DIFFICULTY[name] || DIFFICULTY.Medium;
