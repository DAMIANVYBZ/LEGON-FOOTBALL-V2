const lerp = (a, b, t) => a + (b - a) * t;
const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Keep only recent snapshots, at 30 Hz. Values are captured from the live
// match; playback interpolates them without touching the match simulation.
export function createGoalRecorder(seconds = 6, hz = 30) {
  let frames = [], nextAt = 0;
  return {
    wants(time) { return time + 1e-6 >= nextAt; },
    push(time, frame) {
      nextAt = time + 1 / hz;
      frames.push({ ...frame, t: time });
      while (frames.length > 1 && frames[0].t < time - seconds) frames.shift();
    },
    clip() { return frames.slice(); },
    clear() { frames = []; nextAt = 0; },
  };
}

export function sampleGoalReplay(frames, time) {
  if (!frames.length) return null;
  const start = frames[0].t, at = start + Math.max(0, time);
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (frames[mid].t <= at) lo = mid; else hi = mid - 1; }
  const a = frames[lo], b = frames[Math.min(frames.length - 1, lo + 1)];
  const alpha = a === b ? 0 : Math.max(0, Math.min(1, (at - a.t) / (b.t - a.t)));
  return {
    ball: a.ball.map((v, i) => lerp(v, b.ball[i], alpha)),
    rotation: (alpha < .5 ? a : b).rotation,
    players: a.players.map((p, i) => {
      const q = b.players[i];
      return { x: lerp(p.x, q.x, alpha), z: lerp(p.z, q.z, alpha), heading: angleLerp(p.heading, q.heading, alpha),
        action: p.action, time: p.action === q.action && q.time >= p.time ? lerp(p.time, q.time, alpha) : p.time,
        visible: p.visible };
    }),
  };
}

export const GOAL_ANGLES = 3;
export const CELEBRATION_SECONDS = 6;

export function replayCamera(angle, ball, goalX, aspect = 1.5) {
  const sign = Math.sign(goalX) || 1, wide = aspect < 1 ? 1.5 : 1;
  const focus = { x: ball[0], y: Math.max(.8, ball[1]), z: ball[2] };
  if (angle === 1) return { focus,
    position: { x: goalX + sign * 9 * wide, y: 6 * wide, z: ball[2] * .3 + 6 * wide } };
  if (angle === 2) return { focus,
    position: { x: ball[0] - sign * 10 * wide, y: 4.5 * wide, z: ball[2] + 8 * wide } };
  return { focus, position: { x: ball[0] - sign * 3, y: 13 * wide, z: ball[2] + 19 * wide } };
}
