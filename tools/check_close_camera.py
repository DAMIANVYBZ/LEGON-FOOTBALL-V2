"""Measure actual rendered close camera framing on desktop and phone."""
import asyncio,json,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
 output=Path('/workspace/playtest-artifacts/close-camera');output.mkdir(parents=True,exist_ok=True)
 report=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for device,width,height in [('computer',1280,720),('phone',844,390)]:
    context=await browser.new_context(viewport={'width':width,'height':height},is_mobile=device=='phone',has_touch=device=='phone')
    page=await context.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
    await page.goto(os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173')+'/?venue=sarbah')
    await page.get_by_role('button',name='YES · OPEN FOOTBALL').click()
    await page.get_by_role('button',name='DEVICE ·').click()
    await page.get_by_role('button',name=device.upper(),exact=False).filter(has=page.locator('strong')).click()
    await page.get_by_role('button',name='KICK OFF').click()
    await page.wait_for_function('window.__footballDebug?.snapshot().started',timeout=120000)
    await page.keyboard.press('Escape')
    for mode in ['Co-op','Wide']:
     for owner,x,z in [(5,0,0),(5,-30,-22),(12,30,22),(12,12,-20)]:
      await page.evaluate('''([mode,owner,x,z])=>{
       const d=window.__footballDebug;d.scenario({ball:[x+.68,.11,z],owner,
        players:[{index:owner,x,z,heading:0}]});d.step(.02);d.setCameraMode(mode);
      }''',[mode,owner,x,z])
      await page.evaluate('async()=>{for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)}')
      c=await page.evaluate('window.__footballDebug.camera()')
      assert abs(c['ball'][0])<.85 and -.72<c['ball'][1]<.59,(device,mode,x,z,c)
      assert abs(c['focus'][2]-z)<2,(device,mode,'not following carrier',c)
      if owner==5 and x==0:
       pixels=abs(c['head'][1]-c['foot'][1])*height/2
       assert pixels>(height*.04),(device,mode,pixels)
       c['playerPixels']=pixels
       await page.get_by_role('button',name='RESUME').click()
       await page.screenshot(path=str(output/f'{device}-{mode}.png'))
       await page.keyboard.press('Escape')
      report.append({'device':device,'mode':mode,'owner':owner,'spot':[x,z],'camera':c})
    await context.close()
  finally: await browser.close()
 assert not errors,errors
 (output/'results.json').write_text(json.dumps(report,indent=2))
 print('PASS',len(report),'rendered framing cases; both teams, touchlines, desktop and phone; no JS errors',flush=True)
 for r in report:
  if 'playerPixels' in r['camera']: print(r['device'],r['mode'],round(r['camera']['playerPixels'],1),'pixels',flush=True)

if __name__=='__main__':asyncio.run(main())
