import { groundPassSpeed, liftFor } from './ballistics.js';
import { groundPassProfile, pickPassTarget } from './gameplay.js';

export const PASSING_MODES = [
  { value: 'assisted', label: 'Assisted', description: 'AI corrects your aim and weights the pass or cross for the receiver.' },
  { value: 'semi', label: 'Semi', description: 'Some help toward nearby teammates. Your stick aim and button hold strongly affect the delivery.' },
  { value: 'manual', label: 'Manual', description: 'No aim or power correction. Aim with the stick and hold the button to set power.' },
];
export const passingMode = value => PASSING_MODES.some(mode => mode.value === value) ? value : 'assisted';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;

// Select and weight a delivery once, at release. Manual launches never consult
// teammates or opponents; flight and ground collisions still obey physics.
export function planPass({ mode = 'assisted', origin, direction, power = 0, players = [], opponents = [], controlled = -1,
  surface = 'grass', lofted = false, crossing = false, through = false, zone = null, selectionOnly = false }) {
  mode = passingMode(mode);
  power = clamp(power, 0, 1);
  const size = Math.hypot(direction.x, direction.z) || 1;
  const raw = { x: direction.x / size, z: direction.z / size };
  const profile = groundPassProfile(power), reach = lofted ? 10 + power * 38 : profile.range;
  let receiver = -1, target = null;
  if (mode !== 'manual') {
    const candidates = mode === 'assisted' ? players : players.filter(p => {
      const dx = p.x - origin.x, dz = p.z - origin.z, distance = Math.hypot(dx, dz);
      return distance > 0 && distance < reach * 1.5 + 3 && (dx * raw.x + dz * raw.z) / distance >= Math.cos(Math.PI / 8);
    });
    if (mode === 'assisted' && crossing && zone) {
      const eligible = candidates.filter(p => p.home && !p.keeper && p.index !== controlled);
      eligible.sort((a, b) => Math.hypot(a.x - zone.x, a.z - zone.z) - Math.hypot(b.x - zone.x, b.z - zone.z));
      receiver = eligible[0]?.index ?? -1; target = { ...zone };
    } else {
      receiver = pickPassTarget(candidates, origin, raw, controlled, opponents,
        { maxDistance: mode === 'assisted' ? 55 : reach * 1.5 + 3, preferredDistance: reach });
      const mate = candidates.find(p => p.index === receiver);
      if (mate) target = { x: mate.x + (mate.vx || 0) * .35 + (through ? 2.5 : 0), z: mate.z + (mate.vz || 0) * .35 };
    }
  }
  if (selectionOnly) return { receiver };
  const weight = mode === 'assisted' ? 1 : mode === 'semi' ? .3 : 0;
  const rawAngle = Math.atan2(raw.z, raw.x);
  let angle = rawAngle;
  if (target) {
    const wanted = Math.atan2(target.z - origin.z, target.x - origin.x);
    const correction = Math.atan2(Math.sin(wanted - rawAngle), Math.cos(wanted - rawAngle));
    angle += mode === 'assisted' ? correction : clamp(correction * weight, -.1, .1);
  }
  const aim = { x: Math.cos(angle), z: Math.sin(angle) };
  const distance = target ? Math.hypot(target.x - origin.x, target.z - origin.z) : reach;
  const automaticSpeed = lofted ? clamp(distance / clamp(1 + distance * .03, 1.1, 2.5) * (1.05 + distance * .005), 8, 32)
    : groundPassSpeed(distance, surface, through ? 3.5 : 3.5 + power * 4);
  const manualSpeed = lofted ? 10 + power * 18 : profile.speed;
  const speed = target ? mix(manualSpeed, automaticSpeed, weight) : manualSpeed;
  const spin = lofted ? { x: -aim.z * 14, y: 0, z: aim.x * 14 } : { x: aim.z * 6, y: 0, z: -aim.x * 6 };
  let lift = lofted ? 5 + power * 7 : 0;
  if (lofted && target) {
    const autoLift = liftFor({ from: origin, ground: { x: aim.x * speed, z: aim.z * speed }, spin,
      distance, height: crossing ? 1.5 : .35, minLift: 3 });
    lift = mix(lift, autoLift, weight);
  }
  // Semi's landing/receiving point follows the partially corrected aim, so
  // the recipient cannot secretly turn an inaccurate pass into a perfect one.
  const travel = target ? mix(reach, distance, weight) : reach;
  const destination = mode === 'assisted' && target ? target : { x: origin.x + aim.x * travel, z: origin.z + aim.z * travel };
  return { receiver, direction: aim, destination, speed, lift, spin,
    velocity: { x: aim.x * speed, y: lift, z: aim.z * speed }, mode };
}
