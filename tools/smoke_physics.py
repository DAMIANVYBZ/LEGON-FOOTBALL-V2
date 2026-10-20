"""Physics regressions in Vite, or a built-game desktop/touch smoke check.

python tools/smoke_physics.py
FOOTBALL_BASE_URL=http://127.0.0.1:4173 python tools/smoke_physics.py --production
Requires Python Playwright and Chromium, like smoke_match.py.
"""
import argparse
import asyncio
import os
import shutil

from playwright.async_api import async_playwright


async def start_match(page, base):
    await page.goto(base + '/?venue=sarbah')
    await page.get_by_role('button', name='YES · OPEN FOOTBALL').click()
    await page.get_by_role('button', name='KICK OFF').click()
    await page.locator('.match-loading').wait_for(state='hidden', timeout=120000)
    assert await page.locator('.game-view canvas').is_visible()
    assert not await page.locator('.model-status').all_text_contents(), 'player model or animations did not fully load'


async def development_checks(page):
    await page.keyboard.press('Escape')
    result = await page.evaluate('''() => {
      const d = window.__footballDebug;
      const players = Array.from({length:14}, (_,index) => ({index,x:5000,z:5000}));
      for (const direction of [{x:-1,z:0},{x:0,z:-1}]) {
        d.scenario({ball:[10.68,.11,0],owner:5,players:[...players,{index:5,x:10,z:0}]});
        d.aim(direction); d.shoot(.5);
        const v = d.snapshot().velocity;
        if (v[0]*direction.x+v[2]*direction.z < 20) throw Error('Shot ignored manual aim: '+v);
      }
      d.aim(null);
      d.scenario({ball:[.68,.11,0],owner:5,players:[...players,{index:5,x:0,z:0}]});
      d.press('k'); d.step(.3); d.release('k');
      window.dispatchEvent(new Event('blur')); d.step(.4);
      if (d.snapshot().possessor!==5 || Math.abs(d.snapshot().velocity[0])>.1)
        throw Error('A queued shot fired after focus was lost');
      // Opponents block the straight lane; a nearby diagonal receiver is free.
      d.scenario({ball:[.68,.11,0],owner:5,players:[...players,
        {index:5,x:0,z:0},{index:6,x:15,z:0},{index:4,x:15,z:5},{index:10,x:7,z:0}]});
      d.aim({x:1,z:0}); d.press('j'); d.release('j'); d.aim(null);
      if (d.snapshot().passTarget !== 4) throw Error('Pass assistance ignored the blocked lane');
      // A receiver must approach and control short, medium and longer passes.
      // Run the real movement, ball physics and possession-transfer loop.
      const receptions=[];
      for (const distance of [5, 12, 24]) {
        d.scenario({ball:[.68,.11,0],owner:5,players:[...players,
          {index:5,x:0,z:0},{index:6,x:distance,z:0}]});
        d.aim({x:1,z:0}); d.press('j'); d.release('j'); d.aim(null);
        if(d.snapshot().passTarget!==6) throw Error('Wrong receiver at '+distance+'m');
        let state=d.snapshot();
        for(let i=0;i<240 && state.possessor!==6;i++) {d.step(1/60);state=d.snapshot();}
        if(state.possessor!==6 || state.controlled!==6)
          throw Error('Pass not controlled at '+distance+'m: '+JSON.stringify(state));
        receptions.push(distance);
      }
      // Isolate a body deflection from the CPU's tackle decision. A temporarily
      // inactive opponent still has a physical collider, as during recovery.
      const deflections=[];
      for(const home of [true,false]) {
        const sign=home?1:-1,owner=home?5:12,blocker=home?10:4;
        d.scenario({ball:[sign*.68,.11,0],owner,players:[...players,
          {index:owner,x:0,z:0},{index:blocker,x:sign*.95,z:0,downFor:3}]});
        const before=d.snapshot().events.dribbleDeflections||0;
        d.step(.1);const s=d.snapshot();
        if(s.possessor>=0 || s.awayCarrier>=0 || s.lastTouchHome!==!home
          || (s.events.dribbleDeflections||0)!==before+1)
          throw Error('Body contact did not break dribble: '+JSON.stringify({home,state:s}));
        deflections.push(home?'home carrier':'away carrier');
      }
      // A ball just behind a player used to jump 1.4 m to their front in one
      // frame. Also check the vertical snap when an AI teammate receives it.
      const firstTouches=[];
      for(const raised of [false,true]) {
        const receiver=raised?6:5,height=raised?.75:.11;
        d.scenario({ball:[-.9,height,0],velocity:[2,0,0],players:[...players,
          {index:receiver,x:0,z:0}]});
        const initial=d.snapshot();d.step(1/60);const first=d.snapshot();
        const horizontal=Math.hypot(first.ball[0]-initial.ball[0],first.ball[2]-initial.ball[2]);
        if(first.possessor!==receiver || horizontal>.2 || initial.ball[1]-first.ball[1]>.09)
          throw Error('First touch snapped ball: '+JSON.stringify({raised,initial:initial.ball,first:first.ball,owner:first.possessor}));
        d.step(.6);const settled=d.snapshot(),player=settled.players[receiver];
        if(settled.possessor!==receiver || Math.hypot(settled.ball[0]-player.x,settled.ball[2]-player.z)>1.1 || settled.ball[1]>.15)
          throw Error('First touch failed to settle: '+JSON.stringify({raised,state:settled}));
        firstTouches.push(raised?'raised reception':'ball from behind');
      }
      // Measure the actual simulated flight, with both keepers out of its path.
      d.scenario({ball:[-18.68,.11,4],owner:12,players:[...players,{index:12,x:-18,z:4}]});
      d.cpuKick(12,'shoot',{x:-35.5,z:1,high:true});
      let shot = d.snapshot();
      for (let i=0;i<180 && shot.ball[0]>-35.5;i++) {d.step(1/60);shot=d.snapshot();}
      if (shot.ball[0]>-35.5 || Math.abs(shot.ball[2]-1)>.4 || shot.ball[1]<1.3 || shot.ball[1]>2.5)
        throw Error('CPU shot missed its height/line: '+JSON.stringify(shot.ball));
      d.scenario({ball:[-12.68,.11,15],owner:12,players:[...players,
        {index:12,x:-12,z:15},{index:13,x:-25,z:0}]});
      d.cpuKick(12,'cross',13);
      const cross=d.snapshot();
      if (cross.velocity[1]<3) throw Error('CPU cross was not lofted');
      return {receptions,deflections,firstTouches,shotAtGoal:shot.ball,crossVelocity:cross.velocity};
    }''')
    print('PASS: manual shot bearings, defender-aware passing, CPU shot height and lofted cross', result, flush=True)


