"""Browser regressions for offside phases, goal decisions, chips and rebounds.
Uses deterministic fixtures in the actual match loop. Run Vite first.
"""
import asyncio,json,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import VENUES,start

CHECKS=r'''spec=>{
 const d=window.__footballDebug,G=spec.length/2,goalWidth=spec.astro?5.5:7.32,goalHeight=spec.astro?2.2:2.44,results=[];
 const expect=(ok,msg)=>{if(!ok)throw Error(msg)};
 const test=(name,fn)=>{try{const detail=fn();results.push({name,passed:true,detail})}catch(e){results.push({name,passed:false,error:String(e)})}};
 const far=Array.from({length:14},(_,index)=>({index,x:index<7?-25:25,z:18,downFor:10}));
 const isolated=Array.from({length:14},(_,index)=>({index,x:index===5?0:2000,z:index===5?-spec.width/2:2000,downFor:10}));
 const fresh=(options)=>{d.move(0,0);d.aim(null);d.scenario(options)};
 test('home offside is recorded at kick and penalised on involvement',()=>{
  fresh({ball:[5.68,.11,0],owner:5,players:[...far,{index:5,x:5,z:0},{index:6,x:20,z:0},
   ...[8,9,10,11,12,13].map(index=>({index,x:15,z:15,downFor:10})),{index:7,x:G-1,z:0}]});
  d.aim({x:1,z:0});d.press('j');d.step(.3);d.release('j');d.aim(null);
  const phase=d.snapshot().offside;expect(phase?.candidates.includes(6),'receiver not tracked at kick');
  const before=d.snapshot().events.offsides||0;
  for(let i=0;i<180&&(d.snapshot().events.offsides||0)===before;i++)d.step(1/60);
  const s=d.snapshot();expect((s.events.offsides||0)===before+1,'no offside whistle');
  expect(s.restart?.type==='indirectFreeKick'&&!s.restart.home,'wrong offside restart');return phase;
 });
 test('away offside uses the mirrored attacking direction',()=>{
  fresh({ball:[-5.68,.11,0],owner:12,players:[...far,{index:12,x:-5,z:0},{index:13,x:-20,z:0},
   ...[1,2,3,4,5,6].map(index=>({index,x:-15,z:15,downFor:10})),{index:0,x:-G+1,z:0}]});
  d.cpuKick(12,'pass',13);expect(d.snapshot().offside?.candidates.includes(13),'away receiver not tracked');
  const before=d.snapshot().events.offsides||0;
  for(let i=0;i<180&&(d.snapshot().events.offsides||0)===before;i++)d.step(1/60);
  const s=d.snapshot();expect((s.events.offsides||0)===before+1,'no away offside');expect(s.restart?.home&&s.restart.type==='indirectFreeKick','wrong mirrored restart');
 });
 test('goal kick and corner are exempt on the direct delivery',()=>{
  for(const type of ['goalKick','corner']) {
   fresh({ball:[0,.11,0],owner:5,players:far});
   d.restart(type,true,type==='goalKick'?{x:-G+5,z:0}:{x:G-.4,z:spec.width/2-.4});
   d.step(.5);d.aim({x:1,z:0});d.press('j');d.step(.3);d.release('j');d.aim(null);
   // Corners enter the set-piece runup; goal kicks use the ordinary kick.
   d.step(1);
   expect(!d.snapshot().offside,'direct exempt restart created offside phase');
  }
 });
 test('indirect free kick cannot score without another touch',()=>{
  d.step(3);fresh({ball:[0,.11,0],players:[...isolated,{index:5,x:0,z:0}]});
  d.restart('indirectFreeKick',true,{x:G-12,z:0});const taker=d.snapshot().restart.taker,before=d.snapshot().score;
  d.cpuKick(taker,'shoot',{x:G,z:0,high:false});expect(d.snapshot().restartTouch?.type==='indirectFreeKick','restriction not recorded');
  for(let i=0;i<120&&!d.snapshot().restart;i++)d.step(1/60);
  const state=d.snapshot();expect(state.score.every((v,i)=>v===before[i]),'direct indirect-free-kick goal counted');
  expect(state.restart?.type==='goalKick'&&!state.restart.home,'indirect direct goal did not award goal kick');
 });
 test('restart taker cannot immediately play the ball twice',()=>{
  fresh({ball:[0,.11,0],players:[...isolated,{index:5,x:0,z:0}]});
  d.restart('goalKick',true,{x:-G+5,z:0});const taker=d.snapshot().restart.taker,before=d.snapshot().events['double touches']||0;
  d.cpuKick(taker,'pass',taker);
  for(let i=0;i<90&&(d.snapshot().events['double touches']||0)===before;i++)d.step(1/60);
  const state=d.snapshot();expect((state.events['double touches']||0)===before+1,'double touch not penalised');
  expect(state.restart?.type==='indirectFreeKick'&&!state.restart.home,'wrong double-touch restart');
 });
 test('chips respect backward and sideways aim',()=>{
  for(const direction of [{x:-1,z:0},{x:0,z:-1}]) {
   fresh({ball:[.68,.11,0],owner:5,players:[...isolated,{index:5,x:0,z:0}]});
   d.aim(direction);d.shoot(.5,'chip');const s=d.snapshot();
   expect(s.velocity[0]*direction.x+s.velocity[2]*direction.z>3,'chip turned toward goal');expect(s.velocity[1]>0,'chip not lofted');
  }d.aim(null);
 });
 test('post rebound stays live and does not score',()=>{
  fresh({ball:[G-4,.8,goalWidth/2+.06],velocity:[20,0,0],players:isolated});const before=d.snapshot().score;
  d.step(.35);const s=d.snapshot();expect(s.score.every((v,i)=>v===before[i]),'post hit scored');expect(s.velocity[0]<0,'post did not rebound');return s.velocity;
 });
 test('crossbar rebound is not a goal',()=>{
  fresh({ball:[G-4,goalHeight,0],velocity:[20,1,0],players:isolated});const before=d.snapshot().score;
  d.step(.35);const s=d.snapshot();expect(s.score.every((v,i)=>v===before[i]),'bar hit scored');expect(s.velocity[0]<0,'bar did not rebound');return s.velocity;
 });
 test('ball spawned behind goal cannot create a goal',()=>{
  d.step(3);fresh({ball:[G+.5,.11,0],velocity:[2,0,0],players:isolated});const before=d.snapshot().score;
  d.step(.1);expect(d.snapshot().score.every((v,i)=>v===before[i]),'phantom goal from behind line');
 });
 test('legal whole-ball goal scores once',()=>{
  d.step(3);fresh({ball:[G-.3,.11,0],velocity:[8,0,0],players:isolated});const before=d.snapshot().score;
  d.step(.4);const s=d.snapshot();expect(s.score[0]===before[0]+1&&s.score[1]===before[1],'legal goal not counted once');
 });
 return results;
}'''
async def main():
 output=Path('/workspace/playtest-artifacts/rules-audit');output.mkdir(parents=True,exist_ok=True)
 reports=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for venue,length,width in VENUES:
    context=await b.new_context(viewport={'width':1000,'height':700});page=await context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),venue)
    results=await page.evaluate(CHECKS,{'length':length,'width':width,'astro':venue=='astro'})
    report={'venue':venue,'checks':results,'errors':errors};reports.append(report)
    print(json.dumps(report),flush=True);await context.close()
  finally:await b.close()
 (output/'results.json').write_text(json.dumps(reports,indent=2))
 assert all(not r['errors'] and all(c['passed'] for c in r['checks']) for r in reports),'rule audit failures; see results.json'
if __name__=='__main__':asyncio.run(main())
