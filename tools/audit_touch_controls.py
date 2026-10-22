"""Touch-only context actions, possession changes, multi-finger input and clear glass."""
import asyncio,json,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start

FRESH=r'''(defending)=>{const d=window.__footballDebug,n=d.snapshot().players.length,c=n/2-2;
 d.move(0,0);d.scenario({ball:defending?[.9,.11,0]:[.38,.11,0],owner:defending?n/2+c:c,
 players:[...Array.from({length:n},(_,index)=>({index,x:2000,z:2000,freezeFor:60})),{index:c,x:0,z:0,freezeFor:0},...(defending?[{index:n/2+c,x:1.6,z:0,heading:Math.PI,freezeFor:60}]:[])]});
}'''
async def point(page,name,id):
 box=await page.get_by_role('button',name=name,exact=True).bounding_box();return {'id':id,'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}
async def main():
 out=Path('/workspace/playtest-artifacts/touch-controls');out.mkdir(parents=True,exist_ok=True)
 errors=[];report={}
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  ctx=await b.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True)
  page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.add_init_script("localStorage.setItem('legon-football-preferences-v2',JSON.stringify({touch:{opacity:.08}}));")
  await start(page,'http://127.0.0.1:5173','sarbah');await page.get_by_role('button',name='RESUME').click()
  await page.evaluate(FRESH,False);await page.get_by_role('button',name='jockey',exact=True).wait_for()
  assert await page.locator('.action-pad .action-button').count()==4
  report['glass']=await page.locator('.action-pad .action-button').evaluate_all("els=>els.map(e=>{const s=getComputedStyle(e);return {label:e.ariaLabel,opacity:s.opacity,background:s.backgroundImage,filter:s.backdropFilter}})")
  assert all(s['opacity']=='1' and 'blur(1px)' in s['filter'] for s in report['glass']),report['glass']
  await page.screenshot(path=str(out/'attack-clear-glass.png'))
  session=await ctx.new_cdp_session(page)
  # Hold jockey: use the game's existing shielding mechanic and release it.
  a=await point(page,'jockey',11);await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a]})
  assert await page.evaluate('window.__footballDebug.snapshot().input.shieldHold')
  await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  assert not await page.evaluate('window.__footballDebug.snapshot().input.shieldHold')
  # A held pass may not become a standing tackle when possession changes.
  x=await point(page,'pass',12);await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[x]})
  state=await page.evaluate('window.__footballDebug.snapshot()');assert state['input']['passHold'],state
  await page.evaluate(FRESH,True);await page.get_by_role('button',name='tackle',exact=True).wait_for()
  assert not await page.evaluate('window.__footballDebug.snapshot().input.passHold')
  before=await page.evaluate('window.__footballDebug.snapshot().events.passes')
  await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  assert await page.evaluate('window.__footballDebug.snapshot().events.passes')==before
  await page.screenshot(path=str(out/'defence-clear-glass.png'))
  # Cross makes a genuine upright poke, wins the exposed ball, then becomes PASS.
  before=await page.evaluate('window.__footballDebug.snapshot().events.tackles')
  await page.get_by_role('button',name='tackle',exact=True).tap()
  state=await page.evaluate('window.__footballDebug.snapshot()')
  assert state['events']['tackles']==before+1 and not state['sliding'] and state['possessor']==state['controlled'],state
  await page.get_by_role('button',name='pass',exact=True).wait_for();report['standing']=True
  # Circle makes a real slide, never a shot or upright tackle.
  await page.evaluate(FRESH,True);await page.get_by_role('button',name='slide',exact=True).wait_for()
  await page.get_by_role('button',name='slide',exact=True).tap()
  assert await page.evaluate('window.__footballDebug.snapshot().sliding');report['slide']=True
  # Switch changes selected player in defence.
  await page.evaluate(FRESH,True);await page.get_by_role('button',name='switch',exact=True).wait_for()
  before=await page.evaluate('window.__footballDebug.snapshot().controlled');await page.get_by_role('button',name='switch',exact=True).tap()
  assert await page.evaluate('window.__footballDebug.snapshot().controlled')!=before;report['switch']=True
  # Keep joystick+sprint held when the context labels flip.
  await page.evaluate(FRESH,False);await page.get_by_role('button',name='jockey',exact=True).wait_for()
  stick=await page.get_by_role('application',name='Move player joystick').bounding_box()
  j={'id':21,'x':stick['x']+stick['width']*.85,'y':stick['y']+stick['height']*.5};sp=await point(page,'sprint',22)
  await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[j,sp]})
  await page.wait_for_function('(()=>{const s=window.__footballDebug.snapshot();return s.players[s.controlled].vx>4})()')
  # Preserve the live stick axis; only transfer the ball to the opponent.
  await page.evaluate(FRESH.replace('d.move(0,0);',''),True);await page.get_by_role('button',name='switch',exact=True).wait_for()
  assert await page.evaluate('window.__footballDebug.snapshot().input.touchSprint')
  await page.wait_for_function('(()=>{const s=window.__footballDebug.snapshot();return s.players[s.controlled].vx>1})()')
  await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  assert not await page.evaluate('window.__footballDebug.snapshot().input.touchSprint');report['heldMovement']=True
  # Attack still uses a charged pass through the real touch button.
  await page.evaluate(FRESH,False);await page.get_by_role('button',name='pass',exact=True).wait_for()
  before=await page.evaluate('window.__footballDebug.snapshot().events.passes')
  x=await point(page,'pass',31);await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[x]})
  await page.wait_for_function('window.__footballDebug.snapshot().input.power>.2')
  await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  await page.wait_for_function('n=>window.__footballDebug.snapshot().events.passes>n',arg=before);report['pass']=True
  await page.evaluate(FRESH,False);await page.get_by_role('button',name='shoot',exact=True).wait_for()
  shot=await point(page,'shoot',41);await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[shot]})
  await page.wait_for_function('window.__footballDebug.snapshot().input.power>.2')
  await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  await page.wait_for_function('(()=>{const s=window.__footballDebug.snapshot();return !s.sliding&&s.possessor!==s.controlled&&Math.hypot(...s.velocity)>10})()');report['shot']=True
  # A teammate's possession leaves attack labels active; far-away attack taps
  # must not run the keyboard's fallback standing tackle.
  await page.evaluate('''()=>{const d=window.__footballDebug,n=d.snapshot().players.length,c=n/2-2;
   d.scenario({ball:[6.38,.11,0],owner:c-1,players:[...Array.from({length:n},(_,index)=>({index,x:2000,z:2000,freezeFor:60})),{index:c,x:0,z:0,freezeFor:0},{index:c-1,x:6,z:0,freezeFor:60}]});}''')
  await page.get_by_role('button',name='shoot',exact=True).tap();await page.get_by_role('button',name='pass',exact=True).tap()
  state=await page.evaluate('window.__footballDebug.snapshot()')
  assert not state['input']['passHold'] and not state['input']['shootHold'] and not state['sliding'],state
  assert state['players'][state['controlled']]['action']!='pass','off-ball shoot/pass unexpectedly made a standing poke';report['offBall']=True
  assert not errors,errors;report['errors']=errors
  (out/'results.json').write_text(json.dumps(report,indent=2));print('PASS: four clear-glass buttons; attack/defence labels; shield hold/release; upright tackle and slide; player switch; possession-safe cancellation; joystick+sprint survive transitions; charged pass and shot; ERRORS []',flush=True)
  await b.close()
if __name__=='__main__':asyncio.run(main())
