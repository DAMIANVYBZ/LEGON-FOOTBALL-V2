"""Controlled browser fixtures for ball-ground alignment and released kick inputs."""
import asyncio,json,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start

async def main():
 out=Path('/workspace/playtest-artifacts/ball-control');out.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1280,'height':720});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await start(page,'http://127.0.0.1:5173','sarbah')
  result=await page.evaluate('''()=>{
   const d=window.__footballDebug,far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30}));
   const fresh=(extra={})=>{d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:0,z:0}],...extra});d.aim({x:1,z:0});};
   const checks={};fresh();d.step(1);let s=d.snapshot(),p=s.players[5];
   checks.stationary={gap:Math.hypot(s.ball[0]-p.x,s.ball[2]-p.z),height:s.ball[1]};
   if(checks.stationary.gap>.4||Math.abs(s.ball[1]-.11)>.001)throw Error('floating/distant stationary ball');
   for(const key of ['j','k','l']){
    fresh({controlLockFor:.28});const before=d.snapshot().events.passes;
    d.press(key);d.step(.05);d.release(key);d.step(.1);
    if(d.snapshot().possessor!==5)throw Error('kicked through contact lock');
    d.step(.2);s=d.snapshot();if(s.possessor===5||Math.hypot(s.velocity[0],s.velocity[2])<3)throw Error('released '+key+' was lost during trap');
    if(key==='j'&&s.events.passes!==before+1)throw Error('buffered pass missing/duplicated');
    checks[key]={velocity:s.velocity,owner:s.possessor};
   }
   fresh({controlLockFor:1});d.press('j');d.release('j');d.step(1.1);
   if(d.snapshot().possessor!==5)throw Error('expired input kicked a later ball');checks.expiry=true;
   fresh();d.move(1,0);const samples=[];
   for(let i=0;i<90;i++){d.step(1/60);s=d.snapshot();p=s.players[5];samples.push({gap:Math.hypot(s.ball[0]-p.x,s.ball[2]-p.z),y:s.ball[1]});}
   if(samples.slice(30).some(s=>s.gap>.65||Math.abs(s.y-.11)>.001))throw Error('running carry lost foot contact');checks.running=samples;
   d.move(0,0);d.step(.5);return checks;
  }''')
  await page.add_style_tag(content='.pause-scrim,.controls-hint{visibility:hidden!important}')
  await page.screenshot(path=str(out/'close-ground-control.png'))
  assert not errors,errors
  (out/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='running'}));await browser.close()
asyncio.run(main())
