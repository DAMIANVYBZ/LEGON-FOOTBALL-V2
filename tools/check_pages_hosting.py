"""Check production models and textures on a strict GitHub-style subpath server."""
import asyncio,json,os,shutil
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright

async def main():
 base=os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:4180/LEGON-FOOTBALL-V2').rstrip('/')
 origin=f'{urlsplit(base).scheme}://{urlsplit(base).netloc}'
 requests=[];bad=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   page=await browser.new_page(viewport={'width':1280,'height':720})
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('response',lambda response: (requests.append({'url':response.url,'status':response.status}),bad.append(response.url) if response.status>=400 else None) if response.url.startswith(origin+'/') else None)
   await page.goto(base+'/?venue=oval')
   await page.get_by_role('button',name='YES · OPEN FOOTBALL').click()
   await page.get_by_role('button',name='KICK OFF').click()
   await page.locator('.match-loading').wait_for(state='hidden',timeout=120000)
   assert not await page.locator('.model-status').all_text_contents()
   assert await page.evaluate('typeof window.__footballDebug')=='undefined'
   for asset in ['models/Ch38_nonPBR.fbx','animations/clips.json','campus/manifest.json','campus/athletic-oval.glb','images/logo.svg']:
    assert any(r['url']==base+'/'+asset and r['status']==200 for r in requests),asset
   assert all(r['url'].startswith(base+'/') for r in requests),requests
   assert not bad,bad
   assert not errors,errors
   out=Path('/workspace/playtest-artifacts/github-pages');out.mkdir(parents=True,exist_ok=True)
   await page.screenshot(path=str(out/'oval-production-subpath.png'))
   (out/'requests.json').write_text(json.dumps(requests,indent=2))
   print('PASS: strict project-path production hosting; real model, animation library, textured GLB venue and logo load; no missing local assets or JS errors',flush=True)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
