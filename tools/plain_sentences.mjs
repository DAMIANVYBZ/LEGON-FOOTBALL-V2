// Commentary sentences without names (team/venue/score/player), with their delivery style:
// the set a recorded or cloned voice needs. node tools/plain_sentences.mjs > plain.json
import { EVENTS, GOAL_MOMENTS, splitSentences } from '../src/commentary.js';

const sentences = new Map();
const add = (line, style) => { for (const text of splitSentences(line)) if (!text.includes('{')) sentences.set(text + '|' + style, { text, style }); };
for (const spec of Object.values(EVENTS)) for (const line of spec.lines) add(line, spec.excited ? 'excited' : 'calm');
for (const lines of Object.values(GOAL_MOMENTS)) for (const line of lines) add(line, 'excited');
process.stdout.write(JSON.stringify([...sentences.values()]));
