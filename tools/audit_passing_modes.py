"""Check saved passing modes through the real Settings UI and match loop."""
import argparse,asyncio,json,os,re,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start,EVENTS

CHECKS=r'''mode=>{
 const d=window.__footballDebug,checks=[];
 const far=Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:100}));
 const expect=(ok,msg)=>{if(!ok)throw Error(msg)};
 const test=(name,fn)=>{try{checks.push({name,passed:true,detail:fn()})}catch(e){checks.push({name,passed:false,error:String(e)})}};
 function fresh(x=0,z=0,mateX=12,mateZ=3){
  for(const k of ['j','i','l','k','shift'])d.release(k);d.move(0,0);d.aim({x:1,z:0});
  d.scenario({ball:[x+.38,.11,z],owner:5,players:[...far,{index:5,x,z},{index:6,x:mateX,z:mateZ,freezeFor:20}]});
 }
 function launch(key,hold,x=0,z=0,mx=12,mz=3){fresh(x,z,mx,mz);d.press(key);d.step(hold);d.release(key);return d.snapshot()}
 test('saved mode reaches match engine',()=>expect(d.snapshot().passingAssistance===mode,'wrong match mode'));
 test('short-pass aim and charge match selected mode',()=>{
  const weak=launch('j',.15),strong=launch('j',.75);
  const angle=Math.atan2(weak.velocity[2],weak.velocity[0]);
  expect(weak.velocity[0]>0&&strong.velocity[0]>0,'pass not released');
  if(mode==='manual'){
   expect(Math.abs(angle)<1e-8&&weak.passTarget===-1,'manual pass snapped to teammate');
   expect(strong.velocity[0]>weak.velocity[0]+8,'manual hold did not control power');
   const different=launch('j',.15,0,0,30,-10);
   expect(Math.hypot(...weak.velocity.map((v,i)=>v-different.velocity[i]))<1e-8,'manual power/aim depends on teammate');
  }else if(mode==='semi'){
   expect(angle>0&&angle<=.101,'semi overcorrected aim: '+angle);
   expect(strong.velocity[0]>weak.velocity[0]+5,'semi hold has too little effect');
  }else expect(angle>.15&&weak.passTarget===6,'assisted did not target recipient');
  return {angle,weak:weak.velocity,strong:strong.velocity,target:weak.passTarget};
 });
 test('light pass power compensates for recipient distance only when assisted',()=>{
  const near=launch('j',.15,0,0,6,0),long=launch('j',.15,0,0,32,0);
  if(mode==='assisted')expect(long.velocity[0]>near.velocity[0]+4,'assisted did not weight long pass');
  if(mode==='manual')expect(Math.abs(long.velocity[0]-near.velocity[0])<1e-8,'manual auto-weighted power');
  return {near:near.velocity,long:long.velocity};
 });
 test('crosses follow mode aim and held power',()=>{
  const weak=launch('l',.15,22,16,30,0),strong=launch('l',.75,22,16,30,0);
  expect(weak.velocity[1]>3&&strong.velocity[1]>3,'cross stayed on ground');
  if(mode==='manual'){
   expect(Math.abs(weak.velocity[2])<1e-8&&Math.abs(strong.velocity[2])<1e-8,'manual cross changed bearing');
   expect(strong.velocity[0]>weak.velocity[0]+8&&strong.velocity[1]>weak.velocity[1]+3,'manual cross charge ignored');
   expect(weak.spin.y===0,'manual cross gained AI side curl');
  }
  if(mode==='semi')expect(Math.abs(weak.velocity[2])<1e-8,'semi locked onto receiver outside lane');
  if(mode==='assisted')expect(weak.velocity[2]<-3&&weak.passTarget===6,'assisted cross missed box target');
  return {weak:weak.velocity,strong:strong.velocity};
 });
 test('through passes support hold/release and cancel on blur',()=>{
  const weak=launch('i',.15),strong=launch('i',.75);
  expect(weak.velocity[0]>0,'through pass not released');
  if(mode==='manual')expect(Math.abs(weak.velocity[2])<1e-8&&strong.velocity[0]>weak.velocity[0]+8,'manual through-pass controls ignored');
  fresh();d.press('i');d.step(.2);window.dispatchEvent(new Event('blur'));const s=d.snapshot();
  expect(!s.input.throughHold&&s.input.power===0,'through charge survived blur');
  return {weak:weak.velocity,strong:strong.velocity};
 });
 for(const type of ['corner','freeKick','goalKick'])for(const key of ['j','l']){
  test(type+' '+(key==='j'?'pass':'cross')+' uses mode and matches guide',()=>{
   const spot=type==='corner'?{x:35.1,z:22.1}:type==='goalKick'?{x:-30,z:3}:{x:0,z:0};
   fresh(spot.x-.38,spot.z,spot.x+(type==='corner'?-7:9),spot.z+(type==='corner'?-7:0));
   if(type==='goalKick')d.scenario({ball:[-30,.11,3],owner:0,players:[...far,{index:0,x:-30,z:3},{index:6,x:-20,z:3,freezeFor:20}]});
   d.restart(type,true,spot);d.step(.1);d.press(key);d.step(.3);d.release(key);
   const preview=d.setPiecePreview();let s;
   for(let i=0;i<120;i++){d.step(1/60);s=d.snapshot();if(!s.restart)break;}
   expect(!s.restart,'restart never released');
   if(mode!=='assisted'){
    const expected=preview.launch.velocity,error=Math.hypot(s.velocity[0]-expected.x,s.velocity[1]-expected.y,s.velocity[2]-expected.z);
    expect(error<.6,'actual delivery differs from guide: '+error);
    if(mode==='manual')expect(s.passTarget===-1,'manual set piece auto-selected receiver');
    return {velocity:s.velocity,preview:expected,error};
   }
   return {velocity:s.velocity};
  });
 }
 for(const hold of [.15,.5])test('keeper '+(hold<.25?'roll':'throw')+' has safe mode selection',()=>{
  d.move(0,0);d.aim(null);d.scenario({ball:[-31,1,0],velocity:[-10,0,0],owner:-1,touch:false,players:[...far,{index:0,x:-34,z:0},{index:5,x:-23.5,z:4,freezeFor:20}]});
  d.step(.5);expect(d.snapshot().keeperHolding===0,'keeper did not catch');d.step(.4);
  d.move(1,0);d.press('j');d.step(hold);d.release('j');const s=d.snapshot();d.move(0,0);
  expect(s.keeperHolding<0&&s.velocity[0]>0,'keeper did not distribute');
  if(mode==='manual')expect(Math.abs(s.velocity[2])<1e-8,'manual keeper pass snapped away from input');
  return {velocity:s.velocity};
 });
 return checks;
}'''

