"""Exercise live goal celebrations, recorded three-angle replays and skipping."""
import asyncio,json,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start

OUTPUT=Path(os.getenv('GOAL_AUDIT_OUTPUT','/workspace/receiving-audit/goals'))
GOAL=r'''home=>{
 const d=window.__footballDebug,sign=home?1:-1,hero=home?5:12;
 const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:100}));
 const teammates=Array.from({length:6},(_,i)=>(home?1:8)+i).filter(i=>i!==hero);
 d.scenario({ball:[sign*20,.11,0],owner:hero,touch:home,players:[...far,
  ...teammates.map((index,i)=>({index,x:sign*(11+i),z:(i-2)*3,freezeFor:10})),
  {index:hero,x:sign*19.62,z:0,heading:home?0:Math.PI,freezeFor:10}]});
 d.step(1.2);d.aim({x:sign,z:0});
 if(home)d.shoot(.5,'normal');else d.cpuKick(hero,'shoot',{x:-35.5,z:0});
 for(let i=0;i<180&&!d.snapshot().goalSequence;i++)d.step(1/60);
 const state=d.snapshot();if(!state.goalSequence)throw Error('shot did not score: '+JSON.stringify({ball:state.ball,velocity:state.velocity,owner:state.possessor}));
 return state;
}'''
NATURAL=r'''()=>{
 const d=window.__footballDebug,initial=d.snapshot(),sequence=initial.goalSequence;
 if(sequence.phase!=='celebration'||sequence.teammates.length<4)throw Error('missing team celebration');
 const hero=initial.players[sequence.scorer];
 const gap=(s,i)=>Math.hypot(s.players[i].x-hero.x,s.players[i].z-hero.z);
 d.step(1.4);const joined=d.snapshot();
 const approaching=sequence.teammates.filter(i=>gap(joined,i)<gap(initial,i)-1).length;
 if(approaching<4)throw Error('teammates did not approach scorer: '+approaching);
 if(joined.players.some((p,i)=>p.stamina!==initial.players[i].stamina))throw Error('celebrating drained stamina');
 if(joined.players[sequence.scorer].action!=='celebration')throw Error('scorer is not celebrating');
 d.step(5);let s=d.snapshot();
 if(s.goalSequence?.phase!=='replay')throw Error('celebration never transitioned to replay');
 if(d.playerVisual(sequence.scorer).weight<.99)throw Error('recorded animation hidden by celebration fade');
 const score=s.score,matchTime=s.elapsed,angles=new Set(),balls=[];
 for(let i=0;i<280&&s.goalSequence;i++){
  if(s.goalSequence.phase==='replay'){
   angles.add(s.goalSequence.angle);balls.push(s.ball);
   if(s.elapsed!==matchTime)throw Error('replay advanced match simulation');
   if(s.score.some((v,i)=>v!==score[i]))throw Error('replay changed score');
  }
  d.step(.1);s=d.snapshot();
 }
 if(s.goalSequence||angles.size!==3)throw Error('replay did not complete exactly three angles: '+JSON.stringify([...angles]));
 if(s.input.passHold||s.input.shootHold||s.input.touchSprint)throw Error('held input leaked into kickoff');
 if(Math.hypot(s.ball[0],s.ball[2])>2)throw Error('kickoff did not reset ball');
 if(Math.max(...balls.map(p=>p[0]))-Math.min(...balls.map(p=>p[0]))<5)throw Error('replay is not moving goal footage');
 if(sequence.frameCount<15)throw Error('missing pre-goal history');
 return {approaching,angles:[...angles],frames:sequence.frameCount,score,kickoffOwner:s.possessor,awayCarrier:s.awayCarrier};
}'''

async def main():
 OUTPUT.mkdir(parents=True,exist_ok=True);report={'devices':[],'errors':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for phone in [False,True]:
    ctx=await browser.new_context(viewport={'width':844 if phone else 1200,'height':390 if phone else 800},is_mobile=phone,has_touch=phone)
    page=await ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
    await start(page,os.getenv('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),'sarbah');item={'device':'phone' if phone else 'desktop','natural':[]};report['devices'].append(item)
    for home in [True,False]:
     try:
      await page.evaluate(GOAL,home);detail=await page.evaluate(NATURAL);item['natural'].append({'home':home,'passed':True,**detail})
     except Exception as e:item['natural'].append({'home':home,'passed':False,'error':str(e)})
    await page.evaluate(GOAL,True)
    before=await page.locator('.scoreboard').inner_text()
    await page.keyboard.press('Escape')
    await page.screenshot(path=str(OUTPUT/(item['device']+'-celebration.png')))
    await (page.get_by_role('button',name='SKIP CELEBRATION').tap() if phone else page.get_by_role('button',name='SKIP CELEBRATION').click())
    await page.wait_for_function("window.__footballDebug.snapshot().goalSequence?.phase==='replay'")
    await page.screenshot(path=str(OUTPUT/(item['device']+'-replay.png')))
    # Pause must hold playback without consuming its timeline.
    await (page.get_by_role('button',name='Pause highlight').tap() if phone else page.get_by_role('button',name='Pause highlight').click());time=await page.evaluate('window.__footballDebug.snapshot().goalSequence.playTime')
    await page.wait_for_timeout(250);assert await page.evaluate('window.__footballDebug.snapshot().goalSequence.playTime')==time
    await page.get_by_role('button',name='RESUME').focus()
    if phone:await page.get_by_role('button',name='RESUME').tap()
    else:await page.keyboard.press('Enter')
    await (page.get_by_role('button',name='SKIP REPLAY').tap() if phone else page.get_by_role('button',name='SKIP REPLAY').click());await page.wait_for_function('!window.__footballDebug.snapshot().goalSequence')
    assert await page.locator('.scoreboard').inner_text()==before,'skip changed score or clock'
    item['uiSkipAndPause']=True
    await page.keyboard.press('Escape');await page.evaluate(GOAL,False);await page.keyboard.press('Escape')
    await page.keyboard.press('Enter');await page.wait_for_function("window.__footballDebug.snapshot().goalSequence?.phase==='replay'")
    await page.keyboard.press('Enter');await page.wait_for_function('!window.__footballDebug.snapshot().goalSequence');item['keyboardSkip']=True
    # A gamepad primary button must skip after either team scores, even
    # when the game would otherwise map A/X to defensive contain.
    await page.keyboard.press('Escape');await page.evaluate(GOAL,False)
    await page.evaluate("""()=>{window.__goalPad={id:'Xbox test',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__goalPad]});}""")
    await page.keyboard.press('Escape')
    await page.evaluate("window.__goalPad.buttons[0]={pressed:true,value:1};window.__footballDebug.pollGamepad()")
    assert await page.evaluate("window.__footballDebug.snapshot().goalSequence?.phase")== 'replay'
    await page.evaluate("window.__footballDebug.pollGamepad()")
    assert await page.evaluate("window.__footballDebug.snapshot().goalSequence?.phase")== 'replay','held button skipped twice'
    await page.evaluate("window.__goalPad.buttons[0]={pressed:false,value:0};window.__footballDebug.pollGamepad();window.__goalPad.buttons[0]={pressed:true,value:1};window.__footballDebug.pollGamepad()")
    assert await page.evaluate('window.__footballDebug.snapshot().goalSequence') is None
    item['gamepadSkip']=True
    print(json.dumps(item),flush=True);await ctx.close()
  finally:await browser.close()
 (OUTPUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
 assert not report['errors'] and all(c['passed'] for d in report['devices'] for c in d['natural'])

if __name__=='__main__':asyncio.run(main())
