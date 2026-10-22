// Per-player attributes, 0-1 (0.5 is an average club player). They replace the
// old "everyone is identical, one team-wide multiplier" model: each footballer
// has their own pace, acceleration, agility, strength, dribbling, passing,
// finishing, tackling, stamina and (for keepers) handling. All of them are
// deterministic for a given team name, so a hall's players keep the same
// identities from match to match.
import { createRandom } from './keeper.js';

export const ATTRIBUTE_KEYS = ['pace', 'acceleration', 'agility', 'strength', 'dribbling', 'passing', 'finishing', 'tackling', 'stamina', 'handling'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Typical profile of each position group before individual variation.
const PROFILES = {
  GK: { pace: 0.45, acceleration: 0.5, agility: 0.6, strength: 0.6, dribbling: 0.35, passing: 0.55, finishing: 0.3, tackling: 0.3, stamina: 0.6, handling: 0.72 },
  DEF: { pace: 0.55, acceleration: 0.55, agility: 0.52, strength: 0.72, dribbling: 0.48, passing: 0.55, finishing: 0.38, tackling: 0.75, stamina: 0.66, handling: 0.4 },
  MID: { pace: 0.6, acceleration: 0.62, agility: 0.66, strength: 0.58, dribbling: 0.66, passing: 0.73, finishing: 0.55, tackling: 0.6, stamina: 0.76, handling: 0.4 },
  FWD: { pace: 0.74, acceleration: 0.74, agility: 0.7, strength: 0.54, dribbling: 0.72, passing: 0.6, finishing: 0.76, tackling: 0.38, stamina: 0.62, handling: 0.4 },
};

// role 0 is the keeper; outfield roles run from the back row to the front row
// of the formation, so the position group follows from how far up the pitch
// the role starts.
export function positionGroup(role, teamSize) {
  if (role === 0) return 'GK';
  const outfield = Math.max(1, teamSize - 1);
  const share = (role - 1) / Math.max(1, outfield - 1);
  return share < 0.34 ? 'DEF' : share < 0.67 ? 'MID' : 'FWD';
}

export function hashSeed(text = '') {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

// quality shifts the whole side up or down (about +-0.1 is a clear gap).
export function createAttributes(role, teamSize, { seed = 1, quality = 0 } = {}) {
  const profile = PROFILES[positionGroup(role, teamSize)];
  const random = createRandom((seed + role * 7919) >>> 0);
  const result = {};
  for (const key of ATTRIBUTE_KEYS) {
    const jitter = (random() + random() - 1) * 0.2; // triangular, +-0.2
    result[key] = clamp(profile[key] + quality + jitter, 0.2, 0.95);
  }
  return result;
}

export const createTeamAttributes = (teamSize, options) => Array.from({ length: teamSize }, (_, role) => createAttributes(role, teamSize, options));

// Gameplay factors. Each maps a 0-1 attribute to a modest multiplier, so a
// spread of attributes is visible but never turns anyone superhuman.
const mid = attrs => key => attrs?.[key] ?? 0.6;
export const paceFactor = attrs => 0.94 + 0.12 * mid(attrs)('pace');             // 0.94 - 1.06 of top speed
export const accelerationFactor = attrs => 0.78 + 0.5 * mid(attrs)('acceleration'); // 0.78 - 1.28
export const agilityFactor = attrs => 0.8 + 0.4 * mid(attrs)('agility');         // 0.8 - 1.2 of turning ability
export const finishingAccuracy = attrs => 0.7 + 0.8 * mid(attrs)('finishing');   // 0.7 - 1.5 (divides shot error)
export const staminaFactor = attrs => 0.75 + 0.5 * mid(attrs)('stamina');        // 0.75 - 1.25 (drain divisor, recovery multiplier)
export const handlingFactor = attrs => 0.92 + 0.16 * mid(attrs)('handling');     // 0.92 - 1.08 of keeper reach
export const looseTouchChance = attrs => clamp(1 - mid(attrs)('dribbling'), 0, 0.8); // 0 - 0.8
export const passError = attrs => (1.15 - mid(attrs)('passing')) * 0.035;        // radians of standard deviation

// Chance that a standing tackle wins the ball once the geometry allows it.
// tackling and strength against the carrier's dribbling and strength.
export function tackleChance({ tackler, carrier, shielding = false, front = true } = {}) {
  const a = mid(tackler), b = mid(carrier);
  const base = 0.58 + 0.45 * (a('tackling') - b('dribbling')) + 0.2 * (a('strength') - b('strength'));
  return clamp(base - (shielding ? 0.12 : 0) - (front ? 0 : 0.1), 0.15, 0.88);
}
