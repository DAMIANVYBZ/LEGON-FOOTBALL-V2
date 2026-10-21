"""Check the actual goal-kick shape and short delivery, with both sides active."""
import asyncio,json,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start
async def main():
 out=Path('/workspace/playtest-artifacts/goal-kick-shape');out.mkdir(parents=True,exist_ok=True)
 errors=[];report=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:errors.append(str(e)))
  await start(page,'http://127.0.0.1:5173','sarbah')
  for z in [-3,3]:
   state=await page.evaluate('''z=>{const d=window.__footballDebug;d.scenario({ball:[.38,.11,0],owner:5});d.restart('goalKick',true,{x:-30,z});d.step(6);d.animate(.1);const s=d.snapshot();
    if(s.restart?.type!=='goalKick')throw Error('goal kick released before user chose');
    const home=s.players.slice(1,7),away=s.players.slice(8,14);
    if(home.filter(p=>Math.abs(p.z)<5).length<2)throw Error('missing central options '+JSON.stringify(home));
    if([...home,...away].some(p=>Math.abs(p.z)>14))throw Error('touchline rows persist');
    if(home.filter(p=>p.x<-20).length<2)throw Error('missing short keeper outlets');
    if(away.some(p=>p.x < -23.43 && Math.abs(p.z)<20.16))throw Error('opponent inside goal-kick box');
    return s;
   }''',z)
   report.append({'z':z,'shape':state})
   await page.add_style_tag(content='.pause-scrim,.controls-hint{visibility:hidden!important}')
   await page.wait_for_timeout(300)
   await page.screenshot(path=str(out/f'shape-{z}.png'))
   delivery=await page.evaluate('''()=>{const d=window.__footballDebug;d.press('j');d.step(.3);d.release('j');d.step(1.1);const s=d.snapshot();if(s.restart||s.velocity[0]<1||s.ball[0]<-29)throw Error('short goal kick did not release');return {ball:s.ball,velocity:s.velocity,target:s.passTarget};}''')
   report[-1]['delivery']=delivery
  # CPU takes the opposite goal kick; legal positioning persists until release.
  report.append(await page.evaluate('''()=>{const d=window.__footballDebug;d.scenario({ball:[.38,.11,0],owner:5});d.restart('goalKick',false,{x:30,z:3});d.step(1.2);const before=d.snapshot();
   for(const p of before.players.slice(1,7))if(p.x>23.43&&Math.abs(p.z)<20.16)throw Error('home opponent inside away goal-kick box');
   d.step(.6);const after=d.snapshot();if(after.restart)throw Error('CPU goal kick failed to release');return {cpu:true,before,after};}'''))
  assert not errors,errors
  (out/'results.json').write_text(json.dumps(report,indent=2));print('PASS: central and staggered goal-kick support on either ball side; compact legal opposition; human short delivery and CPU release; ERRORS []',flush=True)
  await browser.close()
if __name__=='__main__':asyncio.run(main())
