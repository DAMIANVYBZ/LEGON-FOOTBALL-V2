"""Replay match events and a first half in every venue; save a JSON audit.

Start Vite first. Requires Python Playwright and Chromium. No second half is
played. Deterministic event fixtures and accelerated play use the actual match
loop through the development-only debug API. Screenshots use the real renderer.
"""
import argparse
import asyncio
import json
from math import isfinite
import os
from pathlib import Path
import shutil
from time import monotonic

from playwright.async_api import async_playwright

VENUES = [
    ('sarbah', 71, 45), ('gonja', 59, 38), ('nania-main', 75, 48),
    ('nania-north', 66, 42), ('nania-east', 69, 44), ('astro', 56, 36),
    ('oval', 75, 45), ('ug-stadium', 79, 51),
]

EVENTS = r'''spec => {
  const d=window.__footballDebug, checks=[];
  const L=spec.length,W=spec.width,G=L/2;
  const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000}));
  const check=(name,fn)=>{try{const detail=fn();checks.push({name,passed:true,detail});}
    catch(error){checks.push({name,passed:false,error:String(error)});}};
  const expect=(value,message)=>{if(!value)throw Error(message);};
  const fresh=(options={})=>{
    for(const k of ['shift','h','f','v','t','g','k','l','j'])d.release(k);
    d.move(0,0);d.aim(null);
    d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:0,z:0}],...options});
  };
  check('jog, sprint, braking and reversing',()=>{
    fresh();d.move(1,0);d.step(1);const jog=d.snapshot().players[5].x;
    fresh();d.move(1,0);d.press('shift');d.step(1);const sprint=d.snapshot().players[5].x;
    expect(sprint>jog+.6,'Sprint did not increase travel');
    d.release('shift');d.move(0,0);d.step(.7);expect(Math.abs(d.snapshot().players[5].vx)<.01,'Player did not stop');
    d.move(1,0);d.step(.5);d.move(-1,0);d.step(1/60);expect(d.snapshot().players[5].vx>0,'Instant reversal');
    d.step(.8);expect(d.snapshot().players[5].vx<0,'Player could not reverse');d.move(0,0);
    return {jog,sprint};
  });
  check('pass and receiver control transfer',()=>{
    fresh({players:[...far,{index:5,x:0,z:0},{index:6,x:12,z:0}]});
    d.aim({x:1,z:0});d.press('j');d.release('j');expect(d.snapshot().passTarget===6,'Wrong receiver');
    d.step(1.8);expect(d.snapshot().possessor===6 && d.snapshot().controlled===6,'Pass not received');
  });
  check('through pass',()=>{
    fresh({players:[...far,{index:5,x:0,z:0},{index:6,x:12,z:0}]});
    d.aim({x:1,z:0});d.press('i');expect(d.snapshot().passTarget===6,'Through pass has no receiver');
    expect(d.snapshot().passDestination[0]>12,'Through pass did not lead the runner');
  });
  check('normal, low, finesse and power shots',()=>{
    for(const style of ['normal','low','finesse','power']){
      fresh({ball:[G-15,.11,0],players:[...far,{index:5,x:G-15.68,z:0}]});
      d.aim({x:1,z:0});d.shoot(.5,style);const v=d.snapshot().velocity;
      expect(v.every(Number.isFinite)&&v[0]>18,'Broken '+style+' shot');
    }
  });
  check('lob/cross stays lofted',()=>{
    fresh({ball:[G-14,.11,W*.37],players:[...far,{index:5,x:G-14.68,z:W*.37},{index:6,x:G-8,z:0}]});
    d.aim({x:1,z:-1});d.press('l');d.step(.35);d.release('l');
    expect(d.snapshot().velocity[1]>=3,'Cross stayed on ground');
  });
  check('standing tackle and resolved slide',()=>{
    fresh({ball:[1,.11,0],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:1.6,z:0,heading:Math.PI}]});
    const before=d.snapshot().events.tackles;d.tackle('standing');expect(d.snapshot().events.tackles>before,'Standing tackle failed');
    fresh({ball:[1,.11,0],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:1.6,z:0,heading:0}]});
    d.tackle('slide');expect(!d.snapshot().sliding,'Resolved slide kept running');
    expect(d.snapshot().players[5].sentOff,'From-behind slide did not award its seeded red card');
  });
  check('missed slide has a recovery delay',()=>{
    fresh({ball:[7,.11,0],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:7.68,z:0,heading:Math.PI}]});
    d.tackle('slide');d.step(.7);const s=d.snapshot();
    expect(s.players[5].downUntil>s.elapsed,'Missed slide had no recovery delay');
  });
  check('unreachable high ball passes over keeper',()=>{
    fresh({ball:[-G+4.5,5,0],velocity:[-25,0,0],owner:-1,players:[...far,{index:0,x:-G+1.5,z:0}]});
    const before=d.snapshot().events;d.step(.35);const after=d.snapshot().events;
    expect(after.catches===before.catches&&after.parries===before.parries&&after.punches===before.punches,'Keeper saved a five-metre-high ball');
  });
  check('keeper catch and distribution',()=>{
    fresh({ball:[-G+4.5,1,0],velocity:[-10,0,0],owner:-1,players:[...far,{index:0,x:-G+1.5,z:0},{index:5,x:-G+12,z:4}]});
    d.step(.5);expect(d.snapshot().keeperHolding===0,'Keeper did not catch');d.step(.4);d.press('j');d.release('j');
    expect(d.snapshot().keeperHolding<0&&d.snapshot().velocity[0]>0,'Keeper did not distribute');
  });
  check('deflection updates last touch',()=>{
    fresh({ball:[0,1,8],velocity:[20,0,0],owner:-1,touch:true,players:[...far,{index:5,x:-10,z:0},{index:10,x:2,z:8}]});
    d.step(.18);expect(d.snapshot().velocity[0]<0,'Fixture did not hit defender');
    expect(!d.snapshot().lastTouchHome,'Deflection still credited to attacking team');
  });
  check('goal-line restart ownership',()=>{
    for(const side of [-1,1])for(const homeTouch of [true,false]){
      fresh({ball:[side*(G+.2),.4,8],velocity:[side,0,0],owner:-1,touch:homeTouch});d.step(1/60);
      const defendingHome=side<0,corner=homeTouch===defendingHome,r=d.snapshot().restart;
      expect(r?.type===(corner?'corner':'goalKick'),'Wrong goal-line restart');
      expect(r.home===(corner?!defendingHome:defendingHome),'Restart awarded to wrong team');
    }
  });
  check('throw-in',()=>{
    fresh({ball:[0,.4,W/2+.2],velocity:[0,0,1],owner:-1,touch:true});d.step(1/60);
    expect(!d.snapshot().lastTouchHome,'Throw-in awarded to wrong side');
    expect(Math.abs(d.snapshot().ball[2])<W/2,'Throw-in remained outside pitch');
  });
  for(const home of [true,false]){
    check((home?'home':'away')+' corner, free kick, goal kick and penalty',()=>{
      for(const type of ['corner','freeKick','goalKick','penalty']){
        fresh();const sign=home?1:-1;
        const spot=type==='corner'?{x:sign*(G-.4),z:W/2-.4}:type==='goalKick'?{x:-sign*(G-4),z:3}:
          {x:sign*(G-(type==='penalty'?Math.min(11,L*.12):20)),z:0};
        d.restart(type,home,spot);d.step(.1);expect(d.snapshot().restart?.type===type,'Restart not established: '+type);
        if(home){
          const key=type==='corner'||type==='goalKick'?'l':'k';d.press(key);d.step(.4);d.release(key);d.step(.9);
        }else d.step(type==='penalty'?3.1:1.6);
        expect(d.snapshot().restart===null,'Restart did not release: '+type+' '+JSON.stringify(d.snapshot().restart));
        expect(d.snapshot().velocity.every(Number.isFinite),'Restart produced invalid velocity');
      }
    });
  }
  check('goal and net response',()=>{
    fresh({ball:[G+.2,.8,0],velocity:[12,0,0],owner:-1,touch:true});
    const before=d.snapshot().score[0];d.step(.4);expect(d.snapshot().score[0]===before+1,'Goal not counted');
    expect(d.snapshot().ball[0]<G+2.3,'Ball escaped the back net');
  });
  check('post rebound and frame effect',()=>{
    const goalWidth=spec.venue==='astro'?5.5:7.32;
    fresh({ball:[G-4.5,1,goalWidth/2+.04],velocity:[20,0,0],owner:-1,touch:true});
    const before=d.snapshot().events.woodwork||0;d.step(.35);
    expect((d.snapshot().events.woodwork||0)>before,'Post impact was not detected');
  });
  check('pause/blur cancel held controls and charging',()=>{
    fresh();d.press('shift');d.press('v');d.press('k');d.step(.3);
    window.dispatchEvent(new Event('blur'));
    expect(Object.values(d.snapshot().input).every(v=>!v),'Input survived blur');
  });
  return checks;
}'''


