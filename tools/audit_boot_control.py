"""Replay visible dribbling, traps and single-release kicks in the real match.

Start Vite first; requires Python Playwright and Chromium. Uses the development
API, including animation advancement at each physics step. No test API ships.
"""
import asyncio
import json
import os
from pathlib import Path
import shutil

from playwright.async_api import async_playwright
from audit_first_half import start, capture_play

CHECKS = r'''() => {
 const d=window.__footballDebug, report={};
 const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:60}));
 const fresh=(extra={})=>{for(const k of ['shift','k','j','l'])d.release(k);d.move(0,0);d.aim(null);
  d.scenario({ball:[.48,.11,0],owner:5,players:[...far,{index:5,x:0,z:0}],...extra});};
 const expect=(value,message)=>{if(!value)throw Error(message);};
 const summary=s=>{const p=s.players[5];return {time:s.elapsed,owner:s.possessor,ball:s.ball,velocity:s.velocity,
  player:{x:p.x,z:p.z,vx:p.vx,vz:p.vz},gap:Math.hypot(s.ball[0]-p.x,s.ball[2]-p.z),touches:s.events.dribbleTouches||0};};
 for(const mode of ['jog','sprint','turn','reverse','stop','spin']) {
  fresh();if(mode==='sprint')d.press('shift');
  d.move(mode==='spin'?0:1,0);const samples=[];
  const touches=d.snapshot().events.dribbleTouches||0;
  for(let i=0;i<180;i++) {
   if(i===60){if(mode==='turn')d.move(0,1);if(mode==='reverse')d.move(-1,0);if(mode==='stop')d.move(0,0);if(mode==='spin')d.press('o');}
   d.step(1/60);samples.push(summary(d.snapshot()));
  }
  const last=samples.at(-1),maxGap=Math.max(...samples.map(x=>x.gap));
  expect(samples.every(x=>x.owner===5),mode+' lost the ball');
  expect(maxGap<1,mode+' ball too far from player: '+maxGap);
  expect(samples.every(x=>Math.abs(x.ball[1]-.11)<.003),mode+' ball left ground');
  if(mode==='stop')expect(Math.hypot(last.velocity[0],last.velocity[2])<.15,'stopping did not trap the ball');
  if(mode==='jog'){
   const steady=samples.slice(60),leads=steady.map(x=>x.gap),speeds=steady.map(x=>x.velocity[0]);
   expect(Math.max(...speeds)-Math.min(...speeds)>.3,'ball velocity still welded to player');
   expect(Math.max(...leads)-Math.min(...leads)>.01,'ball lead still fixed');
  }
  report[mode]={maxGap,touches:last.touches-touches,samples:samples.filter((_,i)=>i%10===0),last};
 }
 // A single release just before a legitimate recovery lock ends must execute
 // once, without a second tap; input that loses focus must be discarded.
 for(const name of ['pass','shot','cancelledPass','cancelledShot','expiredPass','opponentBall']) {
  fresh({controlLockFor:name==='expiredPass'?.8:name==='opponentBall'?.1:.22});
  const before=d.snapshot().events.passes;d.aim({x:1,z:0});
  const shot=name.toLowerCase().includes('shot');d.press(shot?'k':'j');d.step(.05);d.release(shot?'k':'j');
  if(name.startsWith('cancelled'))window.dispatchEvent(new Event('blur'));
  if(name==='opponentBall')d.cpuKick(12,'pass',13); // real opponent touch cancels the pending command
  d.step(.5);const s=d.snapshot();
  if(name==='pass')expect(s.events.passes===before+1,'one pass release was lost at recovery lock');
  if(name==='shot')expect(s.velocity[0]>10&&s.possessor!==5,'one shot release was lost');
  if(name==='cancelledPass'||name==='expiredPass'||name==='opponentBall')expect(s.events.passes===before,'invalid queued pass fired');
  if(name==='cancelledShot')expect(s.possessor===5&&Math.hypot(s.velocity[0],s.velocity[2])<.15,'cancelled shot fired');
  report[name]={before,after:s.events.passes,ball:s.ball,velocity:s.velocity,owner:s.possessor};
 }
 // Releasing a set-piece pass early schedules the existing visible run-up.
 fresh();d.restart('goalKick',true,{x:-30,z:0});d.step(.05);
 const before=d.snapshot().events.passes;d.press('j');d.step(.1);d.release('j');d.step(1.5);
 const restart=d.snapshot();expect(restart.events.passes===before+1&&!restart.restart,'quick goal-kick pass did not complete its run-up');
 report.goalKick={before,after:restart.events.passes};
 fresh();d.aim({x:1,z:0});d.shoot(1);expect(d.snapshot().players[5].action==='kick','ground shot used an aerial scissor clip');
 // Immediate release uses the contact portion of the authored clip.
 fresh();d.press('j');d.release('j');const visual=d.playerVisual(5);
 expect(visual.animationTime>.3,'pass restarted a disconnected wind-up after ball launch');report.strike=visual;
 return report;
}'''

async def main():
 out=Path(os.environ.get('FOOTBALL_AUDIT_DIR','/workspace/ball-control-audit'));out.mkdir(parents=True,exist_ok=True)
 errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   page=await browser.new_page(viewport={'width':1100,'height':650});page.on('pageerror',lambda e:errors.append(str(e)))
   await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),'sarbah')
   report=await page.evaluate(CHECKS)
   await page.evaluate("const d=window.__footballDebug;d.scenario({ball:[.4,.11,0],owner:5,players:[{index:5,x:0,z:0}]});d.setCameraMode('Behind player');d.move(1,0);d.step(.65)")
   await capture_play(page,out/'dribbling.png')
   assert not errors,errors
   (out/'results.json').write_text(json.dumps({'checks':report,'errors':errors},indent=2))
   print('PASS: grounded rolling, jog/sprint, stop, turns, reverse, spin, buffered pass/shot, cancellation/expiry and goal-kick run-up; no browser errors',flush=True)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
