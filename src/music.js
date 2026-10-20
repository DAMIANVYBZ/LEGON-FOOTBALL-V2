// Menu music played live with Web Audio: no files to download, no licence.
// Two tracks; each schedules one sixteenth note at a time.
const midi = note => 440 * 2 ** ((note - 69) / 12);

function instruments(context, master, noise) {
  function envelope(time, attack, decay, level, destination = master) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    gain.connect(destination);
    return gain;
  }
  function tone(time, frequency, type, attack, decay, level, { filter, detune = 0, destination } = {}) {
    const oscillator = context.createOscillator();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, time); oscillator.detune.value = detune;
    const out = envelope(time, attack, decay, level, destination);
    if (filter) {
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass'; lowpass.frequency.setValueAtTime(filter, time);
      oscillator.connect(lowpass).connect(out);
    } else oscillator.connect(out);
    oscillator.start(time); oscillator.stop(time + attack + decay + 0.05);
    return oscillator;
  }
  function hiss(time, frequency, type, decay, level, destination) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type; filter.frequency.value = frequency;
    source.connect(filter).connect(envelope(time, 0.002, decay, level, destination));
    source.start(time, Math.random() * 0.5); source.stop(time + decay + 0.05);
  }
  function kick(time, level = 0.95, from = 150, to = 45, decay = 0.3) {
    tone(time, from, 'sine', 0.003, decay, level).frequency.exponentialRampToValueAtTime(to, time + decay * 0.7);
  }
  return { tone, hiss, kick, envelope };
}

export const TRACKS = {
  // A: a driving, FIFA-menu style anthem in A minor: Am - F - C - G.
  anthem: {
    title: 'Stadium Anthem',
    bpm: 124,
    setup(context, master) {
      // Chords and lead duck under every kick, the "pumping" of dance music.
      const pump = context.createGain(); pump.connect(master);
      return { pump };
    },
    play({ tone, hiss, kick }, { pump }, index, time, step) {
      const beat = index % 16, bar = Math.floor(index / 16) % 4;
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      const roots = [45, 41, 48, 43];
      const chord = chords[bar];
      if (beat % 4 === 0) {
        kick(time);
        pump.gain.setValueAtTime(0.25, time); pump.gain.linearRampToValueAtTime(1, time + step * 3);
      }
      if (beat === 4 || beat === 12) { hiss(time, 1800, 'bandpass', 0.18, 0.4); tone(time, 190, 'triangle', 0.002, 0.08, 0.25); }
      if (beat % 4 === 2) hiss(time, 8000, 'highpass', 0.07, 0.16); // open hat on the off-beat
      else hiss(time, 9000, 'highpass', 0.025, 0.05);
      // Offbeat bass, octave bounce.
      if (beat % 4 === 2) tone(time, midi(roots[bar]) * (beat % 8 === 2 ? 1 : 2), 'sawtooth', 0.005, step * 1.6, 0.22, { filter: 420 });
      // Supersaw-style chord stabs.
      if ([0, 3, 6, 10, 14].includes(beat)) {
        for (const note of chord) for (const detune of [-9, 9]) tone(time, midi(note + 12), 'sawtooth', 0.004, step * 1.4, 0.035, { filter: 2600, detune, destination: pump });
      }
      // Arpeggio lead rising through the chord.
      const arp = [0, 1, 2, 1, 2, 3, 2, 1];
      const note = chord[arp[beat % 8] % 3] + 24 + (arp[beat % 8] === 3 ? 12 : 0);
      if (beat % 2 === 0) tone(time, midi(note), 'square', 0.004, step * 1.2, 0.045, { filter: 3200, destination: pump });
    },
  },
  // B: an amapiano groove in D minor: Dm9 - Gm7 - Cmaj7 - Am7, with log drum bass.
  amapiano: {
    title: 'Campus Amapiano',
    bpm: 112,
    setup() { return {}; },
    play({ tone, hiss, kick }, _, index, time, step) {
      const beat = index % 16, bar = Math.floor(index / 16) % 4;
      const chords = [[62, 65, 69, 76], [55, 62, 65, 70], [60, 64, 67, 71], [57, 60, 64, 67]];
      const roots = [38, 43, 36, 45];
      if (beat === 0 || beat === 8) kick(time, 0.7, 110, 45, 0.25);
      if (beat === 4 || beat === 12) { hiss(time, 2200, 'bandpass', 0.06, 0.22); hiss(time + 0.02, 2600, 'bandpass', 0.05, 0.16); }
      hiss(time, 6500, 'highpass', 0.05, [2, 6, 10, 14].includes(beat) ? 0.09 : 0.04); // shaker
      if (beat === 7 || beat === 15) tone(time, midi(84), 'sine', 0.002, 0.05, 0.06); // woodblock tick
      // The log drum: a pitched, gliding, slightly saturated bass hit.
      const pattern = { 0: 0, 3: 0, 6: 12, 10: 0, 11: 7, 14: 10 };
      if (pattern[beat] !== undefined) {
        const frequency = midi(roots[bar] + pattern[beat]);
        const log = tone(time, frequency * 1.5, 'sine', 0.004, 0.36, 0.55, { filter: 900 });
        log.frequency.exponentialRampToValueAtTime(frequency, time + 0.07);
        tone(time, frequency * 2, 'triangle', 0.004, 0.12, 0.12, { filter: 1200 });
      }
      // Soft electric-piano chords, pushed slightly ahead of the beat.
      if ([0, 7, 10].includes(beat)) {
        for (const note of chords[bar]) {
          tone(time, midi(note), 'sine', 0.01, step * 5, 0.05);
          tone(time, midi(note) * 2, 'triangle', 0.005, step * 2, 0.012);
        }
      }
    },
  },
};
export const DEFAULT_TRACK = 'amapiano';