async def start(page, base, venue):
    await page.goto(base + '/?venue=' + venue)
    await page.get_by_role('button', name='YES · OPEN FOOTBALL').click()
    if venue == 'astro':
        await page.get_by_role('button', name='BOOK ASTROTURF').click()
        await page.get_by_role('button', name='RESERVE & PLAY').click()
    else:
        await page.get_by_role('button', name='KICK OFF').click()
    await page.wait_for_function('window.__footballDebug?.snapshot().started', timeout=120000)
    state = await page.evaluate('window.__footballDebug.snapshot()')
    assert state['physicsReady'] and state['clipsLoaded'] >= 25
    assert not await page.locator('.model-status').all_text_contents()
    await page.keyboard.press('Escape')


async def capture_play(page, path):
    # Photograph actual play, rather than the pause overlay used while stepping.
    paused = await page.evaluate('window.__footballDebug.snapshot().paused')
    if paused:
        await page.get_by_role('button', name='RESUME').click()
    await page.screenshot(path=str(path))
    if paused:
        await page.keyboard.press('Escape')


async def main(args):
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    base = os.environ.get('FOOTBALL_BASE_URL', 'http://127.0.0.1:5173').rstrip('/')
    report = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True, args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            selected = [v for v in VENUES if not args.venue or v[0] in args.venue]
            for venue, length, width in selected:
                context = await browser.new_context(viewport={'width':844,'height':390}, is_mobile=True, has_touch=True)
                entry = {'venue':venue, 'errors':[]}; report.append(entry)
                page = await context.new_page()
                page.on('pageerror', lambda error, item=entry: item['errors'].append(str(error)))
                try:
                    await start(page, base, venue)
                    entry['checks'] = await page.evaluate(EVENTS, {'venue':venue,'length':length,'width':width})
                    print(venue, 'events:', json.dumps(entry['checks']), flush=True)
                    # A separate match gives this first-half playthrough its own
                    # clock and score, independent of the reset event fixtures.
                    await context.close()
                    context = await browser.new_context(viewport={'width':844,'height':390}, is_mobile=True, has_touch=True)
                    page = await context.new_page()
                    page.on('pageerror', lambda error, item=entry: item['errors'].append(str(error)))
                    await start(page, base, venue)
                    await capture_play(page, output / (venue+'-kickoff.png'))
                    entry['camera'] = await page.evaluate('window.__footballDebug.camera()')
                    entry['timing'] = 'real time' if args.realtime else 'accelerated'
                    if args.realtime:
                        await page.get_by_role('button', name='RESUME').click()
                    play_started = monotonic()
                    for tick in range(300 if args.realtime else 155):
                        state = await page.evaluate('''({tick,advance}) => {
                          const d=window.__footballDebug,s=d.snapshot();
                          if(s.periodEnded)return s;
                          if(s.restart?.home){
                            if(s.setPiece?.phase==='aim')d.press(s.restart.type==='corner'?'l':'k');
                            else if(s.setPiece?.phase==='charge')d.release(s.setPiece.button);
                            else if(s.restart.type==='goalKick')d.press('j');
                          }else if(!s.restart){
                            const player=s.players[s.controlled],ball=s.ball;
                            if(s.possessor===s.controlled){
                              d.move(1,Math.sin(tick*.7)*.35);
                              if(tick%9===0){d.press('j');d.release('j');}
                              else if(tick%7===0)d.shoot(.45);
                            }else{
                              const dx=ball[0]-player.x,dz=ball[2]-player.z,n=Math.hypot(dx,dz)||1;
                              d.move(dx/n,dz/n);if(s.awayCarrier>=0&&n<1.5)d.tackle('standing');
                            }
                          }
                          if(advance)d.step(1);return d.snapshot();
                        }''', {'tick':tick,'advance':not args.realtime})
                        if args.realtime:
                            await asyncio.sleep(1)
                        assert all(isfinite(value) for value in state['ball']+state['velocity']), 'invalid ball state'
                        for player in state['players']:
                            assert all(isfinite(player[key]) for key in ['x','z','vx','vz','heading']), 'invalid player motion'
                            assert 0 <= player['stamina'] <= 1, 'invalid player stamina'
                        if tick % 30 == 0:
                            print(venue, 'first half:',tick,'input updates;',round(monotonic()-play_started,1),
                                  'wall seconds;',round(state['elapsed'],1),'game seconds; score',state['score'],flush=True)
                        if state['periodEnded']:
                            break
                        if tick == 45:
                            await capture_play(page, output / (venue+'-play.png'))
                    await page.get_by_role('heading', name='HALF TIME', exact=True).wait_for(timeout=10000)
                    entry['halfTime'] = await page.evaluate('window.__footballDebug.snapshot()')
                    entry['playbackWallSeconds'] = round(monotonic()-play_started,2)
                    assert entry['halfTime']['periodEnded'] and entry['halfTime']['paused']
                    await page.screenshot(path=str(output / (venue+'-halftime.png')))
                    print(venue, 'HALF TIME', entry['halfTime']['score'], 'errors', entry['errors'], flush=True)
                except Exception as error:
                    entry['failure'] = str(error)
                    print(venue, 'AUDIT FAILURE', str(error), flush=True)
                finally:
                    await context.close()
                    (output/'audit.json').write_text(json.dumps(report, indent=2))
        finally:
            await browser.close()
    failed = [entry for entry in report if entry.get('failure') or entry['errors'] or any(not check['passed'] for check in entry.get('checks', []))]
    print('AUDIT SUMMARY:',len(report),'venues;',len(failed),'with failures;',output/'audit.json',flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venue', action='append', choices=[v[0] for v in VENUES])
    parser.add_argument('--output', default='/workspace/playtest-artifacts')
    parser.add_argument('--realtime', action='store_true', help='play the first half at normal speed instead of stepping it')
    asyncio.run(main(parser.parse_args()))
