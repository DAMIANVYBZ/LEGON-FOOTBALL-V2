"""Replay the reported running-pass failure with movement held through release."""
import asyncio,json,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start

FRESH='''()=>{const d=window.__footballDebug;d.scenario({ball:[.38,.11,0],owner:5,players:[...Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:60})),{index:5,x:0,z:0}]});d.aim(null);}'''
async def main():
 out=Path('/workspace/playtest-artifacts/moving-pass');out.mkdir(parents=True,exist_ok=True)
 errors=[];report={}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1280,'height':720});page.on('pageerror',lambda e:errors.append(str(e)))
  await page.add_init_script('''window.__pad={index:0,id:'Xbox test',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.__pad]});''')
  await start(page,'http://127.0.0.1:5173','oval');await page.get_by_role('button',name='RESUME').click()
  report['controller']=await page.evaluate('''()=>{
   const d=window.__footballDebug,p=window.__pad,out=[],far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:60}));
   for(const mode of ['walk','r2','r1'])for(const hold of [0,.05,.3]){
    p.buttons.forEach(b=>{b.pressed=false;b.value=0});p.axes=[0,0,0,0];d.pollGamepad();
    d.scenario({ball:[.38,.11,0],owner:5,players:[...far,{index:5,x:0,z:0}]});d.aim(null);
    p.axes=[1,0,0,0];if(mode!=='walk')p.buttons[mode==='r1'?5:7]={pressed:true,value:1};d.pollGamepad();d.step(1);
    p.buttons[0]={pressed:true,value:1};d.pollGamepad();d.step(hold);p.buttons[0]={pressed:false,value:0};d.pollGamepad();
    const launch=d.snapshot();if(launch.possessor===5||launch.velocity[0]<launch.players[5].vx+7.9)throw Error('pass has no relative foot speed '+JSON.stringify({mode,hold,launch}));
    const samples=[];
    for(let i=0;i<60;i++){d.step(1/60);d.animate(1/60);const s=d.snapshot();const gap=s.ball[0]-s.players[5].x;
     if(s.possessor===5)throw Error('running passer recaptured the release '+JSON.stringify({mode,hold,time:i/60,gap,state:s}));
     samples.push({time:(i+1)/60,gap,ball:s.ball,playerX:s.players[5].x});}
    if(samples[29].gap<1.8)throw Error('pass stayed beside moving boots '+JSON.stringify({mode,hold,samples}));
    out.push({mode,hold,launchSpeed:launch.velocity[0],runningSpeed:launch.players[5].vx,samples});
   }return out;
  }''')
  print('PASS: controller X while continuing normal, R2 and R1 movement; quick taps and charged passes clear the boots for one second',flush=True)
  # Repeat in the ordinary formation, with opponents and teammates active.
  report['fullSides']=await page.evaluate('''()=>{const d=window.__footballDebug,p=window.__pad;
   p.buttons.forEach(b=>{b.pressed=false;b.value=0});p.axes=[0,0,0,0];d.pollGamepad();
   d.scenario({ball:[-25.62,.11,-20],owner:5,players:[{index:5,x:-26,z:-20}]});p.axes=[1,0,0,0];p.buttons[5]={pressed:true,value:1};d.pollGamepad();d.step(.8);
   if(d.snapshot().possessor!==5)throw Error('full-side fixture lost ball before release');p.buttons[0]={pressed:true,value:1};d.pollGamepad();p.buttons[0]={pressed:false,value:0};d.pollGamepad();
   d.step(.35);d.animate(.35);const s=d.snapshot(),gap=Math.hypot(s.ball[0]-s.players[5].x,s.ball[2]-s.players[5].z);
   if(s.possessor===5||gap<1.5)throw Error('full-side running pass did not leave '+JSON.stringify({gap,s}));return {gap,ball:s.ball,owner:s.possessor,awayCarrier:s.awayCarrier};}''')
  await page.add_style_tag(content='.controls-hint{visibility:hidden!important}')
  await page.screenshot(path=str(out/'running-pass-full-sides.png'))
  await page.keyboard.press('Escape')
  await page.evaluate('''()=>{const p=window.__pad;p.buttons.forEach(b=>{b.pressed=false;b.value=0});p.axes=[0,0,0,0];}''')
  await page.evaluate(FRESH);await page.get_by_role('button',name='RESUME').click()
  await page.keyboard.down('ArrowRight');await page.keyboard.down('e')
  await page.wait_for_function('window.__footballDebug.snapshot().players[5].vx>6.5')
  await page.keyboard.press('s')
  await page.wait_for_function('(()=>{const s=window.__footballDebug.snapshot();return s.possessor!==5&&s.ball[0]-s.players[5].x>1.8})()')
  report['keyboard']=await page.evaluate('window.__footballDebug.snapshot().ball')
  await page.keyboard.up('ArrowRight');await page.keyboard.up('e');await page.keyboard.press('Escape');await page.close()
  context=await browser.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True)
  touch=await context.new_page();touch.on('pageerror',lambda e:errors.append(str(e)))
  await start(touch,'http://127.0.0.1:5173','sarbah');await touch.evaluate(FRESH);await touch.get_by_role('button',name='RESUME').click()
  stick=await touch.get_by_role('application',name='Move player joystick').bounding_box()
  sprint=await touch.get_by_role('button',name='sprint',exact=True).bounding_box();button=await touch.get_by_role('button',name='pass',exact=True).bounding_box()
  a={'id':11,'x':stick['x']+stick['width']*.85,'y':stick['y']+stick['height']*.5}
  b={'id':12,'x':sprint['x']+sprint['width']*.5,'y':sprint['y']+sprint['height']*.5}
  c={'id':13,'x':button['x']+button['width']*.5,'y':button['y']+button['height']*.5}
  session=await context.new_cdp_session(touch)
  await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a,b]})
  await touch.wait_for_function('window.__footballDebug.snapshot().players[5].vx>6.5')
  await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a,b,c]})
  await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[c]})
  state=await touch.evaluate('window.__footballDebug.snapshot()')
  assert state['input']['touchSprint'] and not state['input']['passHold'], 'touch release must lift only PASS, leaving move+sprint held'
  await touch.wait_for_function('(()=>{const s=window.__footballDebug.snapshot();return s.possessor!==5&&s.ball[0]-s.players[5].x>1.8})()')
  report['touch']=await touch.evaluate('window.__footballDebug.snapshot().ball')
  await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  assert not errors,errors
  (out/'results.json').write_text(json.dumps(report,indent=2));print('PASS: full sides active, keyboard sprint-pass, three-finger touchscreen move+sprint+pass; ERRORS []',flush=True)
  await browser.close()
if __name__=='__main__':asyncio.run(main())
