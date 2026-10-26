// Match commentary. Natural neural-voice clips (public/commentary, rendered by
// tools/render_commentary.py) are played sentence by sentence when present; any line
// without clips is spoken by the device's own voice (Web Speech API) instead.
import { publicAsset } from './publicAsset.js';

// Priority: 3 interrupts anything (goals, full time), 2 waits briefly for the
// current line, 1 is dropped when the commentator is already talking.
const EVENTS = {
  kickoff: { priority: 2, lines: [
    'And we are under way here at {venue}. {home} against {away}.',
    'The referee blows, and {home} get us started at {venue}.',
    'Campus football at {venue}. {home} and {away}, let us go!',
  ] },
  secondHalf: { priority: 2, lines: ['The second half is under way.', 'Here we go again. Second half at {venue}.'] },
  goal: { priority: 3, excited: true, lines: [
    'GOAL! {who}! That is the finish! {score}.',
    'YES! {who} puts it away! Listen to that! {score}.',
    'GOAL! {team} have done it! {score}.',
    '{who} finds the net! {team} have it! {score}.',
    'There it is! GOAL for {team}! {score}.',
    'It is in the back of the net! {team} celebrate! {score}.',
  ] },
  shot: { priority: 2, excited: true, lines: ['{who} shoots!', 'Here is the shot from {who}!', '{who} lets fly!', 'A strike from {who}!',
    'Here is the shot!', '{team} let fly!', 'He goes for it!', 'A chance for {team}!' ] },
  catch: { priority: 2, lines: ['Comfortable for the {team} keeper.', 'Straight into the keeper\'s hands.', 'Gathered safely by the {team} keeper.'] },
  save: { priority: 2, excited: true, lines: ['What a save!', 'Brilliant stop from the {team} keeper!', 'Denied! The keeper keeps it out!', 'Not this time! What a stop!' ] },
  punch: { priority: 2, lines: ['Punched clear by the {team} keeper.', 'The keeper rises and punches it away.'] },
  spill: { priority: 2, excited: true, lines: ['He has spilled it! Danger here!', 'Fumbled by the keeper! Can anyone pounce?'] },
  smother: { priority: 2, lines: ['Brave from the keeper, smothered at the feet.', 'The keeper comes out and claims it.'] },
  tackle: { priority: 1, lines: ['{who} steps in. Ball won!', '{who} reads it and wins it!', '{team} pinch it! Now they can break.', 'Well timed! {team} come away with it.', 'That is good defending. {team} have it.'] },
  penalty: { priority: 3, excited: true, lines: ['Penalty! The referee points to the spot for {team}!', 'It is a penalty to {team}!', 'Penalty! A big moment here for {team}.'] },
  woodwork: { priority: 2, excited: true, lines: ['Oh! Off the woodwork!', 'Back off the frame! It stays out!', 'The woodwork! They were that close!', 'It rattles the frame! Still alive!'] },
  yellowCard: { priority: 2, lines: ['A yellow card for {who}.', 'The referee goes to his pocket. Yellow for {team}.', 'Booked! {who} goes into the book.'] },
  redCard: { priority: 3, excited: true, lines: ['Red card! {who} is sent off!', 'Off he goes! {team} are a player down!' , 'That is a red card! A reckless challenge from {who}.'] },
  foul: { priority: 2, lines: ['Foul! Free kick to {team}.', 'The whistle goes. Free kick to {team}.', 'A clumsy challenge there. Free kick to {team}.'] },
  freeKickNear: { priority: 2, lines: ['A free kick in shooting range for {team}.', 'This is a dangerous position for {team}.'] },
  corner: { priority: 2, lines: ['Corner to {team}.', '{team} win a corner.', 'It is behind for a corner. {team} will take it.'] },
  goalKick: { priority: 1, lines: ['Goal kick for {team}.', 'The keeper will restart for {team}.', 'Out for a goal kick. {team} can reset.'] },
  wide: { priority: 2, lines: ['Off target! The chance is gone.', 'He cannot find the target!', 'They will want that chance back!', 'It stays out. A let-off for the defence.'] },
  throwIn: { priority: 1, lines: ['Throw-in to {team}.', 'Out for a throw. {team} have it.'] },
  keeperBall: { priority: 1, lines: ['The {team} keeper has it. Time to build from the back.', 'The keeper looks for a teammate.'] },
  sixSeconds: { priority: 1, lines: ['He has to release it now.'] },
  through: { priority: 1, lines: ['Lovely ball through for {who}!', 'Into the path of {who}!', 'Lovely ball through!', 'A pass splits the defence!', 'In behind goes {team}!'] },
  cross: { priority: 1, lines: ['The cross comes in!', 'Whipped into the box!', 'Delivered into the danger area!'] },
  inBox: { priority: 1, lines: ['{who} is into the box!', 'Into the area goes {who}!', '{team} are threatening now!', 'Into the box!', 'Danger for the defence now!'] },
  build: { priority: 1, lines: [
    '{who} on the ball for {team}.', '{who} carrying it forward.', 'Nice control from {who}.',
    '{team} move it on. Where is the opening?', '{team} looking for a way through.', 'They are being made to work for this, {team}.',
    'Here come {team}. Can they open them up?', '{team} have it. Now, who wants it?', '{team} taking the game forward.',
  ] },
  halfTime: { priority: 3, lines: ['That is half-time. {score}.', 'The referee blows for the break. {score}.'] },
  fullTime: { priority: 3, lines: ['That is full-time! {result}', 'It is all over at {venue}! {result}'] },
};

