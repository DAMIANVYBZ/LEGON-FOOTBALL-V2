"""Replay assisted receptions and compare the throw-in guide with real flight.

Requires Vite, Playwright and Chromium. Exercises the real simulation and input
handlers; its inspection API is removed from production builds.
"""
import argparse,asyncio,json,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start,EVENTS

RECEPTIONS=r'''()=>{
 const d=window.__footballDebug,results=[];
 const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:100}));
 for(const type of ['pass','through','cross','corner','freeKick','indirectFreeKick','goalKick','throwIn']){
  for(const correction of [0,.15]){
   try{
    d.move(0,0);d.aim(null);
    const spot=type==='corner'?{x:35.1,z:22.1}:type==='goalKick'?{x:-30,z:3}:type==='throwIn'?{x:0,z:22.4}:{x:0,z:0};
    const target=type==='corner'?{x:29.5,z:0}:type==='throwIn'?{x:8,z:12.4}:type==='goalKick'?{x:-20,z:6}:{x:12,z:0};
    const taker=type==='goalKick'?0:5;
    d.scenario({ball:[spot.x+.38,.11,spot.z],owner:taker,players:[...far,{index:taker,x:spot.x,z:spot.z},{index:6,x:target.x,z:target.z,stamina:1}]});
    if(['pass','through','cross'].includes(type)) d.cpuKick(5,type,6);
    else{
     d.restart(type,true,spot);d.step(.1);d.press(type==='corner'?'l':'j');d.step(.3);d.release(type==='corner'?'l':'j');
     for(let i=0;i<120&&d.snapshot().restart;i++)d.step(1/60);
    }
    const launch=d.snapshot();let guided=0,early=false,received=false,samples=[];
    for(let i=0;i<270;i++){
     const s=d.snapshot();
     if(s.receivingGuidance){
      guided++;early ||= s.possessor<0&&s.controlled===6;
      if(s.receivingGuidance.amount!==.7)throw Error('assist weight changed');
      d.move(0,correction);
      if(samples.length<3)samples.push({t:s.elapsed-launch.elapsed,ball:s.ball,player:[s.players[6].x,s.players[6].z],target:s.receivingGuidance.target});
     }
     if(s.possessor===6 || ((s.events.headers||0)>(launch.events.headers||0)&&s.controlled===6)){received=true;break;}
     if(s.restart||s.awayCarrier>=0)break;
     d.step(1/60);
    }
    d.move(0,0);d.step(1/60);const end=d.snapshot();
    if(!guided||!early||!received)throw Error(JSON.stringify({guided,early,received,ball:end.ball,target:end.passDestination,player:end.players[6],owner:end.possessor,samples}));
    if(end.receivingGuidance)throw Error('assist remained active while dribbling');
    results.push({type,correction,passed:true,guidedFrames:guided,samples});
   }catch(e){results.push({type,correction,passed:false,error:String(e)});}
  }
 }
 return results;
}'''

THROWS=r'''()=>{
 const d=window.__footballDebug,results=[];
 const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:100}));
 for(const side of [-1,1])for(const strength of [.1,.7]){
  try{
   d.move(0,0);d.scenario({ball:[0,.11,0],owner:5,players:[...far,{index:5,x:0,z:side*22.4},{index:6,x:8,z:side*12.4,freezeFor:8}]});
   d.restart('throwIn',true,{x:0,z:side*22.4});d.step(.1);
   const start=d.snapshot(),aim=d.setPiecePreview();
   d.move(.5,-.3);d.step(.3);d.move(0,0);
   d.press('j');d.step(strength);d.release('j');const preview=d.setPiecePreview();
   if(preview.origin.y!==1.8||Math.max(...preview.points.map(p=>p.y))<2)throw Error('missing overhead arc');
   if(Math.hypot(preview.target.x-aim.target.x,preview.target.z-aim.target.z)<.5)throw Error('stick failed to steer guide');
   let release=null;
   for(let i=0;i<60;i++){d.step(1/60);if(!d.snapshot().restart){release=d.snapshot();break;}}
   if(!release)throw Error('throw never released');
   const taker=start.restart.taker,p=release.players[taker],q=start.players[taker];
   if(Math.hypot(p.x-q.x,p.z-q.z)>.05)throw Error('thrower ran onto pitch');
   const samples=[];let maxError=0;
   // First sample follows one physics step at release. Compare each subsequent
   // state with the same 60 Hz predictor used by the displayed dotted arc.
   for(let i=0;i<Math.min(preview.points.length-1,25);i++){
    const actual=d.snapshot(),expected=preview.points[i+1];
    const error=Math.hypot(actual.ball[0]-expected.x,actual.ball[1]-expected.y,actual.ball[2]-expected.z);
    maxError=Math.max(maxError,error);samples.push({actual:actual.ball,expected,error});d.step(1/60);
   }
   if(maxError>.35)throw Error('guide differs from throw by '+maxError+'m');
   if(release.velocity[2]*side>=0||release.ball[1]<1.5)throw Error('throw not overhead/inward');
   results.push({side,strength,passed:true,maxError,receiver:release.passTarget,target:preview.target});
  }catch(e){results.push({side,strength,passed:false,error:String(e)});}
 }
 return results;
}'''

async def main(args):
 out=Path(args.output);out.mkdir(parents=True,exist_ok=True);report={'devices':[],'errors':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for phone in [False,True]:
    context=await browser.new_context(viewport={'width':844 if phone else 1200,'height':390 if phone else 800},is_mobile=phone,has_touch=phone)
    page=await context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
    await start(page,os.getenv('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),'sarbah')
    item={'device':'phone' if phone else 'desktop','receptions':await page.evaluate(RECEPTIONS),'throws':await page.evaluate(THROWS)}
    item['regressions']=await page.evaluate(EVENTS,{'length':71,'width':45,'venue':'sarbah'});report['devices'].append(item)
    await page.evaluate("(()=>{const d=window.__footballDebug;d.scenario({ball:[0,.11,0],owner:5});d.restart('throwIn',true,{x:0,z:22.4});d.step(.1)})()")
    await page.add_style_tag(content='.pause-scrim{visibility:hidden!important}')
    for _ in range(8):
     await page.evaluate('window.__footballDebug.step(0)');await page.evaluate('async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)}')
    await page.screenshot(path=str(out/(item['device']+'-throw-guide.png')))
    print(item['device'],json.dumps(item),flush=True);await context.close()
  finally:await browser.close()
 (out/'report.json').write_text(json.dumps(report,indent=2))
 failures=[c for device in report['devices'] for group in ['receptions','throws','regressions'] for c in device[group] if not c['passed']]
 print('FAILURES',json.dumps(failures),flush=True)
 assert not failures and not report['errors']

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',default='/workspace/receiving-audit/browser');asyncio.run(main(parser.parse_args()))
