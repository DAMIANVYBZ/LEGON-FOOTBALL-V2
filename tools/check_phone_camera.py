"""Check phone magnification, touchline framing and idle paused rendering.

Run against Vite. Requires Python Playwright and Chromium. Measurements and
an actual rendered phone screenshot are saved outside the source checkout.
"""
import asyncio
import json
import os
from pathlib import Path
import shutil

from playwright.async_api import async_playwright


async def frames(page):
    await page.evaluate('async () => { for (let i=0;i<3;i++) await new Promise(requestAnimationFrame); }')


async def main():
    base = os.environ.get('FOOTBALL_BASE_URL', 'http://127.0.0.1:5173').rstrip('/')
    output = Path(os.environ.get('FOOTBALL_AUDIT_OUTPUT', '/workspace/playtest-artifacts'))
    output.mkdir(parents=True, exist_ok=True)
    report = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True, args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            for device in ['phone', 'tablet', 'computer']:
                context = await browser.new_context(viewport={'width':844,'height':390},
                    is_mobile=device!='computer', has_touch=device!='computer')
                try:
                    page = await context.new_page()
                    await page.goto(base+'/?venue=sarbah')
                    await page.get_by_role('button', name='YES · OPEN FOOTBALL').click()
                    await page.get_by_role('button', name='DEVICE ·').click()
                    if device == 'tablet':
                        await page.get_by_role('button', name='TABLET / IPAD').click()
                        await page.get_by_role('button', name='TOUCH', exact=True).click()
                    else:
                        await page.get_by_role('button', name=device.upper(), exact=False).filter(has=page.locator('strong')).click()
                    await page.get_by_role('button', name='KICK OFF').click()
                    await page.wait_for_function('window.__footballDebug?.snapshot().started', timeout=120000)
                    await page.keyboard.press('Escape')
                    await frames(page)
                    camera = await page.evaluate('window.__footballDebug.camera()')
                    await asyncio.sleep(0.35)
                    extra = (await page.evaluate('window.__footballDebug.camera()'))['renderedFrames'] - camera['renderedFrames']
                    assert extra <= 1, 'the paused game kept rendering'
                    report[device] = {'kickoff':camera, 'idleFrames':extra,
                        'playerPixels':abs(camera['head'][1]-camera['foot'][1])*195}
                    if device == 'phone':
                        assert camera['shadowSize'] == 1024, 'phone shadow map did not use the lighter default'
                        await page.get_by_role('button', name='RESUME').click()
                        # A deliberately long frame must count as real time for
                        # quality control, even though physics limits catch-up.
                        quality_delta = await page.evaluate('''async () => {
                          const d=window.__footballDebug,before=d.camera().qualityTime;
                          const until=performance.now()+600;
                          while(performance.now()<until) {}
                          await new Promise(requestAnimationFrame);
                          return d.camera().qualityTime-before;
                        }''')
                        assert quality_delta >= .5, 'quality timing was capped with physics time'
                        report[device]['slowFrameQualitySeconds'] = quality_delta
                        await page.screenshot(path=str(output/'phone-after.png'))
                        await page.keyboard.press('Escape')
                        for z in [-22, -19, 19, 22]:
                            await page.evaluate('''z => {
                              const d=window.__footballDebug;
                              d.scenario({ball:[.68,.11,z],owner:5,players:[{index:5,x:0,z}]});d.step(.05);
                            }''', z)
                            await frames(page)
                            report[device]['touchline'+str(z)] = await page.evaluate('window.__footballDebug.camera()')
                        await page.evaluate("window.__footballDebug.restart('freeKick',true,{x:15,z:0});window.__footballDebug.step(.05)")
                        await frames(page)
                        # Restart framing now eases the phone lens instead of
                        # changing zoom instantly; verify the actual settled view.
                        initial_zoom=await page.evaluate('window.__footballDebug.camera().zoom')
                        assert 1 <= initial_zoom <= 1.25
                        await page.get_by_role('button', name='RESUME').click()
                        await page.wait_for_function('window.__footballDebug.camera().zoom===1',timeout=10000)
                        await page.keyboard.press('Escape')
                        await frames(page)
                        report[device]['setPiece'] = await page.evaluate('window.__footballDebug.camera()')
                finally:
                    await context.close()
        finally:
            await browser.close()
    ratio = report['phone']['playerPixels'] / report['tablet']['playerPixels']
    assert abs(ratio-1.25) < 0.02, ratio
    assert report['phone']['setPiece']['zoom'] == 1
    assert report['phone']['touchline-19']['head'][1] < .59, 'far-touchline player hidden by scoreboard'
    assert abs(report['phone']['touchline19']['foot'][1]) < 1, 'near-touchline player out of frame'
    assert report['phone']['touchline-22']['head'][1] < .59, 'player at the far line hidden by the scoreboard'
    assert abs(report['phone']['touchline22']['foot'][1]) < 1, 'newly reachable near-line player out of frame'
    assert report['computer']['kickoff']['zoom'] == report['tablet']['kickoff']['zoom'] == 1
    assert report['computer']['kickoff']['shadowSize'] == report['tablet']['kickoff']['shadowSize'] == 2048
    (output/'camera-check.json').write_text(json.dumps(report, indent=2))
    print('PASS: phone size ratio', ratio, '; unchanged tablet/desktop; touchline framing; set-piece view; paused rendering', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
