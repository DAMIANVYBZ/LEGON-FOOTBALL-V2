// Match commentary spoken by the device's own voice (Web Speech API): no audio
// files to download, a few kilobytes of code, almost no processing.

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
export function chooseCommentaryVoice(voices = []) {
  const english = voices.filter(v => /^en(?:-|$)/i.test(v.lang));
  const male = v => /\bmale\b|\b(daniel|david|george|ryan|guy|christopher|james|thomas|arthur|oliver|alex|fred|ralph|bruce|roger|eric|mark|reed|aaron|brian|andrew|adam|benjamin|nathan|william|ewan|alfie|elliot|ethan|finn|noah|ian|jacob|sean|tony)\b/i.test(v.name)
    && !/female|\bwoman\b/i.test(v.name);
  const region = v => /en-(GB|GH|NG|ZA|KE)/i.test(v.lang);
  const quality = v => (region(v) ? 2 : 0) + (/natural|neural|enhanced|premium|google/i.test(v.name) ? 3 : 0);
  return english.filter(male).sort((a, b) => quality(b) - quality(a))[0]
    || english.find(v => v.default) || english[0] || null;
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

const COOLDOWN = { shot: 1200, save: 1500, catch: 3000, punch: 1800, spill: 2000,
  woodwork: 1200, inBox: 4500, through: 4000, cross: 3000, tackle: 6000, build: 14000 };

export function createCommentary({ enabled = true, onCaption = () => {}, now = () => performance.now() } = {}) {
  const synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance;
  let on = enabled, voice = null, speakingPriority = 0, lastSpokeAt = -Infinity;
  let pending = null, unlocked = false, generation = 0, guard = null;
  const last = {}, lastEventAt = {};
  const chooseVoice = () => { voice = chooseCommentaryVoice(synth?.getVoices?.() || []); };
  chooseVoice(); synth?.addEventListener?.('voiceschanged', chooseVoice);

  function cancelSpeech() {
    generation++; clearTimeout(guard); guard = null; speakingPriority = 0;
    synth?.cancel();
  }
  function speak(line) {
    onCaption(line.text);
    if (!synth || !Utterance) return;
    const utterance = new Utterance(line.text), id = ++generation;
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-GB';
    // Energy comes from timing and emphasis, not a squeaky pitch jump.
    utterance.rate = line.excited ? 1.16 : 1.04;
    utterance.pitch = line.excited ? .98 : .9;
    utterance.volume = 1; speakingPriority = line.priority;
    let finished = false;
    const done = () => {
      if (finished || id !== generation) return;
      finished = true; clearTimeout(guard); guard = null; speakingPriority = 0;
      const next = pending; pending = null;
      if (on && next && now() - next.at < 1800) speak(next.line);
    };
    guard = setTimeout(done, 1200 + line.text.length * 75);
    utterance.onend = utterance.onerror = done;
    synth.speak(utterance);
  }

  return {
    say(event, values = {}) {
      if (!on || !EVENTS[event]) return;
      const time = now();
      if (EVENTS[event].priority < 3 && time - (lastEventAt[event] ?? -Infinity) < (COOLDOWN[event] ?? 5000)) return;
      const line = pickLine(event, values, Math.random, last);
      const busy = synth?.speaking || speakingPriority > 0;
      if (line.priority === 3 || (busy && line.priority > speakingPriority)) {
        pending = null; cancelSpeech(); speak(line);
      } else if (!busy && time - lastSpokeAt >= (line.priority === 1 ? 2000 : 0)) speak(line);
      else if (line.priority === 2) pending = { line, at: time };
      else return;
      lastSpokeAt = time; lastEventAt[event] = time;
    },
    unlock() {
      if (unlocked || !synth || !Utterance) return;
      unlocked = true;
      const silent = new Utterance(' '); silent.volume = 0; synth.speak(silent);
    },
    setEnabled(value) { on = value; if (!value) { pending = null; cancelSpeech(); } },
    stop() { pending = null; cancelSpeech(); },
    dispose() { pending = null; on = false; cancelSpeech(); synth?.removeEventListener?.('voiceschanged', chooseVoice); },
  };
}
