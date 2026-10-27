"""Record the commentary pieces in the one cloned commentator voice (Chatterbox, GPU).
tokens.json (football tools/speech_tokens.mjs): {names, calm: [pieces], excited: [pieces]}.
Writes <out>/voice/<id>.ogg and <out>/manifest.json {voice, names, calm: {piece: file}, excited: {...}}.
Each piece: silence trimmed, sped up 12% without changing pitch. Re-running skips pieces already made.
Usage: venv/Scripts/python render_pieces.py <football public/commentary dir>"""
import hashlib, json, os, sys, time
import torch, librosa, soundfile as sf
from chatterbox.tts import ChatterboxTTS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
SPEED = 1.12
STYLE = {'calm': dict(exaggeration=0.55, cfg_weight=0.45), 'excited': dict(exaggeration=0.95, cfg_weight=0.3)}
tokens = json.load(open(os.path.join(HERE, 'tokens.json'), encoding='utf-8'))
manifest_path = os.path.join(OUT, 'manifest.json')
old = json.load(open(manifest_path, encoding='utf-8')) if os.path.exists(manifest_path) else {}
manifest = {'voice': 'cloned-commentator', 'names': tokens['names'],
            'calm': old.get('calm', {}) if old.get('voice') == 'cloned-commentator' and 'names' in old else {},
            'excited': old.get('excited', {}) if old.get('voice') == 'cloned-commentator' and 'names' in old else {}}
os.makedirs(os.path.join(OUT, 'voice'), exist_ok=True)

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print('device', device, flush=True)
model = ChatterboxTTS.from_pretrained(device=device)
ref = os.path.join(HERE, 'ref_voice.wav')
todo = [(style, text) for style in ('calm', 'excited') for text in tokens[style]]
t0 = time.time()
for i, (style, text) in enumerate(todo, 1):
    rel = 'voice/%s.ogg' % hashlib.sha1(f'{style}|{text}'.encode('utf-8')).hexdigest()[:14]
    path = os.path.join(OUT, rel)
    if not (os.path.exists(path) and manifest[style].get(text) == rel):
        wav = model.generate(text, audio_prompt_path=ref, **STYLE[style]).squeeze(0).cpu().numpy()
        wav, _ = librosa.effects.trim(wav, top_db=38)
        wav = librosa.effects.time_stretch(wav, rate=SPEED)
        sf.write(path, wav, model.sr, format='OGG', subtype='VORBIS')
        manifest[style][text] = rel
        if i % 10 == 0:
            json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if i % 10 == 0 or i == len(todo):
        print(f'[{i}/{len(todo)}] {time.time() - t0:.0f}s', flush=True)
json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('RENDER_DONE', flush=True)
