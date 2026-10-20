"""Browser regression scenarios. Start npm run dev first.
Requires Python Playwright and Chromium (or Playwright's installed Chromium).
Optional: FOOTBALL_BASE_URL and CHROMIUM_PATH environment variables.
"""
import asyncio,json,os,shutil
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await b.new_page(viewport={'width':1200,'height':800});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(os.environ.get('FOOTBALL_BASE_URL', 'http://127.0.0.1:5173').rstrip('/') + '/?venue=sarbah')
  # Arrival opens match setup at that field; a computer is detected, so kickoff is one click.
  for name in ['YES · OPEN FOOTBALL','KICK OFF']:
   await page.get_by_role('button',name=name).first.click(timeout=60000)
  await page.wait_for_function('window.__footballDebug?.snapshot().started',timeout=120000)
  await page.keyboard.press('Escape')
  result=await page.evaluate('''() => {
    const d=window.__footballDebug;const results=[];
    function scenario(name,setup,time){const before=d.snapshot().events;d.scenario(setup);d.step(time);const s=d.snapshot();const events=Object.fromEntries(Object.keys(s.events).map(k=>[k,s.events[k]-before[k]]));const result={name,events,owner:s.awayCarrier,held:s.keeperHolding,ball:s.ball,velocity:s.velocity,players:s.players};results.push(result);return result;}
    const takeover=scenario('opponent tackle and counterattack',{ball:[-0.12,.11,0],owner:5,players:[{index:5,x:-.8,z:0},{index:10,x:1.3,z:0},...[1,2,3,4,6].map(index=>({index,x:-5000,z:0}))]},15);
    if(takeover.events.tackles<1||takeover.events.awayShots<1)throw Error('CPU did not tackle and shoot');
    const caught=scenario('home keeper catch',{ball:[-31,1,0],velocity:[-10,0,0],players:[{index:0,x:-34,z:0}]},.5);
    if(caught.events.catches<1||caught.held!==0)throw Error('Keeper failed to hold catch');
    if(d.snapshot().controlled!==0)throw Error('You do not control the keeper after his catch');d.step(0.4);d.press('j');d.release('j');let released=d.snapshot();results.push({name:'keeper distribution',held:released.keeperHolding,velocity:released.velocity});
    if(released.keeperHolding>=0||released.velocity[0]<=0)throw Error('Keeper failed to throw upfield');
    const held=scenario('keeper six-second rule',{ball:[-31,1,0],velocity:[-10,0,0],players:[{index:0,x:-34,z:0}]},.5);if(held.held!==0)throw Error('Keeper did not catch');d.step(6.5);if(d.snapshot().keeperHolding===0)throw Error('Keeper held the ball past six seconds');results.push({name:'six seconds',velocity:d.snapshot().velocity});
    const punched=scenario('high fast shot punch',{ball:[-31,2.2,0],velocity:[-22,0,0],players:[{index:0,x:-34,z:0}]},.25);
    if(punched.events.punches<1||punched.velocity[0]<=0)throw Error('Keeper failed to punch high shot');
    const dive=scenario('wide shot diving save',{ball:[-29,.7,2],velocity:[-18,0,0],players:[{index:0,x:-34,z:0}]},.45);
    if(dive.events.parries+dive.events.catches<1)throw Error('Keeper failed wide save');
    const away=scenario('away keeper catch',{ball:[31,1,0],velocity:[10,0,0],players:[{index:7,x:34,z:0}]},.5);
    if(away.events.catches<1||away.held!==7)throw Error('Away keeper failed catch');
    scenario('attacking shape',{ball:[20.68,.11,0],owner:5,players:[{index:5,x:20,z:0},{index:6,x:10,z:15}]},2);
    const runners=d.snapshot();if(runners.players[6].x<=20)throw Error('Forward did not make a run');
    results.push({name:'forward run',x:runners.players[6].x});
    return results.map(({players,...rest})=>rest);
  }''')
  print('PASS: tackle/counterattack, both keepers, catch/hold/distribution, high punch, wide dive, support run',flush=True)
  # Use the real keyboard mapping and the actual pass/control transfer loop.
  await page.evaluate("window.__footballDebug.scenario({ball:[.68,.11,0],owner:5,players:[{index:5,x:0,z:0},{index:6,x:12,z:0}]})")
  await page.keyboard.press('Escape')
  await page.keyboard.press('s')
  await page.keyboard.press('Escape')
  passed=await page.evaluate("(()=>{const d=window.__footballDebug; const start=d.snapshot();d.step(1.5);return {target:start.passTarget,startVelocity:start.velocity,end:d.snapshot().possessor,events:d.snapshot().events,ball:d.snapshot().ball,velocity:d.snapshot().velocity,receiver:d.snapshot().players[6]}})()")
  print('PASS: keyboard pass and receiver control transfer',flush=True)
  assert passed['target']==6 and passed['end']==6,passed
  await page.evaluate("window.__footballDebug.scenario({ball:[20.68,.11,17],owner:5,players:[{index:5,x:20,z:17},{index:6,x:20,z:7},...Array.from({length:6},(_,i)=>({index:i+8,x:5000,z:0}))]})")
  await page.keyboard.press('Escape')
  await page.keyboard.press('a')
  await page.keyboard.press('Escape')
  crossed=await page.evaluate("(()=>{const d=window.__footballDebug;const start=d.snapshot();d.step(3);return {target:start.passTarget,lift:start.velocity[1],end:d.snapshot().possessor}})()")
  assert crossed['target']==6 and crossed['lift']>=4 and crossed['end']==6,crossed
  print('PASS: lofted cross, attacking run and reception',flush=True)
  # A goal and a complete two-half match exercise result persistence. Opponents
  # are placed far away for this clock/result test, not for gameplay scenarios.
  await page.evaluate("window.__footballDebug.scenario({ball:[36,.11,0],velocity:[1,0,0]}); window.__footballDebug.step(3)")
  await page.evaluate("window.__footballDebug.scenario({ball:[-.12,.11,0],owner:5,players:Array.from({length:6},(_,i)=>({index:i+8,x:5000,z:0}))});window.__footballDebug.step(156)")
  await page.get_by_role('button',name='SECOND HALF').wait_for(timeout=10000)
  await page.get_by_role('button',name='SECOND HALF').click()
  await page.keyboard.press('Escape')
  # The second half restarts from a kickoff; clear the opponents away again.
  await page.evaluate("window.__footballDebug.scenario({ball:[-.12,.11,0],owner:5,players:Array.from({length:6},(_,i)=>({index:i+8,x:5000,z:0}))});window.__footballDebug.step(156)")
  await page.get_by_role('heading',name='FULL TIME',exact=True).wait_for(timeout=10000)
  won=await page.evaluate("JSON.parse(localStorage.getItem('legon-football-team-progress-v1'))")
  assert won['Commonwealth']['wins']==1,won
  await page.keyboard.press('Escape')
  assert await page.get_by_role('heading',name='FULL TIME',exact=True).is_visible()
  print('FULL MATCH: halftime, fulltime, one saved win, final screen cannot be bypassed',flush=True)
  print('ERRORS',errors,flush=True)
  assert not errors,errors
  await b.close()
asyncio.run(main())