const nil = n => n === 0 ? 'nil' : String(n);
export function scoreLine(home, away, [h, a]) {
  if (h === a) return h === 0 ? 'Still goalless' : `${nil(h)} all`;
  return h > a ? `${home} lead ${nil(h)}, ${nil(a)}` : `${away} lead ${nil(a)}, ${nil(h)}`;
}
export function resultLine(home, away, [h, a]) {
  if (h === a) return `It ends level, ${nil(h)} all.`;
  return h > a ? `${home} win it, ${nil(h)}, ${nil(a)}.` : `${away} take it, ${nil(a)}, ${nil(h)}.`;
}

const GOAL_MOMENTS = {
  reply: ['GOAL! {team} pull one back! {score}.', 'In it goes! There is a response from {team}! {score}.'],
  opener: ['GOAL! First blood to {team}! {score}.', 'In it goes! {team} break the deadlock! {score}.'],
  equaliser: ['GOAL! All square! {team} are right back in it! {score}.', 'They have levelled it! What a response from {team}! {score}.'],
  lead: ['GOAL! {team} take the lead! {score}.', 'In it goes! The advantage is with {team}! {score}.'],
  extend: ['GOAL! Another for {team}! {score}.', 'They have added to the lead! {team} strike again! {score}.'],
};

// Voice names have no standard gender field. Prefer explicitly identified male
// English voices; importantly, 'female' must never satisfy a 'male' substring.
export function chooseCommentaryVoice(voices = [], { preferLocal = false } = {}) {
  const english = voices.filter(v => /^en(?:-|$)/i.test(v.lang));
  const male = v => /\bmale\b|\b(daniel|david|george|ryan|guy|christopher|james|thomas|arthur|oliver|alex|fred|ralph|bruce|roger|eric|mark|reed|aaron|brian|andrew|adam|benjamin|nathan|william|ewan|alfie|elliot|ethan|finn|noah|ian|jacob|sean|tony)\b/i.test(v.name)
    && !/female|\bwoman\b/i.test(v.name);
  const region = v => /en-(GB|GH|NG|ZA|KE)/i.test(v.lang);
  const quality = v => (preferLocal && v.localService ? 10 : 0) + (region(v) ? 2 : 0) + (/natural|neural|enhanced|premium|google/i.test(v.name) ? 3 : 0);
  return english.filter(male).sort((a, b) => quality(b) - quality(a))[0]
    || english.find(v => v.default) || english[0] || null;
}

const phoneVoice = () => ({ preferLocal: (globalThis.navigator?.maxTouchPoints || 0) > 0 });
let welcomeUtterance = null;

