// Every spoken piece the commentary needs when it is stitched from recorded clips: each hall/venue name
// (with the punctuation that follows it) and each piece of text between names, per delivery style.
// node tools/speech_tokens.mjs > tokens.json   ->  { names: [...], calm: [...], excited: [...] }
import { EVENTS, GOAL_MOMENTS, scoreLine, resultLine, splitSentences, speechTokens } from '../src/commentary.js';
import { TEAMS, teamShort } from '../src/teams.js';
import { VENUES } from '../src/venues.js';

const teams = [...new Set(TEAMS.map(team => teamShort(team.name)))];
const venues = [...new Set(VENUES.map(venue => venue.shortName))];
const names = [...teams, ...venues];
const MAX_GOALS = 6;
const scores = new Set(), results = new Set();
for (const home of teams) for (const away of teams) if (home !== away)
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) { scores.add(scoreLine(home, away, [h, a])); results.add(resultLine(home, away, [h, a])); }
const VALUES = { team: teams, who: teams, home: teams, away: teams, venue: venues, score: [...scores], result: [...results] };

function expand(sentence) {
  const keys = [...new Set([...sentence.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
  let out = [{ text: sentence, used: {} }];
  for (const key of keys) {
    const next = [];
    for (const item of out) for (const value of VALUES[key] || []) {
      if ((key === 'away' && item.used.home === value) || (key === 'home' && item.used.away === value)) continue;
      // {who} is the hall when there is no username: keep it the same hall as {team}.
      if ((key === 'who' && item.used.team && item.used.team !== value) || (key === 'team' && item.used.who && item.used.who !== value)) continue;
      next.push({ text: item.text.split(`{${key}}`).join(value), used: { ...item.used, [key]: value } });
    }
    out = next;
  }
  return out.map(item => item.text.replace(/\s+/g, ' ').trim());
}

const pieces = { calm: new Set(), excited: new Set() }, nameTokens = { calm: new Set(), excited: new Set() };
let sentences = 0;
function add(line, style) {
  for (const template of splitSentences(line)) for (const text of expand(template)) {
    sentences++;
    for (const token of speechTokens(text, names)) (token.name ? nameTokens : pieces)[style].add(token.text);
  }
}
for (const spec of Object.values(EVENTS)) for (const line of spec.lines) add(line, spec.excited ? 'excited' : 'calm');
for (const lines of Object.values(GOAL_MOMENTS)) for (const line of lines) add(line, 'excited');
const out = { names, calm: [...pieces.calm, ...nameTokens.calm], excited: [...pieces.excited, ...nameTokens.excited] };
process.stdout.write(JSON.stringify(out));
process.stderr.write(`sentences ${sentences}; calm pieces ${pieces.calm.size} + names ${nameTokens.calm.size}; excited pieces ${pieces.excited.size} + names ${nameTokens.excited.size}\n`);
