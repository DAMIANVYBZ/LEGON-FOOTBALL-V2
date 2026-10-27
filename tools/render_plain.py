"""Render the name-free commentary lines in the cloned commentator voice (Chatterbox, GPU).
Output: <out>/cloned/<id>.ogg + manifest.json {plainOnly, events (kept), calm: {sentence: file}, excited: {...}}.
Speech is sped up 12% without changing pitch. Usage: venv/Scripts/python render_plain.py <football public/commentary dir>"""
import hashlib, json, os, sys, time
import torch, librosa, soundfile as sf
from chatterbox.tts import ChatterboxTTS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
SPEED = 1.12
STYLE = {'calm': dict(exaggeration=0.55, cfg_weight=0.45), 'excited': dict(exaggeration=0.95, cfg_weight=0.3)}
lines = json.load(open(os.path.join(HERE, 'plain.json'), encoding='utf-8'))
manifest_path = os.path.join(OUT, 'manifest.json')
manifest = json.load(open(manifest_path, encoding='utf-8')) if os.path.exists(manifest_path) else {}
manifest.update(plainOnly=True, voice='cloned-commentator')
manifest.setdefault('calm', {}); manifest.setdefault('excited', {})
os.makedirs(os.path.join(OUT, 'cloned'), exist_ok=True)

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print('device', device, flush=True)
model = ChatterboxTTS.from_pretrained(device=device)
ref = os.path.join(HERE, 'ref_voice.wav')
t0 = time.time()
for i, item in enumerate(lines, 1):
    text, style = item['text'], item['style']
    rel = 'cloned/%s.ogg' % hashlib.sha1(f'{style}|{text}'.encode('utf-8')).hexdigest()[:14]
    path = os.path.join(OUT, rel)
    if not (os.path.exists(path) and manifest[style].get(text) == rel):
        wav = model.generate(text, audio_prompt_path=ref, **STYLE[style]).squeeze(0).cpu().numpy()
        wav = librosa.effects.time_stretch(wav, rate=SPEED)
        sf.write(path, wav, model.sr, format='OGG', subtype='VORBIS')
        manifest[style][text] = rel
        json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'[{i}/{len(lines)}] {time.time() - t0:.0f}s {style}: {text}', flush=True)
print('RENDER_DONE', flush=True)
