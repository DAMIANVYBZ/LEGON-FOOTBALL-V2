"""Replay boot contact, slide momentum, misses, fouls and 1.7-second recovery.

Start Vite first. Requires Python Playwright and Chromium. Fixtures advance
both physics and animation; screenshots use the real game renderer.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil
from playwright.async_api import async_playwright
from audit_first_half import start

CHECKS = r'''() => {
 const d=window.__footballDebug,far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:1000})),results=[];
 const check=(name,fn)=>{try{results.push({name,passed:true,detail:fn()})}catch(e){results.push({name,passed:false,error:String(e)})}};
 const expect=(v,m)=>{if(!v)throw Error(m)};
 const fresh=(options={})=>{d.move(0,0);d.release('shift');d.aim(null);d.scenario({ball:[1,.11,0],players:[...far,{index:5,x:0,z:0}],...options})};
 for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2,.8,-.8,2.3,-2.3])for(const distance of [1,1.8])check(`clean ${angle.toFixed(2)} / ${distance}`,()=>{
  const c=Math.cos(angle),s=Math.sin(angle);fresh({ball:[distance*c,.11,distance*s],owner:12,players:[...far,{index:5,x:0,z:0,heading:angle},{index:12,x:(distance+.6)*c,z:(distance+.6)*s,heading:angle+Math.PI,freezeFor:20}]});
  d.step(.35);d.move(c,s);const before=d.snapshot();d.tackle('slide');expect(d.snapshot().events.tackles===before.events.tackles,'win on button press');let contact=null;
  for(let i=0;i<65;i++){d.step(1/60);let v=d.playerVisual(5),state=d.snapshot();if(state.restart)throw Error('clean slide foul '+JSON.stringify(v.slide));if(v.slide?.ballWon&&!contact)contact={state,visual:structuredClone(v)};}
  const end=d.snapshot(),v=d.playerVisual(5);expect(contact,'no boot contact '+JSON.stringify(v.slide));expect(end.events.tackles===before.events.tackles+1,'multiple ball wins');expect(Math.hypot(end.players[5].x-contact.state.players[5].x,end.players[5].z-contact.state.players[5].z)>.15,'no follow-through');
  const hit=contact.visual.slide.contacts.find(h=>h.type==='ball'),gap=Math.hypot(hit.foot.x-hit.ball[0],hit.foot.y-hit.ball[1],hit.foot.z-hit.ball[2]);expect(gap<=.231,'contact outside boot');
  return {contactAt:contact.state.elapsed-before.elapsed,gap,contacts:v.slide.contacts,followThrough:Math.hypot(end.players[5].x-contact.state.players[5].x,end.players[5].z-contact.state.players[5].z)};
 });
 for(const side of [-1.25,1.25])check('wide miss '+side,()=>{fresh({ball:[1.5,.11,side],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:2.1,z:side,heading:Math.PI,freezeFor:20}]});d.move(1,0);const before=d.snapshot().events.tackles;d.tackle('slide');d.step(1.2);const s=d.snapshot(),v=d.playerVisual(5);expect(s.events.tackles===before&&!s.restart,'wide slide stole ball or fouled');expect(!v.slide.ballWon,'ghost boot contact');expect(v.action==='stand','miss did not start getting up');return {feet:v.feet};});
 check('clean slide returns control after 1.7 seconds',()=>{fresh({ball:[1.8,.11,0]});d.move(1,0);const began=d.snapshot().elapsed;d.tackle('slide');d.step(1.2);let s=d.snapshot(),v=d.playerVisual(5);expect(v.slide.ballWon,'cannot slide into loose ball');expect(v.action==='stand','get-up did not start');expect(Math.abs(v.downUntil-began-1.7)<.025,'clean slide has wrong total recovery');const x=s.players[5].x;d.step(.45);s=d.snapshot();expect(Math.abs(s.players[5].x-x)<.01&&s.players[5].downUntil>s.elapsed,'moved before finishing get-up');d.step(.15);s=d.snapshot();expect(s.players[5].downUntil<s.elapsed&&s.players[5].x>x+.005,'control did not return after 1.7 seconds');return {duration:v.downUntil-began};});
 check('running entry retains momentum',()=>{fresh({ball:[20,.11,0]});d.move(1,0);d.press('shift');d.step(.65);let before=d.snapshot();d.tackle('slide');let pressed=d.snapshot();expect(pressed.players[5].vx===before.players[5].vx,'lost velocity on press');d.step(1/60);let after=d.snapshot();expect(after.players[5].x>before.players[5].x+.06&&after.players[5].vx>4,'stopped during entry');d.release('shift');return {before:before.players[5].vx,after:after.players[5].vx};});
 check('body-first tackle foul',()=>{fresh({ball:[2.28,.11,0],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:1.6,z:0,heading:Math.PI,freezeFor:20}]});d.move(1,0);d.tackle('slide');d.step(.7);const s=d.snapshot(),v=d.playerVisual(5);expect(s.restart&&!s.restart.home,'body-first tackle has no foul');expect(v.slide.contacts.some(h=>h.type==='foul'),'missing body-first decision');return v.slide;});
 check('miss stays grounded then returns control after 1.7 seconds',()=>{fresh({ball:[15,.11,0]});d.move(1,0);const began=d.snapshot().elapsed;d.tackle('slide');d.step(.8);let v=d.playerVisual(5);expect(v.feet.every(f=>f.y<.2&&f.y>-.1),'feet leave ground during slide');const feet=v.feet;d.step(.4);let s=d.snapshot();v=d.playerVisual(5);expect(v.action==='stand','miss still lying on ground');expect(Math.abs(v.downUntil-began-1.7)<.025,'miss has wrong total recovery');const x=s.players[5].x;d.step(.45);s=d.snapshot();expect(Math.abs(s.players[5].x-x)<.01&&s.players[5].downUntil>s.elapsed,'moving during get-up');d.step(.15);s=d.snapshot();expect(s.players[5].downUntil<s.elapsed&&s.players[5].x>x+.005,'miss did not return control after 1.7 seconds');return {duration:v.downUntil-began,slideFeet:feet};});
 for(const side of [-.6,.6])check('crossing loose ball '+side,()=>{
  fresh({ball:[1.5,.11,side],velocity:[0,0,-Math.sign(side)*2.5]});d.move(1,0);d.tackle('slide');d.step(.8);const v=d.playerVisual(5);expect(v.slide.ballWon,'missed crossing ball '+JSON.stringify(v.slide));return v.slide;
 });
 check('high ball clears slide',()=>{fresh({ball:[1.5,1.5,0],velocity:[0,4,0]});d.move(1,0);d.tackle('slide');d.step(.5);const v=d.playerVisual(5);expect(!v.slide.ballWon,'boot reached a high ball');return v.slide;});
 check('running body-first tackle is a red card',()=>{
  fresh({ball:[5.28,.11,0],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:4.6,z:0,heading:0,freezeFor:20}]});d.move(1,0);d.press('shift');d.step(.45);d.tackle('slide');d.release('shift');d.step(.7);const s=d.snapshot(),v=d.playerVisual(5);expect(s.restart&&!s.restart.home&&s.players[5].sentOff,'reckless slide lacked foul/red '+JSON.stringify(v.slide));return v.slide;
 });
 check('moving carrier clean tackle',()=>{
  fresh({ball:[1,.11,0],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:1.6,z:0,heading:Math.PI}]});d.move(1,0);d.tackle('slide');d.step(.7);const s=d.snapshot(),v=d.playerVisual(5);expect(v.slide.ballWon&&!s.restart,'cannot tackle moving carrier '+JSON.stringify(v.slide));return v.slide;
 });
 return results;
}
'''

async def main(args):
 out=Path(args.output);out.mkdir(parents=True,exist_ok=True);report=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for venue in args.venue or ['sarbah','astro','oval']:
    page=await browser.new_page(viewport={'width':1280,'height':720});errors=[]
    page.on('pageerror',lambda error,item=errors:item.append(str(error)))
    await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),venue)
    checks=await page.evaluate(CHECKS)
    report.append({'venue':venue,'checks':checks,'errors':errors})
    (out/'results.json').write_text(json.dumps(report,indent=2))
    failed=[c for c in checks if not c['passed']]
    print(venue,len(checks),'checks; failures:',json.dumps(failed),'browser errors:',errors,flush=True)
    assert not failed,failed
    assert not errors,errors
    await page.add_style_tag(content='.pause-scrim{visibility:hidden!important}')
    await page.evaluate("const d=window.__footballDebug;d.move(0,0);d.scenario({ball:[1.8,.11,0],players:Array.from({length:14},(_,index)=>({index,x:index===5?0:2000,z:index===5?0:2000,downFor:index===5?0:100}))});d.move(1,0);d.tackle('slide');d.setCameraMode('Behind player');d.step(.42)")
    await page.evaluate('async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)}')
    await page.screenshot(path=str(out/(venue+'-slide.png')))
    await page.evaluate('window.__footballDebug.step(.9)')
    await page.evaluate('async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)}')
    await page.screenshot(path=str(out/(venue+'-get-up.png')))
    await page.close()
  finally:await browser.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--venue',action='append')
 parser.add_argument('--output',default='/workspace/slide-fix-audit/final')
 asyncio.run(main(parser.parse_args()))
