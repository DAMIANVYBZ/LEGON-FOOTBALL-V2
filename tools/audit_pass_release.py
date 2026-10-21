"""Directional close-control passes must travel, not just increment a pass counter."""
import asyncio,json,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start

SETUP='''()=>{const d=window.__footballDebug,distance=8;
 d.scenario({ball:[.38,.11,0],owner:5,players:[...Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30})),{index:5,x:0,z:0},{index:6,x:-distance,z:0}]});d.aim({x:-1,z:0});d.step(.4);
}'''
async def main():
 out=Path('/workspace/playtest-artifacts/pass-release');out.mkdir(parents=True,exist_ok=True)
 errors=[];report={}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1280,'height':720});page.on('pageerror',lambda e:errors.append(str(e)))
  await page.add_init_script('''window.__pad={index:0,id:'Xbox test',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.__pad]});''')
  await start(page,'http://127.0.0.1:5173','sarbah')
  report['directions']=await page.evaluate('''()=>{
   const d=window.__footballDebug,far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30})),out=[];
   for(let angle=0;angle<Math.PI*2-.01;angle+=Math.PI/4)for(const hold of [.05,.3,.8]){
    const x=Math.cos(angle),z=Math.sin(angle);
    d.scenario({ball:[.38,.11,0],owner:5,players:[...far,{index:5,x:0,z:0},{index:6,x:8*x,z:8*z,downFor:30}]});
    d.aim({x,z});d.step(.4);d.press('j');d.step(hold);const start=d.snapshot().ball;d.release('j');
    d.step(.35);let s=d.snapshot(),progress=(s.ball[0]-start[0])*x+(s.ball[2]-start[2])*z;
    if(progress<1.7||s.possessor===5)throw Error('pass blocked '+JSON.stringify({angle,hold,progress,state:s}));
    const speed=Math.hypot(s.velocity[0],s.velocity[2]);
    out.push({angle,hold,progress,speed,received:s.possessor===6});
   }return out;
  }''')
  await page.evaluate(SETUP)
  await page.get_by_role('button',name='RESUME').click()
  await page.keyboard.down('s');await page.wait_for_function('window.__footballDebug.snapshot().input.power>=.25');await page.keyboard.up('s')
  await page.wait_for_function('window.__footballDebug.snapshot().ball[0]<-1.5')
  await page.keyboard.press('Escape');report['keyboard']=await page.evaluate('''()=>{const d=window.__footballDebug;d.step(2);const s=d.snapshot();if(s.possessor!==6)throw Error('backward receiver did not collect '+JSON.stringify(s));return s.ball;}''')
  await page.evaluate(SETUP)
  # Poll the real gamepad reader without changing the attack direction via its stick.
  await page.get_by_role('button',name='RESUME').click()
  report['controller']=await page.evaluate('''()=>{const d=window.__footballDebug,p=window.__pad;
   p.buttons[0]={pressed:true,value:1};d.pollGamepad();d.step(.3);p.buttons[0]={pressed:false,value:0};d.pollGamepad();
   d.step(.35);const s=d.snapshot();if(s.ball[0]>-1.5||s.possessor===5)throw Error('controller backward pass stuck');return {ball:s.ball,velocity:s.velocity};}''')
  await page.keyboard.press('Escape')
  # A real touchscreen tap must also release a pass across the player's stance.
  context=await browser.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True)
  touch=await context.new_page();touch.on('pageerror',lambda e:errors.append(str(e)))
  await start(touch,'http://127.0.0.1:5173','sarbah');await touch.evaluate(SETUP.replace('{index:6,x:-distance,z:0}', '{index:6,x:-distance,z:0,downFor:30}'))
  await touch.get_by_role('button',name='RESUME').click()
  await touch.get_by_role('button',name='pass',exact=True).tap()
  await touch.wait_for_function('window.__footballDebug.snapshot().ball[0]<-1.3')
  report['touch']=await touch.evaluate('window.__footballDebug.snapshot().ball')
  assert not errors,errors
  (out/'results.json').write_text(json.dumps(report,indent=2));print('PASS: 24 directional charged/quick passes; backward receiver collection; real keyboard, controller and touchscreen backward passes; ERRORS []',flush=True)
  await browser.close()
if __name__ == '__main__':
 asyncio.run(main())
