"""Replay active-player deliveries, foul visibility delay and straight shots against local Vite."""
import sys,asyncio,json,shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_first_half import start
from playwright.async_api import async_playwright
JS=r'''()=>{
const d=window.__footballDebug,n=d.snapshot().players.length,c=n/2-2,r=c+1,checks=[];
const far=Array.from({length:n},(_,index)=>({index,x:2000,z:2000,downFor:100}));
const fresh=(options={})=>{d.move(0,0);d.aim(null);d.scenario({ball:[.4,.11,0],owner:c,players:[...far,{index:c,x:0,z:0},{index:r,x:12,z:0}],...options})};
for(const kind of ['pass','through','cross'])for(const manual of [-1,0,1]){
fresh();d.aim({x:1,z:0});const key=kind==='pass'?'j':kind==='through'?'i':'l';d.press(key);d.step(.35);d.release(key);d.move(-1,manual);let received=false,guided=0;
for(let i=0;i<360;i++){const s=d.snapshot();if(s.receivingGuidance)guided++;if(s.possessor===r){received=true;break;}d.step(1/60)}
checks.push({kind,manual,received,guided,end:d.snapshot().ball});}
fresh();d.foul(false,8,4);let s=d.snapshot();checks.push({kind:'foul waits at contact',passed:!s.restart&&Boolean(s.pendingRestart?.contact)});d.step(1);checks.push({kind:'foul visible before restart',passed:!d.snapshot().restart});d.step(.6);checks.push({kind:'foul restart resumes',passed:d.snapshot().restart?.type==='freeKick'});
fresh({ball:[20.4,.11,0],players:[...far,{index:c,x:20,z:0},{index:n/2,x:34,z:0}]});d.aim({x:1,z:0});d.shoot(.6);s=d.snapshot();checks.push({kind:'straight shot placed with pace',passed:s.velocity[0]>28&&Math.abs(s.velocity[2])>1,velocity:s.velocity});
return checks;
}'''
async def main():
 out=Path('/workspace/playtest-artifacts/gameplay-receiving-shooting');out.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1200,'height':800});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await start(page,'http://127.0.0.1:5173','sarbah')
  checks=await page.evaluate(JS)
  await page.add_style_tag(content='.pause-scrim{visibility:hidden!important}')
  await page.evaluate('window.__footballDebug.step(.2)');await page.screenshot(path=str(out/'shooting.png'))
  report={'checks':checks,'errors':errors};(out/'results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
  await browser.close()
  assert not errors and all(x.get('passed',x.get('received',False)) for x in checks)
asyncio.run(main())
