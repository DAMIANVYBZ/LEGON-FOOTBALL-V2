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
    'Goal! {who} scores for {team}! {score}.',
    'It is in! What a finish from {who}! {score}.',
    'Goal for {team}! {venue} erupts! {score}.',
    '{who} finds the net! {team} have it! {score}.',
    'Goal! What a finish! {team} have scored! {score}.',
    'It is in the back of the net! {team} celebrate! {score}.',
  ] },
  shot: { priority: 2, lines: ['{who} shoots!', 'Here is the shot from {who}!', '{who} lets fly!', 'A strike from {who}!',
    'Here is the shot!', 'A strike at goal from {team}!', 'He shoots!', '{team} go for goal!'] },
  catch: { priority: 2, lines: ['Comfortable for the {team} keeper.', 'Straight into the keeper\'s hands.', 'Gathered safely by the {team} keeper.'] },
  save: { priority: 2, excited: true, lines: ['What a save!', 'Brilliant stop from the {team} keeper!', 'Pushed away by the keeper!', 'Kept out at full stretch!'] },
  punch: { priority: 2, lines: ['Punched clear by the {team} keeper.', 'The keeper rises and punches it away.'] },
  spill: { priority: 2, excited: true, lines: ['He has spilled it! Danger here!', 'Fumbled by the keeper! Can anyone pounce?'] },
  smother: { priority: 2, lines: ['Brave from the keeper, smothered at the feet.', 'The keeper comes out and claims it.'] },
  tackle: { priority: 1, lines: ['Good tackle from {who}.', 'Won back by {who}.', '{team} win it back.', 'Strong challenge, and {team} have possession.', 'Stolen! {team} on the ball.'] },
  penalty: { priority: 3, excited: true, lines: ['Penalty! The referee points to the spot for {team}!', 'It is a penalty to {team}!', 'Penalty! A big moment here for {team}.'] },
  woodwork: { priority: 2, excited: true, lines: ['Off the post! So close!', 'It cannons back off the woodwork!', 'The frame of the goal saves them!', 'Rattled the bar!'] },
  yellowCard: { priority: 2, lines: ['A yellow card for {who}.', 'The referee goes to his pocket. Yellow for {team}.', 'Booked! {who} goes into the book.'] },
  redCard: { priority: 3, excited: true, lines: ['Red card! {who} is sent off!', 'Off he goes! {team} are down to fewer men!', 'That is a red card! A reckless challenge from {who}.'] },
  foul: { priority: 2, lines: ['Foul! Free kick to {team}.', 'The referee blows. That was from behind, free kick {team}.', 'A clumsy challenge there. Free kick to {team}.'] },
  freeKickNear: { priority: 2, lines: ['A free kick in shooting range for {team}.', 'This is a dangerous position for {team}.'] },
  corner: { priority: 2, lines: ['Corner to {team}.', '{team} win a corner.', 'It is behind for a corner. {team} will take it.'] },
  goalKick: { priority: 1, lines: ['Goal kick.', 'It goes wide for a goal kick.', 'That is off target. Goal kick to {team}.'] },
  wide: { priority: 2, lines: ['Just wide!', 'Off target, that one.', 'Over the bar!', 'Not far away!'] },
  throwIn: { priority: 1, lines: ['Throw-in to {team}.', 'Out for a throw. {team} have it.'] },
  keeperBall: { priority: 1, lines: ['The {team} keeper has it. Time to build from the back.', 'The keeper looks for a teammate.'] },
  sixSeconds: { priority: 1, lines: ['He has to release it now.'] },
  through: { priority: 1, lines: ['Lovely ball through for {who}!', 'Into the path of {who}!', 'Lovely ball through!', 'A pass splits the defence!', 'In behind goes {team}!'] },
  cross: { priority: 1, lines: ['The cross comes in!', 'Whipped into the box!', 'Delivered into the danger area!'] },
  inBox: { priority: 1, lines: ['{who} is into the box!', 'Into the area goes {who}!', '{team} are threatening now!', 'Into the box!', 'Danger for the defence now!'] },
  build: { priority: 1, lines: [
    '{who} on the ball for {team}.', '{who} carrying it forward.', 'Nice control from {who}.',
    '{team} keeping it nicely.', '{team} looking to build an attack.', 'Patient play from {team}.',
    '{team} pushing forward now.', 'Possession for {team}.', 'The crowd here want more from {team}.',
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

// Picks a line for an event, avoiding the last one used for that event.
export function pickLine(event, values, random = Math.random, last = {}) {
  const spec = EVENTS[event];
  if (!spec) return null;
  // Lines written around a player's name are kept for real usernames.
  const fitting = values.who ? spec.lines : spec.lines.filter(line => !line.includes('{who}'));
  const options = fitting.length ? fitting : spec.lines;
  const pool = options.length > 1 ? options.filter(line => line !== last[event]) : options;
  const line = pool[Math.floor(random() * pool.length)];
  last[event] = line;
  // Without a username, {who} is the hall: "Commonwealth shoots!"
  const text = line.replace(/\{(\w+)\}/g, (_, key) => values[key] || (key === 'who' ? values.team || '' : ''));
  return { text: text.replace(/\s+/g, ' ').trim(), priority: spec.priority, excited: Boolean(spec.excited) };
}

export function createCommentary({ enabled = true, onCaption = () => {} } = {}) {
  const synth = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  let on = enabled, voice = null, speakingPriority = 0, lastSpokeAt = 0, pending = null, unlocked = false;
  const last = {}, lastEventAt = {};
  function chooseVoice() {
    const voices = synth?.getVoices?.() || [];
    const english = voices.filter(v => /^en/i.test(v.lang));
    voice = english.find(v => /en-GB/i.test(v.lang) && /male|daniel|google uk/i.test(v.name))
      || english.find(v => /en-(GB|NG|GH|ZA|KE)/i.test(v.lang)) || english.find(v => v.default) || english[0] || null;
  }
  chooseVoice();
  synth?.addEventListener?.('voiceschanged', chooseVoice);

  function speak(line) {
    onCaption(line.text);
    if (!synth || !Utterance) return;
    const utterance = new Utterance(line.text);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-GB';
    utterance.rate = line.excited ? 1.12 : 1.02;
    utterance.pitch = line.excited ? 1.15 : 1;
    utterance.volume = 1;
    speakingPriority = line.priority;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true; clearTimeout(guard); speakingPriority = 0;
      if (pending) { const next = pending; pending = null; speak(next); }
    };
    // Some devices never report the end of speech; move on after the line's length.
    const guard = setTimeout(done, 1200 + line.text.length * 75);
    utterance.onend = utterance.onerror = done;
    synth.speak(utterance);
  }

  return {
    // values: { team, who, venue, home, away, score, result }
    say(event, values = {}) {
      if (!on) return;
      const now = performance.now();
      // The same kind of moment is not called again for a while (goals excepted).
      if (EVENTS[event]?.priority < 3 && now - (lastEventAt[event] || -1e9) < 10000) return;
      const line = pickLine(event, values, Math.random, last);
      if (!line) return;
      const busy = synth?.speaking || speakingPriority > 0;
      if (line.priority === 3) { pending = null; synth?.cancel(); speakingPriority = 0; speak(line); }
      else if (!busy && now - lastSpokeAt > (line.priority === 1 ? 2500 : 400)) speak(line);
      else if (line.priority === 2 && (!pending || pending.priority < 2)) pending = line;
      else return; // a minor moment while the commentator is talking: skip it
      lastSpokeAt = now; lastEventAt[event] = now;
    },
    // iOS only allows speech that starts from a tap; call on the first input.
    unlock() {
      if (unlocked || !synth || !Utterance) return;
      unlocked = true;
      const silent = new Utterance(' '); silent.volume = 0; synth.speak(silent);
    },
    setEnabled(value) { on = value; if (!value) { pending = null; synth?.cancel(); } },
    stop() { pending = null; synth?.cancel(); speakingPriority = 0; },
  };
}
