"""Replay boundary, keeper distribution and interrupted phone-input regressions.

Run against Vite. Uses the real match simulation and Chromium touch events;
this is emulation, not physical-phone frame-rate validation.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil

from playwright.async_api import async_playwright
from audit_first_half import VENUES, start


EVENTS = r'''spec => {
  const d=window.__footballDebug,checks=[],G=spec.length/2,W=spec.width/2;
  const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000}));
  const fresh=options=>{d.move(0,0);d.aim(null);d.scenario({owner:-1,touch:true,players:far,...options});};
  const expect=(value,message)=>{if(!value)throw Error(message);};
  const check=(name,fn)=>{try{checks.push({name,passed:true,detail:fn()});}
    catch(error){checks.push({name,passed:false,error:String(error)});}};
  check('whole ball must leave either touchline',()=>{
    for(const sign of [-1,1]){
      fresh({ball:[0,.11,sign*(W+.04)]});d.step(1/60);
      expect(d.snapshot().lastTouchHome,'Premature throw-in');
      fresh({ball:[0,.11,sign*(W+.14)]});d.step(1/60);
      expect(!d.snapshot().lastTouchHome,'Missing throw-in after whole ball crossed');
    }
  });
  check('whole ball must leave either goal line outside the posts',()=>{
    for(const sign of [-1,1])for(const touch of [true,false]){
      fresh({ball:[sign*(G+.04),.11,8],touch});d.step(1/60);
      expect(!d.snapshot().restart,'Premature goal-line restart');
      fresh({ball:[sign*(G+.14),.11,8],touch});d.step(1/60);
      const r=d.snapshot().restart,defendingHome=sign<0,corner=touch===defendingHome;
      expect(r?.type===(corner?'corner':'goalKick'),'Wrong restart after full crossing');
      expect(r.home===(corner?!defendingHome:defendingHome),'Wrong restart team');
    }
  });
  check('all four pitch edges remain reachable with the ball in play',()=>{
    const positions=[];
    for(const axis of ['x','z'])for(const sign of [-1,1]){
      const half=axis==='x'?G:W;
      const x=axis==='x'?sign*(half-2.1):0,z=axis==='z'?sign*(half-2.1):8;
      const ball=axis==='x'?[sign*(half-.4),.11,z]:[x,.11,sign*(half-.4)];
      fresh({ball,players:[...far,{index:5,x,z,heading:axis==='x'?(sign>0?0:Math.PI):sign*Math.PI/2}]});
      d.move(axis==='x'?sign:0,axis==='z'?sign:0);d.step(.35);d.move(0,0);
      const s=d.snapshot();expect(s.possessor===5,'Could not retrieve the '+axis+' '+sign+' line ball');
      expect(!s.restart,'Retrieval triggered an unwanted restart');
      positions.push({axis,sign,player:s.players[5][axis],ball:s.ball});
    }
    return positions;
  });
  check('diagonal goal-line exit does not also award a throw-in',()=>{
    for(const sign of [-1,1]){
      fresh({ball:[sign*(G-.1),.6,W-.1],velocity:[sign*20,0,15],touch:sign>0});d.step(1/60);
      const s=d.snapshot();expect(s.restart?.type==='goalKick','Double restart at pitch corner');
      expect(s.restart.home===(sign<0),'Wrong team after diagonal exit');
    }
  });
  check('diagonal touchline exit does not also award a corner',()=>{
    fresh({ball:[G-.1,.6,W-.05],velocity:[15,0,20]});d.step(1/60);
    const s=d.snapshot();expect(!s.restart&&!s.lastTouchHome,'Double restart after touchline crossing');
    expect(s.ball[0]<=G,'Throw-in was placed beyond the end line');
  });
  check('opponent keeper selects his own teammate regardless of human aim',()=>{
    fresh({ball:[G-2,1,0],players:[...far,{index:7,x:G-1.5,z:0},
      {index:5,x:G-12,z:-7},{index:12,x:G-12,z:7}]});
    const targets=[];
    for(const input of [[0,0],[-1,-.5],[-1,.5],[1,0]]){
      d.move(...input);const target=d.distributionTarget(7);
      expect(target===12,'Opponent keeper selected a human player: '+target);targets.push(target);
    }
    d.move(0,0);return targets;
  });
  return checks;
}'''


async def phone_checks(page, context, length):
    """Use actual touch start/end/cancel events; observe match state afterwards."""
    await page.get_by_role('button', name='RESUME').click()
    session=await context.new_cdp_session(page)
    checks=[]

    async def fresh():
        await page.evaluate('''() => {
          const d=window.__footballDebug;
          const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000}));
          d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:0,z:0}]});
        }''')

    async def touch_start(label):
        button=page.get_by_role('button',name=label,exact=True)
        box=await button.bounding_box()
        await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[
            {'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}]})

    async def finish(cancel=False):
        await session.send('Input.dispatchTouchEvent',{'type':'touchCancel' if cancel else 'touchEnd','touchPoints':[]})

    await fresh()
    await touch_start('shoot')
    await page.evaluate('window.__footballDebug.step(.25)')
    await finish(cancel=True)
    await page.evaluate('window.__footballDebug.step(.4)')
    state=await page.evaluate('window.__footballDebug.snapshot()')
    assert state['possessor']==5 and abs(state['velocity'][0])<.1,'cancelled phone touch fired a shot'
    assert await page.locator('.action-button.held').count()==0
    checks.append({'name':'cancelled phone shot keeps possession and clears held styling','passed':True})

    await fresh()
    await touch_start('shoot')
    await page.evaluate('window.__footballDebug.step(.25)')
    await finish()
    await page.evaluate('window.__footballDebug.step(.4)')
    state=await page.evaluate('window.__footballDebug.snapshot()')
    assert state['possessor']<0 and state['velocity'][0]>10,'normal phone shot release no longer works'
    checks.append({'name':'intentional phone shot still releases normally','passed':True})

    await fresh()
    await page.evaluate('''x => {
      window.__footballDebug.restart('freeKick',true,{x,z:0});window.__footballDebug.step(.1);
    }''',length/2-20)
    await touch_start('shoot')
    await page.evaluate('window.__footballDebug.step(.25)')
    await finish(cancel=True)
    await page.evaluate('window.__footballDebug.step(1)')
    state=await page.evaluate('window.__footballDebug.snapshot()')
    assert state['restart']['type']=='freeKick' and state['setPiece']['phase']=='aim','touch cancellation took the free kick'
    assert state['input']['power']==0
    checks.append({'name':'cancelled set-piece charge returns to aiming without striking','passed':True})

    await fresh()
    await touch_start('shoot')
    await page.evaluate('window.__footballDebug.step(.2);window.dispatchEvent(new Event("blur"))')
    assert await page.locator('.action-button.held').count()==0,'held phone button survived focus loss'
    await finish()
    await page.evaluate('window.__footballDebug.step(.4)')
    assert (await page.evaluate('window.__footballDebug.snapshot()'))['possessor']==5
    # Start a new gesture immediately, rather than requiring an extra tap to
    # clear the abandoned pointer from the component.
    await touch_start('shoot')
    await page.evaluate('window.__footballDebug.step(.1)')
    assert (await page.evaluate('window.__footballDebug.snapshot()'))['input']['shootHold']
    await finish(cancel=True)
    checks.append({'name':'focus loss clears phone button state and accepts the next gesture','passed':True})

    stick=await page.get_by_role('application',name='Move player joystick').bounding_box()
    point={'x':stick['x']+stick['width']*.85,'y':stick['y']+stick['height']*.5}
    await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
    assert await page.locator('.joystick-knob').evaluate('(e)=>e.style.transform')!='translate(0px, 0px)'
    await page.keyboard.press('Escape')
    await page.get_by_role('heading',name='PAUSED',exact=True).wait_for()
    assert await page.locator('.joystick-knob').evaluate('(e)=>e.style.transform')=='translate(0px, 0px)','paused joystick stayed off-centre'
    await finish()
    assert await page.get_by_role('button',name='shoot',exact=True).is_disabled()
    await page.get_by_role('button',name='RESUME').click()
    assert await page.get_by_role('button',name='shoot',exact=True).is_enabled()
    checks.append({'name':'pause centres the phone joystick and disables actions until resume','passed':True})
    await page.keyboard.press('Escape')
    return checks


async def main(args):
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    base=os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173').rstrip('/')
    report=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            for venue,length,width in VENUES:
                if args.venue and venue not in args.venue:continue
                context=await browser.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True)
                entry={'venue':venue,'errors':[]};report.append(entry)
                try:
                    page=await context.new_page()
                    page.on('pageerror',lambda error,item=entry:item['errors'].append(str(error)))
                    await start(page,base,venue)
                    entry['checks']=await page.evaluate(EVENTS,{'length':length,'width':width})
                    entry['checks']+=await phone_checks(page,context,length)
                    assert not entry['errors'],entry['errors']
                    assert all(check['passed'] for check in entry['checks']),entry['checks']
                    print(venue,json.dumps(entry['checks']),flush=True)
                except Exception as error:
                    entry['failure']=str(error);print(venue,'FAIL',error,flush=True)
                finally:
                    await context.close()
                    (output/'match-edges.json').write_text(json.dumps(report,indent=2))
        finally:await browser.close()
    assert report and all(not entry.get('failure') for entry in report),report
    print('PASS:',sum(len(entry['checks']) for entry in report),'edge/input groups across',len(report),'venues',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venue',action='append')
    parser.add_argument('--output',default='/workspace/playtest-round2')
    asyncio.run(main(parser.parse_args()))
