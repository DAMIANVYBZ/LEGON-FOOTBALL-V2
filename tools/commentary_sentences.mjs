// Every sentence the match commentary can say (without player usernames), with the delivery style
// it needs. Used to pre-render natural voice clips: node tools/commentary_sentences.mjs > sentences.json
import { EVENTS, GOAL_MOMENTS, scoreLine, resultLine, splitSentences } from '../src/commentary.js';
import { TEAMS, teamShort } from '../src/teams.js';
import { VENUES } from '../src/venues.js';

const teams = [...new Set(TEAMS.map(team => teamShort(team.name)))];
const venues = [...new Set(VENUES.map(venue => venue.shortName))];
const MAX_GOALS = 5;

const scores = new Set(), results = new Set();
for (const home of teams) for (const away of teams) {
  if (home === away) continue;
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) {
    scores.add(scoreLine(home, away, [h, a]));
    results.add(resultLine(home, away, [h, a]));
  }
}

const VALUES = { team: teams, home: teams, away: teams, venue: venues, score: [...scores], result: [...results] };

// Expand one sentence template over every value of its placeholders (home and away never the same side).
function expand(sentence) {
  const keys = [...new Set([...sentence.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
  if (keys.includes('who')) return [];   // only spoken for real usernames: left to the live voice
  let out = [{ text: sentence, used: {} }];
  for (const key of keys) {
    const next = [];
    for (const item of out) for (const value of VALUES[key] || []) {
      if ((key === 'away' && item.used.home === value) || (key === 'home' && item.used.away === value)) continue;
      next.push({ text: item.text.split(`{${key}}`).join(value), used: { ...item.used, [key]: value } });
    }
    out = next;
  }
  return out.map(item => item.text.replace(/\s+/g, ' ').trim());
}

const sentences = new Map();   // text|style -> { text, style }
function add(line, style) {
  for (const template of splitSentences(line)) for (const text of expand(template)) sentences.set(text + '|' + style, { text, style });
}
for (const spec of Object.values(EVENTS)) for (const line of spec.lines) add(line, spec.excited ? 'excited' : 'calm');
for (const lines of Object.values(GOAL_MOMENTS)) for (const line of lines) add(line, 'excited');

const list = [...sentences.values()];
process.stdout.write(JSON.stringify(list));
process.stderr.write(`sentences ${list.length} (calm ${list.filter(s => s.style === 'calm').length}, excited ${list.filter(s => s.style === 'excited').length})\n`);
