"""Replay foul decisions, restart delivery and camera coverage in Chromium.

Fixtures use the real match loop; camera captures use the actual renderer.
Requires Vite, Python Playwright and Chromium. No source interception is used.
"""
import asyncio,json,math,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start

OUTPUT=Path('/workspace/playtest-artifacts/fouls-camera-audit')

RULES=r'''()=>{
 const d=window.__footballDebug,checks=[];
 const far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:10}));
 const expect=(ok,msg)=>{if(!ok)throw Error(msg)};
 const test=(name,fn)=>{try{checks.push({name,passed:true,detail:fn()})}catch(e){checks.push({name,passed:false,error:String(e)})}};
 test('40 exposed-ball standing pokes do not randomly become fouls',()=>{
  let fouls=0;
  for(let seed=1;seed<=40;seed++){
   d.scenario({ball:[1,.11,0],owner:12,seed,players:[...far,{index:5,x:0,z:0},{index:12,x:1.6,z:0,heading:0}]});
   d.tackle('standing');if(d.snapshot().restart)fouls++;
  }expect(fouls===0,'clean pokes produced '+fouls+' fouls');return {trials:40,fouls};
 });
 test('reckless body-first slide still produces a foul and red card',()=>{
  d.scenario({ball:[2.28,.11,0],owner:12,players:[...far,{index:5,x:.2,z:0},{index:12,x:1.6,z:0,heading:0,downFor:3}]});
  d.tackle('slide');d.step(.7);const s=d.snapshot();expect(s.restart?.type==='freeKick'&&!s.restart.home,'missing foul restart');expect(s.players[5].sentOff,'reckless slide not sanctioned');
 });
 for(const type of ['freeKick','indirectFreeKick','corner','goalKick']){
  test(type+' short pass stays on ground and travels toward receiver',()=>{
   const spot=type==='corner'?{x:35.1,z:22.1}:type==='goalKick'?{x:-30,z:3}:{x:15.5,z:0};
   const receiver={index:6,x:spot.x+(type==='corner'?-5:7),z:spot.z+(type==='corner'?-5:3),downFor:3};
   d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:spot.x-.7,z:spot.z},receiver]});
   d.restart(type,true,spot);d.step(.1);d.press('j');d.step(.3);d.release('j');d.step(1.05);
   const s=d.snapshot();expect(!s.restart,'restart did not release');expect(s.passTarget===6,'wrong short-pass receiver');
   expect(s.ball[1]<.3&&Math.abs(s.velocity[1])<1,'short pass became airborne: '+s.velocity);
   const target=s.passDestination;expect((target[0]-spot.x)*s.velocity[0]+(target[2]-spot.z)*s.velocity[2]>0,'ball rebounded off its own taker');
   return {velocity:s.velocity,destination:target};
  });
 }
 test('a passed penalty is tapped forward rather than passed backward',()=>{
  d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:26.3,z:0}]});
  d.restart('penalty',true,{x:27,z:0});d.step(.1);d.press('j');d.step(.3);d.release('j');d.step(2.65);
  const s=d.snapshot();expect(!s.restart&&s.velocity[0]>0&&s.ball[0]>27,'penalty pass did not go forward');
  expect(s.passDestination[0]>27,'penalty target behind spot');
 });
 test('penalty waits for readiness, then completes its runup and releases',()=>{
  d.scenario({ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:26.3,z:0}]});
  d.restart('penalty',true,{x:27,z:0});d.step(.1);d.press('k');d.step(.3);d.release('k');d.step(.8);
  expect(d.snapshot().restart?.type==='penalty','penalty released before ready');
  d.step(1.85);expect(!d.snapshot().restart&&d.snapshot().velocity[0]>10,'penalty never released');
 });
 return checks;
}'''

async def frames(page):
 await page.evaluate('async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)}')

async def check_restart_switches(page):
 # Keep the same match and do not reset between near/far corners. A stale
 # setPieceCam can pass isolated-fixture tests but fail this sequence.
 # Paused fixtures render only one frame per step: allow the pan to settle
 # rather than treating 35 rendered frames as 1.75 seconds of camera motion.
 await page.evaluate("window.__footballDebug.setCameraMode('Co-op');window.__footballDebug.scenario({ball:[.68,.11,0],owner:5})")
 checks=[]
 for home in [True,False]:
  for z in [22.1,-22.1]:
   await page.evaluate("({home,z})=>{const d=window.__footballDebug;d.restart('corner',home,{x:(home?1:-1)*35.1,z});d.step(.1)}",{'home':home,'z':z})
   visible=False
   for _ in range(120):
    await page.evaluate('window.__footballDebug.step(0)');await frames(page)
    c=await page.evaluate('window.__footballDebug.camera()')
    visible=c['restartView']=='corner' and all(abs(c[k][0])<.85 and -.82<c[k][1]<.72 for k in ['ball','takerFoot','takerHead'])
    if visible:break
   checks.append({'home':home,'touchline':z,'passed':visible,'camera':c})
 return checks

