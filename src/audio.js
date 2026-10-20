// Match sound built from Web Audio noise and tones: no files to download.
// Every call is safe when audio is unavailable or switched off.
export function createMatchAudio(enabled = true) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return { kick() {}, whistle() {}, goal() {}, crowd() {}, setEnabled() {}, resume() {}, dispose() {} };
  const context = new Context();
  const master = context.createGain();
  master.gain.value = enabled ? 0.8 : 0;
  master.connect(context.destination);

  const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  // A low, steady crowd murmur whose level follows the danger on the pitch.
  const crowdSource = context.createBufferSource();
  crowdSource.buffer = noise; crowdSource.loop = true;
  const crowdFilter = context.createBiquadFilter();
  crowdFilter.type = 'bandpass'; crowdFilter.frequency.value = 700; crowdFilter.Q.value = 0.6;
  const crowdGain = context.createGain();
  crowdGain.gain.value = 0.04;
  crowdSource.connect(crowdFilter).connect(crowdGain).connect(master);
  crowdSource.start();

  function burst({ duration, frequency, type = 'bandpass', q = 1, volume, attack = 0.005 }) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(now, Math.random()); source.stop(now + duration + 0.05);
  }
  function tone(frequency, start, duration, volume, type = 'sine') {
    const oscillator = context.createOscillator();
    oscillator.type = type; oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.setValueAtTime(volume, start + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start); oscillator.stop(start + duration + 0.02);
  }

  return {
    // power 0..1: a soft pass to a full strike.
    kick(power = 0.5) {
      burst({ duration: 0.09 + power * 0.06, frequency: 160 + power * 120, q: 1.4, volume: 0.25 + power * 0.45 });
      tone(90 + power * 40, context.currentTime, 0.08, 0.2 + power * 0.25);
    },
    // short: a single blast (foul, kickoff); long: three blasts (full time).
    whistle(kind = 'short') {
      const now = context.currentTime;
      const blasts = kind === 'long' ? [[0, 0.35], [0.45, 0.35], [0.9, 0.8]] : kind === 'double' ? [[0, 0.25], [0.32, 0.5]] : [[0, 0.42]];
      for (const [start, length] of blasts) {
        tone(2350, now + start, length, 0.09, 'triangle');
        tone(2490, now + start, length, 0.06, 'triangle');
      }
    },
    goal() {
      burst({ duration: 3.2, frequency: 1100, q: 0.5, volume: 0.5, attack: 0.25 });
      burst({ duration: 2.4, frequency: 2600, q: 0.7, volume: 0.22, attack: 0.15 });
    },
    // intensity 0..1, eased so the crowd swells and settles smoothly.
    crowd(intensity) {
      crowdGain.gain.setTargetAtTime(0.03 + intensity * 0.13, context.currentTime, 0.6);
    },
    setEnabled(value) { master.gain.setTargetAtTime(value ? 0.8 : 0, context.currentTime, 0.05); },
    resume() { if (context.state === 'suspended') context.resume().catch(() => {}); },
    dispose() { context.close().catch(() => {}); },
  };
}
