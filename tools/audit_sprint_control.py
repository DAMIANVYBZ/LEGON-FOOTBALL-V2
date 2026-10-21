"""Replay sprint starts, jog transitions and turns at varied stride phases.

Start Vite first. Uses real controller mapping, animations and ball physics on
worn, artificial and grass surfaces. Requires Python Playwright and Chromium.
"""
import asyncio
import json
import os
from pathlib import Path
import shutil
from playwright.async_api import async_playwright
from audit_first_half import start

CHECKS = r'''() => {
 const d=window.__footballDebug,pad=window.__pad,results=[];
 const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:10000}));
 const cases=[];
 for(const lead of [-.65,.38,.65])for(const warmup of [0,.1,.25,.4,.6,.85,1.1])for(const angle of [0,.8,-.8,1.57])
  cases.push({lead,warmup,angle,mode:'r1',stamina:1});
 for(const lead of [-.65,.38,.65])for(const warmup of [0,.4,.85])for(const angle of [0,.8])
  cases.push({lead,warmup,angle,mode:'r2',stamina:1});
 for(const mode of ['r1','r2'])for(const stamina of [.03,.2])for(const angle of [0,.8])
  cases.push({lead:.38,warmup:.4,angle,mode,stamina});
 for(const mode of ['r1','r2'])for(const angle of [0,.8,-.8])
  cases.push({lead:.38,warmup:.4,angle,mode,stamina:1,bursts:true});
 for(const spec of cases){
  pad.buttons.forEach(b=>{b.pressed=false;b.value=0});pad.axes=[0,0,0,0];d.pollGamepad();
  d.scenario({ball:[-12+spec.lead,.11,0],owner:5,players:[...far,{index:5,x:-12,z:0,stamina:spec.stamina}]});
  pad.axes=[1,0,0,0];d.pollGamepad();d.step(spec.warmup);
  const button=spec.mode==='r1'?5:7;pad.buttons[button]={pressed:true,value:1};
  pad.axes=[Math.cos(spec.angle),Math.sin(spec.angle),0,0];d.pollGamepad();
  const samples=[];let trailing=0,maxTrailing=0;
  for(let i=0;i<(spec.bursts?240:150);i++){
   if(spec.bursts&&i%30===0){const on=i%60===0;pad.buttons[button]={pressed:on,value:on?1:0};
    pad.axes=[Math.cos(spec.angle),Math.sin(i%120<60?spec.angle:-spec.angle),0,0];d.pollGamepad();}
   d.step(1/60);const s=d.snapshot(),p=s.players[5],speed=Math.hypot(p.vx,p.vz),dx=s.ball[0]-p.x,dz=s.ball[2]-p.z;
   const gap=Math.hypot(dx,dz),lead=speed>.01?(dx*p.vx+dz*p.vz)/speed:0;
   if(s.possessor!==5||gap>1.3)throw Error('sprint left the ball '+JSON.stringify({spec,time:i/60,gap,lead,owner:s.possessor,ball:s.ball,velocity:s.velocity,player:p}));
   if(Math.abs(s.ball[1]-.11)>.003)throw Error('grounded sprint ball left turf');
   trailing=i>45&&lead<-.5?trailing+1/60:0;maxTrailing=Math.max(maxTrailing,trailing);
   if(trailing>.25)throw Error('ball lingered behind the stride '+JSON.stringify({spec,time:i/60,gap,lead}));
   samples.push({t:i/60,gap,lead,speed,ball:s.ball,velocity:s.velocity,touches:s.events.dribbleTouches||0});
  }
  results.push({spec,maxGap:Math.max(...samples.map(s=>s.gap)),maxTrailing,samples:samples.filter((_,i)=>i%15===0)});
 }
 return results;
}'''

async def main():
 out=Path(os.environ.get('FOOTBALL_SPRINT_AUDIT_DIR','/workspace/sprint-control-audit'));out.mkdir(parents=True,exist_ok=True)
 reports=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for venue in ['sarbah','astro','oval']:
    context=await browser.new_context(viewport={'width':1100,'height':650});page=await context.new_page();errors=[]
    page.on('pageerror',lambda error,item=errors:item.append(str(error)))
    await page.add_init_script("window.__pad={index:0,id:'Xbox sprint test',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.__pad]});")
    await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),venue)
    await page.get_by_role('button',name='RESUME').click()
    cases=await page.evaluate(CHECKS)
    assert not errors,errors
    reports.append({'venue':venue,'cases':cases,'errors':errors})
    (out/'results.json').write_text(json.dumps(reports,indent=2))
    print('PASS:',venue,len(cases),'sprint phase, direction, fatigue and burst cases; max gap',round(max(c['maxGap'] for c in cases),3),'m; no browser errors',flush=True)
    await context.close()
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
