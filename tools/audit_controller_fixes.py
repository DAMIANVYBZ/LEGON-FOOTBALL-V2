"""Replay controller charging, sprint, slides, spin, visible exits and period menus."""
import argparse,asyncio,json,shutil,os,math
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start

async def main(first_half=False):
 out=Path('/workspace/playtest-artifacts/controller-fixes');out.mkdir(parents=True,exist_ok=True)
 report={};errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   page=await browser.new_page(viewport={'width':1280,'height':720});page.on('pageerror',lambda e:errors.append(str(e)))
   await page.add_init_script('''window.__pad={index:0,id:'Xbox test controller',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.__pad]});''')
   await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),'sarbah')
   # The real navigator input reader is polled with the same held-button states.
   await page.get_by_role('button',name='RESUME').click()
   report['sprints']=await page.evaluate('''()=>{
    const d=window.__footballDebug,pad=window.__pad,results=[];
    const far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30}));
    for(const mode of ['normal','r2','r1']){
     pad.buttons.forEach(b=>{b.pressed=false;b.value=0});pad.axes=[1,0,0,0];
     if(mode!=='normal'){const b=pad.buttons[mode==='r1'?5:7];b.pressed=true;b.value=1;}
     d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:0,z:0}]});d.pollGamepad();d.step(1.2);
     const s=d.snapshot();results.push({mode,x:s.players[5].x,speed:s.players[5].vx,input:s.input});
    }
    if(!(results[2].x>results[1].x+.7&&results[1].x>results[0].x+.7))throw Error('sprint speed not distinct: '+JSON.stringify(results));
    pad.axes=[0,0,0,0];return results;
   }''')
   # Pause/resume while R1 stays held: cached input must be re-applied.
   await page.keyboard.press('Escape')
   await page.get_by_role('button',name='RESUME').click()
   report['heldSprintAfterPause']=await page.evaluate('window.__footballDebug.pollGamepad();window.__footballDebug.snapshot().input.touchSprint')
   assert report['heldSprintAfterPause']
   await page.evaluate('window.__pad.buttons.forEach(b=>{b.pressed=false;b.value=0});window.__footballDebug.pollGamepad()')
   await page.keyboard.press('Escape')
   report['gameplay']=await page.evaluate('''()=>{
    const d=window.__footballDebug,far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30})),checks={};
    const fresh=(extra={})=>{d.move(0,0);d.aim(null);d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:0,z:0}],...extra})};
    const passes=[];
    for(const hold of [.08,.6,1.15]){
     fresh();d.aim({x:1,z:0});const before=d.snapshot().events.passes;
     d.press('j');d.step(hold);if(d.snapshot().events.passes!==before)throw Error('pass fired before release');
     d.release('j');const s=d.snapshot();passes.push({hold,speed:Math.hypot(s.velocity[0],s.velocity[2]),destination:s.passDestination});
    }
    if(!(passes[2].speed>passes[1].speed+5&&passes[1].speed>passes[0].speed+5))throw Error('pass charge not affecting speed');checks.passes=passes;
    // Hold the carrier stationary in this fixture (downFor locks AI motion).
    // A sideways input must aim sideways. The visible fall must wait for contact.
    fresh({ball:[0,.11,1],owner:12,players:[...far,{index:5,x:0,z:0,heading:0},{index:12,x:0,z:1.6,heading:-Math.PI/2,downFor:30}]});
    d.move(0,1);d.tackle('slide');const pressed=d.snapshot();
    if(pressed.players[12].action==='fallen')throw Error('victim fell on button press');
    if(Math.abs(pressed.players[5].heading-Math.PI/2)>.01)throw Error('wrong slide direction');
    const before=pressed.events.tackles;d.step(.4);const early=d.snapshot();
    if(early.events.tackles!==before||early.players[12].action==='fallen')throw Error('slide contact before windup');
    d.step(.55);const contact=d.snapshot();
    if(contact.events.tackles<=before)throw Error('slide did not reach exposed ball '+JSON.stringify({ball:contact.ball,player:contact.players[5],carrier:contact.players[12],restart:contact.restart,events:contact.events,sliding:contact.sliding}));
    checks.slide={pressed,early,contact};
    // No opponent: spin takes 1.25s and keeps the ball close without teleporting.
    fresh();d.press('o');const spin=[];let previous=d.snapshot().ball;
    for(let i=0;i<78;i++){
     d.step(1/60);const s=d.snapshot(),p=s.players[5];
     const gap=Math.hypot(s.ball[0]-p.x,s.ball[2]-p.z),jump=Math.hypot(s.ball[0]-previous[0],s.ball[2]-previous[2]);
     if(gap>1||jump>.16||s.possessor!==5)throw Error('spin lost its ball connection '+JSON.stringify({gap,jump,s}));
     spin.push({t:i/60,heading:p.heading,gap,jump,active:!!s.skill});previous=s.ball;
    }
    if(!spin[30].active||spin.at(-1).active||spin[60].heading<5.5)throw Error('spin duration/rotation incorrect');checks.spin=spin;
    fresh({ball:[-35.3,.11,9],velocity:[-10,0,0],owner:-1,touch:false});d.step(.1);const exit=d.snapshot();
    if(exit.restart||exit.pendingRestart?.type!=='goalKick'||!exit.pendingRestart.home||exit.ball[0]>-35.5)throw Error('goal kick teleported before visible exit '+JSON.stringify(exit));
    d.step(.9);const restarted=d.snapshot();if(restarted.restart?.type!=='goalKick'||!restarted.restart.home)throw Error('goal kick not awarded after visible exit');checks.goalKick={exit,restarted};
    return checks;
   }''')
   # Real controller Cross release fires a charged pass, not on button down.
   await page.get_by_role('button',name='RESUME').click()
   report['controllerPass']=await page.evaluate('''()=>{const d=window.__footballDebug,p=window.__pad;
    p.axes=[0,0,0,0];d.scenario({ball:[.68,.11,0],owner:5,players:[{index:5,x:0,z:0}]});
    p.buttons[0]={pressed:true,value:1};d.pollGamepad();const before=d.snapshot().events.passes;d.step(.7);
    if(d.snapshot().events.passes!==before)throw Error('controller pass fired on press');
    p.buttons[0]={pressed:false,value:0};d.pollGamepad();const s=d.snapshot();
    if(s.events.passes!==before+1)throw Error('controller pass did not release');return s;
   }''')
   # Animation must share the simulation clock even after a stalled render frame.
   report['slowFrameAnimation']=await page.evaluate('''async()=>{
    const d=window.__footballDebug;d.step(2);d.scenario({ball:[.68,.11,0],owner:5,
     players:Array.from({length:14},(_,index)=>({index,x:index===5?0:5000,z:0,downFor:index===5?0:30}))});d.press('o');
    const at=d.snapshot().skill.at,until=performance.now()+600;while(performance.now()<until){}
    for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
    const s=d.snapshot(),v=d.playerVisual(5),animation=v.animationTime/v.animationSpeed,simulation=s.elapsed-at;
    if(Math.abs(animation-simulation)>.035)throw Error('animation outran contact clock '+JSON.stringify({animation,simulation,v}));
    return {animation,simulation};
   }''')
   await page.keyboard.press('Escape')
   await page.evaluate('''()=>{const d=window.__footballDebug;d.scenario({ball:[.68,.11,0],owner:5,players:Array.from({length:14},(_,index)=>({index,x:index===5?0:5000,z:0,downFor:1000}))});d.step(160)}''')
   await page.get_by_role('button',name='SECOND HALF').wait_for(timeout=15000)
   await page.evaluate('document.activeElement?.blur();window.__footballDebug.pollGamepad()')
   assert 'SECOND HALF' in await page.evaluate('document.activeElement.textContent')
   await page.evaluate('window.__pad.axes[1]=1;window.__footballDebug.pollGamepad()')
   assert 'LEAVE MATCH' in await page.evaluate('document.activeElement.textContent')
   await page.evaluate('window.__pad.axes[1]=0;window.__footballDebug.pollGamepad();window.__pad.axes[1]=-1;window.__footballDebug.pollGamepad()')
   assert 'SECOND HALF' in await page.evaluate('document.activeElement.textContent')
   await page.evaluate('window.__pad.axes[1]=0;window.__footballDebug.pollGamepad()')
   await page.screenshot(path=str(out/'halftime-gamepad-focus.png'))
   if first_half:
    report['menus']='halftime navigation checked; stopped before second half'
    assert not errors,errors
    (out/'results.json').write_text(json.dumps(report,indent=2))
    print('PASS: controller charging/sprints, slide contact, connected spin, animation clock and halftime navigation; ERRORS []',flush=True)
    return
   await page.evaluate('window.__pad.axes[1]=0;window.__pad.buttons[0]={pressed:true,value:1};window.__footballDebug.pollGamepad()')
   await page.get_by_role('heading',name='HALF TIME',exact=True).wait_for(state='hidden')
   await page.evaluate('window.__pad.buttons[0]={pressed:false,value:0};window.__footballDebug.pollGamepad()')
   await page.keyboard.press('Escape')
   await page.evaluate('''()=>{const d=window.__footballDebug;d.scenario({ball:[.68,.11,0],owner:5,players:Array.from({length:14},(_,index)=>({index,x:index===5?0:5000,z:0,downFor:1000}))});d.step(160)}''')
   await page.get_by_role('heading',name='FULL TIME',exact=True).wait_for(timeout=15000)
   await page.evaluate('document.activeElement?.blur();window.__footballDebug.pollGamepad()')
   assert 'MAIN MENU' in await page.evaluate('document.activeElement.textContent')
   await page.evaluate('window.__pad.buttons[0]={pressed:true,value:1};window.__footballDebug.pollGamepad()')
   await page.get_by_role('heading',name='FULL TIME',exact=True).wait_for(state='hidden')
   report['menus']='halftime navigate/confirm second half; fulltime confirm main menu'
   assert not errors,errors
   (out/'results.json').write_text(json.dumps(report,indent=2));print('PASS: sprint modes and held-resume; charged passes; directed, delayed-contact slide; smooth connected spin; visible goal kick; halftime/fulltime gamepad menus; ERRORS []',flush=True)
  finally:await browser.close()
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--first-half',action='store_true')
 asyncio.run(main(parser.parse_args().first_half))