async def production_checks(page, base):
    assert await page.evaluate('typeof window.__footballDebug') == 'undefined'
    # Use the browser's route/proxy, just like the game's update check. The
    # separate Node request client may not share the cloud browser's network.
    version = await page.evaluate('''async () => {
      const response=await fetch('/version.json', {cache:'no-store'});
      if(!response.ok)throw Error('Version request failed: '+response.status);
      return response.json();
    }''')
    assert version['commit'] and version['builtAt'] and version['id']
    expected = os.environ.get('FOOTBALL_EXPECT_BUILD_ID')
    if expected:
        assert version['id'] == expected, 'the server is serving a different build'
    # Keyboard movement must change the rendered player's radar position.
    await page.keyboard.down('ArrowRight')
    try:
        initial = await page.locator('.radar .dot.controlled').get_attribute('style')
        await page.wait_for_function('''initial => {
          const dot=document.querySelector('.radar .dot.controlled');
          return dot && dot.getAttribute('style')!==initial;
        }''', arg=initial)
    finally:
        await page.keyboard.up('ArrowRight')
    await page.keyboard.press('d')
    await page.keyboard.press('Escape')
    await page.get_by_role('heading', name='PAUSED', exact=True).wait_for()
    await page.get_by_role('button', name='RESUME').click()
    await page.get_by_role('heading', name='PAUSED', exact=True).wait_for(state='hidden')
    print('PASS: production desktop starts, keyboard movement works, pause/resume and version metadata work; no debug API', flush=True)


async def touch_checks(browser, base, errors):
    context = await browser.new_context(viewport={'width':844,'height':390}, is_mobile=True,
                                        has_touch=True, device_scale_factor=1)
    try:
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        await start_match(page, base)
        await page.locator('.game-shell.touch-mode').wait_for()
        await page.get_by_role('button', name='PAUSE', exact=False).click()
        await page.get_by_role('heading', name='PAUSED', exact=True).wait_for()
        initial = await page.locator('.radar .dot.controlled').get_attribute('style')
        await page.get_by_role('button', name='RESUME').click()
        stick = await page.get_by_role('application', name='Move player joystick').bounding_box()
        x = stick['x'] + stick['width'] * .85
        y = stick['y'] + stick['height'] * .5
        session = await context.new_cdp_session(page)
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        try:
            await page.wait_for_function('''initial => {
              const dot=document.querySelector('.radar .dot.controlled');
              return dot && dot.getAttribute('style')!==initial;
            }''', arg=initial)
        finally:
            await session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        # Test passing while the kickoff player still has the ball. Later
        # multi-finger gestures may legitimately give the CPU time to tackle.
        await page.get_by_role('button', name='pass', exact=True).tap()
        await page.wait_for_function('''() => {
          const message=document.querySelector('.game-message')?.textContent || '';
          return message==='PASS!' || message==='PASS RECEIVED';
        }''')
        # Resting a second finger on the stick must not release the original
        # drag when that second finger lifts.
        first={'id':11,'x':x,'y':y}
        second={'id':12,'x':stick['x']+stick['width']*.6,'y':y}
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[first]})
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[first,second]})
        await session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[second]})
        assert await page.locator('.joystick-knob').evaluate('(e)=>e.style.transform')!='translate(0px, 0px)'
        await session.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
        assert await page.locator('.joystick-knob').evaluate('(e)=>e.style.transform')=='translate(0px, 0px)'
        shoot=page.get_by_role('button',name='shoot',exact=True)
        box=await shoot.bounding_box()
        first={'id':21,'x':box['x']+box['width']*.4,'y':box['y']+box['height']*.5}
        second={'id':22,'x':box['x']+box['width']*.6,'y':box['y']+box['height']*.5}
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[first]})
        await session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[first,second]})
        await session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[second]})
        assert 'held' in (await shoot.get_attribute('class')), 'a second finger released the original button'
        await session.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
        assert 'held' not in (await shoot.get_attribute('class'))
        await page.get_by_role('button', name='PAUSE', exact=False).click()
        await page.get_by_role('heading', name='PAUSED', exact=True).wait_for()
        print('PASS: production landscape phone starts; joystick movement, multitouch ownership, pass and pause controls respond', flush=True)
    finally:
        await context.close()


async def main(production):
    base = os.environ.get('FOOTBALL_BASE_URL', 'http://127.0.0.1:5173').rstrip('/')
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True, args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            context = await browser.new_context(viewport={'width':1200,'height':800})
            page = await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            await start_match(page, base)
            if production:
                await production_checks(page, base)
            else:
                await development_checks(page)
            await context.close()
            if production:
                await touch_checks(browser, base, errors)
            assert not errors, errors
            print('ERRORS', errors, flush=True)
        finally:
            await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--production', action='store_true')
    asyncio.run(main(parser.parse_args().production))