async def main():
 OUTPUT.mkdir(parents=True,exist_ok=True);report={'behaviour':[],'framing':[],'transitions':[],'switches':[],'errors':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   for phone in [False,True]:
    device='phone' if phone else 'desktop'
    context=await browser.new_context(viewport={'width':844 if phone else 1200,'height':390 if phone else 800},is_mobile=phone,has_touch=phone)
    page=await context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
    await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),'sarbah')
    await page.add_style_tag(content='.pause-scrim{display:none!important}')
    behaviour=await page.evaluate(RULES);report['behaviour'].append({'device':device,'checks':behaviour});print(device,'behaviour',json.dumps(behaviour),flush=True)
    for mode in ['Co-op','Wide','Behind player']:
     await page.evaluate('mode=>window.__footballDebug.setCameraMode(mode)',mode)
     for home in [True,False]:
      for kind in ['freeKick','penalty','corner','goalKick','throwIn','indirectFreeKick']:
       await page.evaluate('''({home,kind})=>{const d=window.__footballDebug,s=home?1:-1;d.scenario({ball:[.68,.11,0],owner:5});d.restart(kind,home,kind==='corner'?{x:s*35.1,z:22.1}:kind==='goalKick'?{x:-s*30,z:3}:kind==='throwIn'?{x:0,z:22.3}:kind==='penalty'?{x:s*27,z:0}:{x:s*15.5,z:0});d.step(.1)}''',{'home':home,'kind':kind})
       await frames(page);camera=await page.evaluate('window.__footballDebug.camera()')
       name=f'{device}-{mode}-{kind}-{"home" if home else "away"}'
       entry={'name':name,'camera':camera,'passed':True};report['framing'].append(entry)
       try:
        assert camera['restartView']==kind,'stale restart camera'
        for key in ['ball','takerFoot','takerHead']:
         x,y,z=camera[key];assert abs(x)<.85 and -.82<y<.72 and -1<z<1,(key,camera[key])
         if phone:assert abs(x)<.45,(key,'hidden under phone buttons',camera[key])
        if camera['target']:
         x,y,z=camera['target'];assert abs(x)<.85 and -.82<y<.72,(kind,'target clipped',camera['target'])
       except AssertionError as error:entry['passed']=False;entry['error']=str(error)
       if mode=='Co-op':await page.screenshot(path=str(OUTPUT/(name+'.png')))
    report['switches'].append({'device':device,'checks':await check_restart_switches(page)})
    await page.evaluate("window.__footballDebug.setCameraMode('Co-op')")
    for kind,key in [('freeKick','k'),('corner','l')]:
     await page.evaluate('''kind=>{const d=window.__footballDebug;d.scenario({ball:[.68,.11,0],owner:5});d.restart(kind,true,kind==='corner'?{x:35.1,z:22.1}:{x:15.5,z:0});d.step(1.5)}''',kind)
     await frames(page);await page.evaluate('key=>{const d=window.__footballDebug;d.press(key);d.step(.3);d.release(key)}',key)
     trace=[]
     for i in range(36):
      await page.evaluate('window.__footballDebug.step(4/60)');await frames(page)
      value=await page.evaluate('''()=>({camera:window.__footballDebug.camera(),state:window.__footballDebug.snapshot(),time:performance.now()})''');trace.append(value)
      if i in [9,20]:await page.screenshot(path=str(OUTPUT/f'{device}-{kind}-transition-{i}.png'))
     released=[r for r in trace if r['state']['restart'] is None]
     passed=bool(released) and all(r['camera']['restartView'] is None for r in released)
     deltas=[]
     for a,b in zip(trace,trace[1:]):
      distance=math.dist(a['camera']['position'],b['camera']['position']);dt=(b['time']-a['time'])/1000
      deltas.append({'distance':distance,'seconds':dt})
      if dt<.12 and distance>15:passed=False
     report['transitions'].append({'device':device,'kind':kind,'passed':passed,'maxStepMetres':max(v['distance'] for v in deltas),'trace':trace})
     print(device,kind,'transition',passed,flush=True)
    await context.close()
  finally:await browser.close()
 (OUTPUT/'results.json').write_text(json.dumps(report,indent=2))
 failures=[c for item in report['switches'] for c in item['checks'] if not c['passed']]+[c for item in report['behaviour'] for c in item['checks'] if not c['passed']]+[c for c in report['framing'] if not c['passed']]+[c for c in report['transitions'] if not c['passed']]
 assert not failures and not report['errors'],json.dumps({'failures':failures,'errors':report['errors']})
 print('PASS:',len(report['framing']),'camera framings;',sum(len(x['checks']) for x in report['behaviour']),'behaviour groups;',len(report['transitions']),'release transitions',flush=True)
if __name__=='__main__':asyncio.run(main())