// Called synchronously by the Kick Off/Play click, before React mounts a match
// and loads its assets. Mobile speech needs a real line in that user gesture;
// a silent blank utterance does not reliably grant speech permission.
export function primeCommentary() {
  const synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance;
  if (!synth || !Utterance || globalThis.navigator?.userActivation?.isActive === false) return;
  try {
    const line = new Utterance('Welcome to Legon football.');
    const voice = chooseCommentaryVoice(synth.getVoices?.() || [], phoneVoice());
    if (voice) line.voice = voice;
    line.lang = voice?.lang || 'en-GB'; line.volume = 1; line.pitch = .9; line.rate = 1.04;
    welcomeUtterance = line;
    line.onend = line.onerror = () => { if (welcomeUtterance === line) welcomeUtterance = null; };
    synth.cancel();
    if (synth.paused) synth.resume?.();
    synth.speak(line);
  } catch { welcomeUtterance = null; }
}

export function goalContext([home, away], homeScored) {
  const own = homeScored ? home : away, other = homeScored ? away : home;
  if (home + away === 1) return 'opener';
  if (own === other) return 'equaliser';
  if (own < other) return 'reply';
  return own === other + 1 ? 'lead' : 'extend';
}

// Picks a line for an event, avoiding the last one used for that event.
export function pickLine(event, values, random = Math.random, last = {}) {
  const spec = EVENTS[event];
  if (!spec) return null;
  // Lines written around a player's name are kept for real usernames.
  const lines = event === 'goal' && GOAL_MOMENTS[values.goalMoment] ? GOAL_MOMENTS[values.goalMoment] : spec.lines;
  const fitting = values.who ? lines : lines.filter(line => !line.includes('{who}'));
  const options = fitting.length ? fitting : lines;
  const pool = options.length > 1 ? options.filter(line => line !== last[event]) : options;
  const line = pool[Math.floor(random() * pool.length)];
  last[event] = line;
  // Without a username, {who} is the hall: "Commonwealth shoots!"
  const text = line.replace(/\{(\w+)\}/g, (_, key) => values[key] || (key === 'who' ? values.team || '' : ''));
  return { text: text.replace(/\s+/g, ' ').trim(), priority: spec.priority, excited: Boolean(spec.excited) };
}

// Sentences as the voice clips are cut: split after . ! ? (shared with tools/commentary_sentences.mjs).
export function splitSentences(text) {
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
}

export { EVENTS, GOAL_MOMENTS };

const COOLDOWN = { shot: 1200, save: 1500, catch: 3000, punch: 1800, spill: 2000,
  woodwork: 1200, inBox: 4500, through: 4000, cross: 3000, tackle: 6000, build: 14000 };

