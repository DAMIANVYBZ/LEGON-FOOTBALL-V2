"""Offside involvement and timed runs on full 10v10 and 7v7 rosters. Run Vite first."""
import asyncio,sys,json,shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_first_half import start
from playwright.async_api import async_playwright
JS=r'''()=>{
const d=window.__footballDebug,n=d.snapshot().players.length,h=n/2,checks=[];
for(const home of [true,false])for(const onside of [false,true]){
const sign=home?1:-1,c=home?h-2:n-2,r=c+1;
const ps=Array.from({length:n},(_,index)=>({index,x:(index<h?-1:1)*15,z:14,downFor:100}));
ps.push({index:0,x:-26,z:0,freezeFor:100},{index:h,x:26,z:0,freezeFor:100},{index:c,x:sign*5,z:0},{index:r,x:sign*(onside?14:20),z:0,stamina:1});
d.move(0,0);d.aim(null);d.scenario({ball:[sign*5.34,.11,0],owner:c,players:ps});
const before=d.snapshot().events.offsides||0;d.cpuKick(c,onside?'through':'pass',r);
const phase=d.snapshot().offside;
for(let i=0;i<240;i++){d.step(1/60);const s=d.snapshot();if(s.restart||(home?s.possessor:s.awayCarrier)===r)break;}
const s=d.snapshot();checks.push({home,onside,tracked:phase?.candidates.includes(r),whistles:(s.events.offsides||0)-before,restart:s.restart?.type,receivingOwner:home?s.possessor:s.awayCarrier,receiver:r});
}
// An attacker approaching the line must brake, rather than overshoot the target.
const c=h-2,r=c+1,ps=Array.from({length:n},(_,index)=>({index,x:index<h?-10:15,z:14,downFor:100}));
ps.push({index:0,x:-26,z:0,freezeFor:100},{index:h,x:26,z:0,freezeFor:100},{index:c,x:5,z:0},{index:r,x:9,z:3,stamina:1});
d.scenario({ball:[5.34,.11,0],owner:c,players:ps});let furthest=-100;
for(let i=0;i<300;i++){d.step(1/60);furthest=Math.max(furthest,d.snapshot().players[r].x);}
checks.push({name:'waits onside before delivery',furthest,passed:furthest<=15.01});
return checks;
}'''
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']);reports=[];errors=[]
  for venue in ['sarbah','astro']:
   page=await b.new_page(viewport={'width':1200,'height':800});page.on('pageerror',lambda e:errors.append(str(e)))
   await start(page,'http://127.0.0.1:5173',venue);checks=await page.evaluate(JS);reports.append({'venue':venue,'checks':checks});print(json.dumps(reports[-1]),flush=True);await page.close()
  await b.close();out=Path('/workspace/playtest-artifacts/offside-timing');out.mkdir(parents=True,exist_ok=True);(out/'results.json').write_text(json.dumps({'reports':reports,'errors':errors},indent=2))
  assert not errors
  for report in reports:
   for c in report['checks']:
    if 'onside' not in c:assert c['passed'],c
    elif c['onside']:assert not c['tracked'] and c['whistles']==0 and c['receivingOwner']==c['receiver'],c
    else:assert c['tracked'] and c['whistles']==1 and c['restart']=='indirectFreeKick',c
asyncio.run(main())
