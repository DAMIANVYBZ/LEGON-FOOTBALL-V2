"""Voice clone test for LEGONRUSH football commentary.
1) Demucs separates the commentator's voice from crowd/music in the user's Pixabay clips.
2) The voice stems are joined into one reference sample (ref_voice.wav).
3) Chatterbox renders a few test lines in that voice into test_out/.
Usage: venv/Scripts/python voice_test.py [cpu|cuda]"""
import os, subprocess, sys
import torch, torchaudio

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r'F:/EPIC GAMES/Projects/_LEGONRUSH_assets/commentary_samples/my samples'
DEVICE = sys.argv[1] if len(sys.argv) > 1 else ('cuda' if torch.cuda.is_available() else 'cpu')
STEMS = os.path.join(HERE, 'stems')
OUT = os.path.join(HERE, 'test_out')
os.makedirs(OUT, exist_ok=True)

clips = sorted(f for f in os.listdir(SRC) if f.startswith('jonathanslattermusic'))
print('reference clips:', clips, flush=True)

# 1) voice / background separation (vocals stem only)
for f in clips:
    name = os.path.splitext(f)[0]
    if not os.path.exists(os.path.join(STEMS, 'htdemucs', name, 'vocals.wav')):
        subprocess.run([sys.executable, '-m', 'demucs', '--two-stems', 'vocals', '-d', DEVICE,
                        '-o', STEMS, os.path.join(SRC, f)], check=True)

# 2) join the voice stems, trimming quiet stretches, into a ~20 s reference
parts, rate = [], None
for f in clips:
    wav, sr = torchaudio.load(os.path.join(STEMS, 'htdemucs', os.path.splitext(f)[0], 'vocals.wav'))
    wav = wav.mean(0, keepdim=True)
    rate = rate or sr
    if sr != rate:
        wav = torchaudio.functional.resample(wav, sr, rate)
    win = rate // 10
    frames = wav[:, : wav.shape[1] // win * win].reshape(1, -1, win)
    loud = frames.pow(2).mean(-1).sqrt()[0] > 0.02
    kept = frames[:, loud].reshape(1, -1)
    print(f'{f[:60]}: {wav.shape[1] / rate:.1f}s -> speech {kept.shape[1] / rate:.1f}s', flush=True)
    parts.append(kept)
ref = torch.cat(parts, 1)[:, : rate * 20]
ref = ref / ref.abs().max() * 0.9
ref_path = os.path.join(HERE, 'ref_voice.wav')
torchaudio.save(ref_path, ref, rate)
print(f'reference voice: {ref.shape[1] / rate:.1f}s -> {ref_path}', flush=True)

# 3) clone and render test lines (exaggeration = energy; cfg lower = faster, livelier pacing)
from chatterbox.tts import ChatterboxTTS
model = ChatterboxTTS.from_pretrained(device=DEVICE)
TESTS = [
    ('calm_buildup', 'Patient build-up here from Volta. Looking for an opening.', 0.5, 0.5),
    ('shot', 'Here is the shot from Sarbah!', 0.8, 0.4),
    ('goal', 'GOAL! What a finish! Commonwealth have done it at the Oval!', 1.0, 0.3),
    ('save', 'What a save! Brilliant stop from the Akuafo keeper!', 0.85, 0.35),
]
for name, text, exaggeration, cfg in TESTS:
    wav = model.generate(text, audio_prompt_path=ref_path, exaggeration=exaggeration, cfg_weight=cfg)
    path = os.path.join(OUT, name + '.wav')
    torchaudio.save(path, wav, model.sr)
    print('rendered', path, flush=True)
print('VOICE_TEST_DONE', flush=True)