// offline: an OfflineAudioContext to render into instead of the speakers.
export function createMusic({ offline, track = DEFAULT_TRACK } = {}) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context && !offline) return { play() {}, stop() {}, setTrack() {}, dispose() {}, render() {} };
  let context = null, master = null, kit = null, state = null, timer = null, step = 0, nextTime = 0, playing = false;
  let current = TRACKS[track] ? track : DEFAULT_TRACK;

  function setup() {
    context = offline || new Context();
    const compressor = context.createDynamicsCompressor();
    compressor.connect(context.destination);
    master = context.createGain();
    master.gain.value = 0;
    master.connect(compressor);
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    kit = instruments(context, master, noise);
    state = TRACKS[current].setup(context, master);
  }
  const sixteenth = () => 60 / TRACKS[current].bpm / 4;
  function tick() {
    while (nextTime < context.currentTime + 0.12) {
      TRACKS[current].play(kit, state, step, nextTime, sixteenth());
      nextTime += sixteenth(); step++;
    }
  }

  return {
    // Browsers only allow sound after the player has clicked or pressed a key.
    play() {
      if (playing) return;
      if (!context) setup();
      context.resume().catch(() => {});
      playing = true;
      nextTime = context.currentTime + 0.05;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0.16, context.currentTime, 0.6);
      clearInterval(timer); timer = setInterval(tick, 25);
    },
    stop() {
      if (!playing) return;
      playing = false;
      master.gain.setTargetAtTime(0, context.currentTime, 0.4);
      const fading = timer;
      setTimeout(() => { if (!playing) clearInterval(fading); }, 1600);
    },
    setTrack(id) {
      if (!TRACKS[id] || id === current) return;
      current = id; step = 0;
      if (context) state = TRACKS[current].setup(context, master);
    },
    dispose() { clearInterval(timer); context?.close().catch(() => {}); },
    // Schedule a whole stretch of music at once, for an offline preview.
    render(seconds) {
      if (!context) setup();
      master.gain.value = 0.16;
      for (let index = 0, time = 0.05; time < seconds; index++, time += sixteenth()) TRACKS[current].play(kit, state, index, time, sixteenth());
    },
  };
}
