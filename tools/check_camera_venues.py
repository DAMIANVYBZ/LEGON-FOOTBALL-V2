"""Capture restart cameras at every venue, including scene-occlusion review.
Numerical checks establish coverage, not absence of scenery occlusion; inspect
saved images as well. Requires Vite, Python Playwright and Chromium.
"""
import asyncio,json,os,shutil
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
from audit_first_half import start,VENUES

async def main():
 output=Path('/workspace/playtest-artifacts/camera-venues');output.mkdir(parents=True,exist_ok=True);report=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for venue,length,width in VENUES:
    context=await browser.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True);page=await context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),venue);await page.add_style_tag(content='.pause-scrim{display:none!important}')
    cases=[('freeKick',True,0),('corner',True,1),('corner',True,-1),('penalty',True,0),('penalty',False,0),('goalKick',True,0),('throwIn',True,1)]
    for kind,home,side in cases:
     await page.evaluate('''({kind,home,side,length,width})=>{const d=window.__footballDebug,G=length/2,W=width/2,s=home?1:-1;d.scenario({ball:[.68,.11,0],owner:5});d.restart(kind,home,kind==='corner'?{x:s*(G-.4),z:side*(W-.4)}:kind==='penalty'?{x:s*(G-Math.min(11,length*.12)),z:0}:kind==='goalKick'?{x:-s*(G-5),z:3}:kind==='throwIn'?{x:0,z:W-.2}:{x:s*(G-20),z:0});d.step(.1)}''',{'kind':kind,'home':home,'side':side,'length':length,'width':width})
     await page.evaluate('async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)}')
     camera=await page.evaluate('window.__footballDebug.camera()');passed=all(abs(camera[k][0])<.45 and -.82<camera[k][1]<.72 for k in ['ball','takerFoot','takerHead'])
     name=f'{venue}-{kind}-{"home" if home else "away"}-{side}'
     image_path=output/(name+'.png');await page.screenshot(path=str(image_path))
     entry={'name':name,'passed':passed,'camera':camera,'errors':errors.copy()}
     if kind=='corner' and home:
      # Fixed default Commonwealth kit: catch an invisible skinned taker even
      # when the selection marker and projection checks still look correct.
      x=(camera['takerHead'][0]+1)*422;y=(1-camera['takerHead'][1])*195;foot=(1-camera['takerFoot'][1])*195
      crop=Image.open(image_path).convert('RGB').crop((int(x-12),int(y-3),int(x+12),int(foot+3)))
      pixels=crop.get_flattened_data() if hasattr(crop,'get_flattened_data') else crop.getdata()
      entry['kitPixels']=sum(r>70 and g<90 and r>1.6*g and r>1.6*b for r,g,b in pixels)
      entry['passed']=entry['passed'] and entry['kitPixels']>5
     report.append(entry)
    print(venue,'captured',flush=True);await context.close()
  finally:await browser.close()
 (output/'results.json').write_text(json.dumps(report,indent=2));assert all(r['passed'] and not r['errors'] for r in report),report
 print('PASS:',len(report),'venue camera placements',flush=True)
if __name__=='__main__':asyncio.run(main())