async def open_settings(page,base):
 if await page.locator('.pause-card').count():
  await page.get_by_role('button',name='LEAVE MATCH').click()
  await page.locator('.tile').filter(has_text='SETTINGS').click()
  return
 await page.goto(base+'/?venue=sarbah')
 await page.get_by_role('button',name='YES · OPEN FOOTBALL').click()
 tile=page.locator('.tile').filter(has_text='SETTINGS')
 for _ in range(6):
  if await tile.count():break
  await page.get_by_role('button',name=re.compile('BACK')).click()
 await tile.click()
 await page.get_by_role('heading',name='GAMEPLAY ASSISTANCE').wait_for()

async def manual_inputs(page,ctx,phone):
 fresh="""()=>{const d=window.__footballDebug;d.move(0,0);d.aim(null);d.scenario({ball:[.38,.11,0],owner:5,players:[...Array.from({length:14},(_,index)=>({index,x:2000,z:2000,downFor:100})),{index:5,x:0,z:0}]});return d.snapshot().events.passes}"""
 before=await page.evaluate(fresh);await page.get_by_role('button',name='RESUME').click()
 if not phone:
  await page.keyboard.down('w');await page.evaluate('window.__footballDebug.step(.6)')
  assert await page.evaluate('window.__footballDebug.snapshot().input.throughHold')
  assert await page.evaluate('window.__footballDebug.snapshot().events.passes')==before
  await page.keyboard.up('w');s=await page.evaluate('window.__footballDebug.snapshot()')
  assert s['events']['passes']==before+1 and not s['input']['throughHold'] and abs(s['velocity'][2])<1e-6
  await page.keyboard.press('Escape');before=await page.evaluate(fresh);await page.keyboard.press('Escape')
  s=await page.evaluate("""()=>{const d=window.__footballDebug,p={id:'Xbox Manual test',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[p]});p.buttons[3]={pressed:true,value:1};d.pollGamepad();d.step(.6);if(!d.snapshot().input.throughHold)throw Error('controller did not charge through pass');p.axes=[.6,-.8,0,0];p.buttons[3]={pressed:false,value:0};d.pollGamepad();const s=d.snapshot();p.axes=[0,0,0,0];d.pollGamepad();return s;}""")
  assert s['events']['passes']==before+1 and not s['input']['throughHold']
  assert abs(s['velocity'][2]/s['velocity'][0]+4/3)<1e-6,'controller Manual pass did not follow stick'
  return {'keyboardThrough':True,'controllerThrough':True,'controllerVelocity':s['velocity']}
 stick=await page.get_by_role('application',name='Move player joystick').bounding_box()
 button=await page.get_by_role('button',name='pass',exact=True).bounding_box()
 a={'id':11,'x':stick['x']+stick['width']*.85,'y':stick['y']+stick['height']*.675}
 b={'id':12,'x':button['x']+button['width']*.5,'y':button['y']+button['height']*.5}
 session=await ctx.new_cdp_session(page)
 await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a]})
 await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a,b]})
 await page.wait_for_function('window.__footballDebug.snapshot().input.passHold')
 await page.evaluate('window.__footballDebug.step(.6)')
 await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[b]})
 await page.wait_for_function('before=>window.__footballDebug.snapshot().events.passes>before',arg=before)
 s=await page.evaluate('window.__footballDebug.snapshot()')
 assert not s['input']['passHold'] and s['velocity'][0]>6 and s['velocity'][2]>0
 assert abs(s['velocity'][2]/s['velocity'][0]-.5)<.06,'touch Manual pass did not follow joystick'
 await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 return {'touchMoveAndChargedPass':True,'velocity':s['velocity']}

