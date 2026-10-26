"""Render the match commentary as natural neural-voice clips (Microsoft Edge neural TTS via edge-tts).
Usage: node tools/commentary_sentences.mjs > sentences.json
       python tools/render_commentary.py sentences.json public/commentary en-NG-AbeoNeural
Writes <out>/<style>/<id>.mp3 and <out>/manifest.json {voice, calm: {sentence: file}, excited: {...}}.
Re-running skips clips already rendered for the same voice."""
import asyncio, hashlib, json, os, sys
import edge_tts

SRC, OUT, VOICE = sys.argv[1], sys.argv[2], sys.argv[3]
# Calm build-up vs excited big moments: energy from pace and volume, a touch higher on the excited calls.
STYLE = {'calm': dict(rate='+6%', pitch='+0Hz', volume='+0%'), 'excited': dict(rate='+16%', pitch='+6Hz', volume='+20%')}
CONCURRENCY = 8

sentences = json.load(open(SRC, encoding='utf-8'))
manifest_path = os.path.join(OUT, 'manifest.json')
manifest = json.load(open(manifest_path, encoding='utf-8')) if os.path.exists(manifest_path) else {}
if manifest.get('voice') != VOICE:
    manifest = {'voice': VOICE, 'calm': {}, 'excited': {}}


def clip_id(text, style):
    return hashlib.sha1(f'{VOICE}|{style}|{text}'.encode('utf-8')).hexdigest()[:14]


async def render(item, sem, stats):
    text, style = item['text'], item['style']
    rel = f'{style}/{clip_id(text, style)}.mp3'
    path = os.path.join(OUT, rel)
    if os.path.exists(path) and os.path.getsize(path) > 0 and manifest[style].get(text) == rel:
        stats['skipped'] += 1
        return
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICE, **STYLE[style]).save(path)
                break
            except Exception as error:
                if attempt == 3:
                    stats['failed'].append((text, str(error)))
                    return
                await asyncio.sleep(1.5 * (attempt + 1))
    manifest[style][text] = rel
    stats['made'] += 1
    if stats['made'] % 200 == 0:
        print(f"[commentary] {stats['made']} rendered", flush=True)
        json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'), ensure_ascii=False)


async def main():
    for style in STYLE:
        os.makedirs(os.path.join(OUT, style), exist_ok=True)
    sem = asyncio.Semaphore(CONCURRENCY)
    stats = {'made': 0, 'skipped': 0, 'failed': []}
    await asyncio.gather(*(render(item, sem, stats) for item in sentences))
    json.dump(manifest, open(manifest_path, 'w', encoding='utf-8'), ensure_ascii=False)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f"[commentary] done: made {stats['made']}, skipped {stats['skipped']}, failed {len(stats['failed'])}, {size / 1e6:.1f} MB", flush=True)
    for text, error in stats['failed'][:10]:
        print('[commentary] failed:', text, error)


asyncio.run(main())