export function createCommentary({ enabled = true, onCaption = () => {}, now = () => performance.now() } = {}) {
  const synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance;
  let on = enabled, voice = null, speakingPriority = 0, lastSpokeAt = -Infinity;
  let pending = null, blocked = null, current = null, generation = 0, guard = null, lastUnlockAt = -Infinity;
  const last = {}, lastEventAt = {};
  const chooseVoice = () => { voice = chooseCommentaryVoice(synth?.getVoices?.() || [], phoneVoice()); };
  chooseVoice(); synth?.addEventListener?.('voiceschanged', chooseVoice);

  // Voice clips: one manifest, loaded once; a missing manifest simply keeps the device voice.
  let clips = null;
  const audio = typeof Audio === 'function' ? new Audio() : null;
  if (audio && typeof fetch === 'function') {
    fetch(publicAsset('commentary/manifest.json')).then(r => (r.ok ? r.json() : null)).then(m => { clips = m; }).catch(() => {});
  }
  // Recorded calls for a whole moment (manifest "events": {goal: [files]}), never the same one twice in a row.
  const lastClip = {};
  const eventClip = event => {
    const pool = clips?.events?.[event];
    if (!pool?.length) return null;
    const options = pool.length > 1 ? pool.filter(file => file !== lastClip[event]) : pool;
    const file = options[Math.floor(Math.random() * options.length)];
    lastClip[event] = file;
    return [publicAsset('commentary/' + file)];
  };
  // Clip files for a line, in its delivery style (the other style if one sentence only exists there).
  const clipsFor = line => {
    if (!clips) return null;
    const style = line.excited ? 'excited' : 'calm', other = line.excited ? 'calm' : 'excited';
    const files = splitSentences(line.text).map(sentence => clips[style]?.[sentence] || clips[other]?.[sentence]);
    return files.length && files.every(Boolean) ? files.map(file => publicAsset('commentary/' + file)) : null;
  };

  function cancelSpeech() {
    generation++; clearTimeout(guard); guard = null; speakingPriority = 0; current = null;
    synth?.cancel();
    if (audio) { audio.onended = audio.onerror = null; audio.pause(); }
  }
  // Play a line's clips back to back; the same queueing rules as the spoken voice.
  function playClips(line, files) {
    const id = ++generation;
    speakingPriority = line.priority; current = { line, started: true };
    let index = 0, finished = false;
    const done = () => {
      if (finished || id !== generation) return;
      finished = true; clearTimeout(guard); guard = null; speakingPriority = 0; current = null;
      const next = pending; pending = null;
      if (on && next && now() - next.at < 1800) speak(next.line);
    };
    const next = () => {
      if (id !== generation) return;
      if (index >= files.length) { done(); return; }
      audio.src = files[index++];
      audio.play().catch(() => { if (id === generation) { clips = null; done(); } });
    };
    audio.onended = next;
    audio.onerror = next;
    // Recorded calls can run long (crowd and music tails): ended normally closes them first.
    guard = setTimeout(done, line.recorded ? 30000 : 2500 + line.text.length * 90);
    next();
  }
  function speak(line) {
    onCaption(line.text);
    const recorded = line.event && eventClip(line.event);
    if (recorded) { playClips({ ...line, recorded: true }, recorded); return; }
    const files = clipsFor(line);
    if (files) { playClips(line, files); return; }
    if (!synth || !Utterance) return;
    const utterance = new Utterance(line.text), id = ++generation;
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-GB';
    // Energy comes from timing and emphasis, not a squeaky pitch jump.
    utterance.rate = line.excited ? 1.16 : 1.04;
    utterance.pitch = line.excited ? .98 : .9;
    utterance.volume = 1; speakingPriority = line.priority;
    const active = { line, utterance, started: false }; current = active;
    let finished = false;
    const done = () => {
      if (finished || id !== generation) return;
      finished = true; clearTimeout(guard); guard = null; speakingPriority = 0; current = null;
      const next = pending; pending = null;
      if (on && next && now() - next.at < 1800) speak(next.line);
    };
    utterance.onstart = () => { if (id === generation) { active.started = true; blocked = null; } };
    utterance.onend = done;
    utterance.onerror = event => {
      if (id !== generation) return;
      if (!['canceled', 'interrupted'].includes(event.error)) blocked = { line, at: now() };
      done();
    };
    guard = setTimeout(() => {
      if (id === generation && !active.started) blocked = { line, at: now() };
      done();
    }, 1200 + line.text.length * 75);
    try { synth.speak(utterance); }
    catch { if (id === generation) blocked = { line, at: now() }; done(); }
  }

  return {
    say(event, values = {}) {
      if (!on || !EVENTS[event]) return;
      const time = now();
      if (EVENTS[event].priority < 3 && time - (lastEventAt[event] ?? -Infinity) < (COOLDOWN[event] ?? 5000)) return;
      const line = { ...pickLine(event, values, Math.random, last), event };
      const busy = synth?.speaking || (audio && !audio.paused && !audio.ended) || speakingPriority > 0;
      if (line.priority === 3 || (busy && line.priority > speakingPriority)) {
        pending = null; cancelSpeech(); speak(line);
      } else if (!busy && time - lastSpokeAt >= (line.priority === 1 ? 2000 : 0)) speak(line);
      else if (line.priority === 2) pending = { line, at: time };
      else return;
      lastSpokeAt = time; lastEventAt[event] = time;
    },
    unlock() {
      if (!on || !synth || !Utterance) return;
      chooseVoice();
      if (synth.paused) synth.resume?.();
      // touchend and its synthetic click are one gesture: do not repeatedly
      // cancel a line while the phone is still starting its voice service.
      if (now() - lastUnlockAt < 250 || current?.started) return;
      const retry = current ? { line: current.line, at: now() } : blocked;
      if (!retry || now() - retry.at > 5000) { blocked = null; return; }
      lastUnlockAt = now(); blocked = null; cancelSpeech(); speak(retry.line);
    },
    setEnabled(value) { on = value; if (!value) { pending = blocked = null; cancelSpeech(); } },
    stop() { pending = blocked = null; cancelSpeech(); },
    dispose() { pending = blocked = null; on = false; cancelSpeech(); synth?.removeEventListener?.('voiceschanged', chooseVoice); },
  };
}