async def main(native_only=False):
 out=Path(os.getenv('PASSING_AUDIT_OUTPUT','/workspace/passing-modes-audit/browser'));out.mkdir(parents=True,exist_ok=True)
 base=os.getenv('FOOTBALL_BASE_URL','http://127.0.0.1:5173');report={'devices':[],'errors':[]}
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for phone in [False,True]:
    ctx=await b.new_context(viewport={'width':844 if phone else 1200,'height':390 if phone else 800},is_mobile=phone,has_touch=phone)
    page=await ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));item={'device':'phone' if phone else 'desktop','modes':[]};report['devices'].append(item)
    for mode in (['manual'] if native_only else ['assisted','semi','manual']):
     await open_settings(page,base)
     radio=page.get_by_role('radio',name=re.compile('^'+mode,re.I));await radio.check()
     await page.wait_for_function('mode=>JSON.parse(localStorage.getItem("legon-football-preferences-v2")).passingAssistance===mode',arg=mode)
     assert await page.get_by_role('radio').count()==3 and await radio.is_checked()
     if mode=='semi':await page.screenshot(path=str(out/(item['device']+'-settings.png')))
     await page.reload();assert await page.get_by_role('radio',name=re.compile('^'+mode,re.I)).is_checked()
     old=page;page=await ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));await old.close()
     await start(page,base,'sarbah');assert await page.evaluate('window.__footballDebug.snapshot().passingAssistance')==mode
     checks=[] if native_only else await page.evaluate(CHECKS,mode);entry={'mode':mode,'checks':checks};item['modes'].append(entry)
     if mode=='manual':entry['nativeInputs']=await manual_inputs(page,ctx,phone)
     if mode=='assisted':entry['regressions']=await page.evaluate(EVENTS,{'length':71,'width':45,'venue':'sarbah'})
     print(item['device'],mode,json.dumps(entry),flush=True)
    await ctx.close()
  finally:await b.close()
 (out/'report.json').write_text(json.dumps(report,indent=2))
 failures=[c for d in report['devices'] for m in d['modes'] for c in m['checks']+m.get('regressions',[]) if not c['passed']]
 print('FAILURES',json.dumps(failures),flush=True);assert not failures and not report['errors'],report['errors']

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--native-only',action='store_true');asyncio.run(main(parser.parse_args().native_only))
