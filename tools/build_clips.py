"""Rebuild public/animations/clips.json from the Mixamo FBX files.

Each FBX carries its own copy of the character mesh; the game only needs the
animation tracks, so they are extracted once into one compact file. Run after
adding or changing an animation, with the Vite dev server running (npm run dev).
Requires Python Playwright and Chromium. Optional: FOOTBALL_BASE_URL, CHROMIUM_PATH.
"""
import asyncio, json, os, shutil
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
FILES = sorted(p.stem for p in (ROOT / 'public' / 'animations').glob('*.fbx'))

EXTRACT = '''async (files) => {
  const { loadFBX } = await import('/src/assets.js');
  const round = v => Math.round(v * 1e4) / 1e4;
  const clips = {};
  for (const file of files) {
    const motion = await loadFBX(`/animations/${file}.fbx`);
    const clip = [...motion.animations].sort((a, b) => b.duration - a.duration || b.tracks.length - a.tracks.length)[0];
    clip.optimize();
    const data = clip.constructor.toJSON(clip);
    for (const track of data.tracks) { track.times = track.times.map(round); track.values = track.values.map(round); }
    clips[file] = data;
  }
  return clips;
}'''

async def main():
  async with async_playwright() as p:
    browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), headless=True)
    page = await browser.new_page()
    await page.goto(os.environ.get('FOOTBALL_BASE_URL', 'http://127.0.0.1:5173').rstrip('/') + '/')
    clips = await page.evaluate(EXTRACT, FILES)
    target = ROOT / 'public' / 'animations' / 'clips.json'
    target.write_text(json.dumps(clips, separators=(',', ':')))
    print(f'{len(clips)} clips -> {target} ({target.stat().st_size // 1024} KB)')
    await browser.close()

asyncio.run(main())
