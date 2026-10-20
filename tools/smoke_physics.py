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
      // Opponents block the straight lane; a nearby diagonal receiver is free.
      d.scenario({ball:[.68,.11,0],owner:5,players:[...players,
        {index:5,x:0,z:0},{index:6,x:15,z:0},{index:4,x:15,z:5},{index:10,x:7,z:0}]});
      d.aim({x:1,z:0}); d.press('j'); d.release('j'); d.aim(null);
      if (d.snapshot().passTarget !== 4) throw Error('Pass assistance ignored the blocked lane');
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
      return {shotAtGoal:shot.ball,crossVelocity:cross.velocity};
    }''')
    print('PASS: manual shot bearings, defender-aware passing, CPU shot height and lofted cross', result, flush=True)


async def production_checks(page, base):
    assert await page.evaluate('typeof window.__footballDebug') == 'undefined'
    response = await page.request.get(base + '/version.json')
    assert response.ok
    version = await response.json()
    assert version['commit'] and version['builtAt'] and version['id']
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
        await page.get_by_role('button', name='pass', exact=True).tap()
        await page.wait_for_function('''() => {
          const message=document.querySelector('.game-message')?.textContent || '';
          return message==='PASS!' || message==='PASS RECEIVED';
        }''')
        await page.get_by_role('button', name='PAUSE', exact=False).click()
        await page.get_by_role('heading', name='PAUSED', exact=True).wait_for()
        print('PASS: production landscape phone starts; touch joystick moves the player, pass and pause controls respond', flush=True)
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
