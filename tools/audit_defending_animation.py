"""Replay upright CPU tackles and sample real slide/recovery skeleton bounds."""
import asyncio,json,math,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright
from audit_first_half import start
from audit_restarts_camera import RULES

async def main():
 out=Path('/workspace/playtest-artifacts/defending-animation');out.mkdir(parents=True,exist_ok=True)
 errors=[];resources=[];failed_requests=[];report={}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   page=await browser.new_page(viewport={'width':1280,'height':720});page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('console',lambda msg: (resources if msg.text.startswith('Failed to load resource:') else errors).append(msg.text) if msg.type=='error' else None)
   page.on('requestfailed',lambda request:failed_requests.append(request.url))
   await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),'sarbah')
   report['foulsAndRestarts']=await page.evaluate(RULES)
   assert all(result['passed'] for result in report['foulsAndRestarts']),report['foulsAndRestarts']
   report['sourceMaterials']=await page.evaluate('''async()=>{const {loadPlayerModel}=await import('/src/assets.js');const model=await loadPlayerModel(),parts=[];
     model.traverse(p=>{if(p.isMesh)parts.push({name:p.name,materials:(Array.isArray(p.material)?p.material:[p.material]).map(m=>({name:m.name,type:m.type,map:!!m.map,normalMap:!!m.normalMap,color:m.color?.getHexString()}))})});return parts;}''')
   report['cpu']=await page.evaluate('''()=>{
    const d=window.__footballDebug,far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30})),results=[];
    // Reachable exposed ball: upright poke must win, not play a slide.
    for(let seed=1;seed<=20;seed++){
     const before=d.snapshot().events['cpu standing tackles']||0;
     d.scenario({seed,ball:[.68,.11,0],owner:5,players:[...far,{index:5,x:0,z:0,downFor:10},{index:12,x:1.4,z:0}]});
     d.step(3.1);const s=d.snapshot();
     if(s.events['cpu standing tackles']!==before+1)throw Error('no standing poke');
     if(s.players[12].action==='tackle'||s.players[12].action==='tackleAlternate')throw Error('CPU sliding');
     results.push({seed,tackles:s.events.tackles,standing:s.events['cpu standing tackles']});
    }
    const before=d.snapshot().events.tackles;
    d.scenario({ball:[2.28,.11,0],owner:5,players:[...far,{index:5,x:1.6,z:0,downFor:10},{index:12,x:0,z:0}]});
    d.step(5);const shielded=d.snapshot();
    if(shielded.restart)throw Error('jockeying produced a foul');
    if(shielded.events.tackles<=before)throw Error('defender failed to work around a stationary shield');
    for(let seed=1;seed<=20;seed++){
     const before=d.snapshot().events['teammate standing tackles']||0;
     d.scenario({seed,ball:[-.68,.11,0],owner:12,players:[...far,{index:5,x:-10,z:10,downFor:10},{index:6,x:-1.4,z:0},{index:12,x:0,z:0,heading:Math.PI,downFor:10}]});
     d.step(.05);const s=d.snapshot();
     if(s.events['teammate standing tackles']!==before+1||s.possessor!==6)throw Error('teammate failed exposed ball seed '+seed);
     if(s.players[6].action!=='pass')throw Error('teammate did not use upright poke');
    }
    return {opponent:results,teammateWins:20,shielded};
   }''')
   # A paused, reproducible view of the actual game, without the pause overlay.
   await page.add_style_tag(content='.pause-scrim{visibility:hidden!important}')
   await page.evaluate("window.__footballDebug.scenario({ball:[.68,.11,0],owner:5,players:[{index:5,x:0,z:0}]});window.__footballDebug.setCameraMode('Behind player');window.__footballDebug.step(.02);window.__footballDebug.animate(.2)")
   await page.evaluate('async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)}')
   await page.screenshot(path=str(out/'textured-player-in-match.png'))
   # Empty-pitch miss: real slide -> grounded hold -> slowed stand -> play.
   await page.evaluate('''()=>{const d=window.__footballDebug;d.scenario({ball:[15,.11,0],players:Array.from({length:14},(_,index)=>({index,x:index===5?0:5000,z:0,downFor:index===5?0:30}))});d.tackle('slide');d.setCameraMode('Co-op');}''')
   samples=[];last=0
   for t in [.1,.3,.6,.9,1.12,2,3.65,3.85,4.4,5,5.95,6.3]:
    await page.evaluate('''dt=>{const d=window.__footballDebug;d.step(dt)}''',t-last);last=t
    visual=await page.evaluate('window.__footballDebug.playerVisual(5)');state=await page.evaluate('window.__footballDebug.snapshot()')
    assert visual['visible']
    size=[b-a for a,b in zip(visual['bounds']['min'],visual['bounds']['max'])]
    assert all(math.isfinite(v) and v>0 for v in size),visual
    assert visual['bounds']['max'][1]>.15,('avatar under grass',t,visual)
    samples.append({'time':t,'visual':visual,'state':state,'size':size})
    if t==1.12:
     await page.evaluate('window.__footballDebug.move(1,0)')
    if t in [.6,2,4.4]:
     await page.evaluate('window.__footballDebug.setCameraMode("Behind player")')
     await page.evaluate('async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)}')
     await page.screenshot(path=str(out/f'slide-{t}.png'))
   assert samples[4]['visual']['action']=='fallen',samples[4]
   assert samples[7]['visual']['action']=='stand',samples[7]
   assert samples[9]['visual']['downUntil']>samples[9]['state']['elapsed'],'recovery ended too early'
   assert all(abs(s['state']['players'][5]['x']-samples[4]['state']['players'][5]['x'])<.01 for s in samples[5:10]),'player moved during recovery'
   assert samples[-1]['visual']['downUntil']<samples[-1]['state']['elapsed']
   report['slide']=samples
   report['successfulSlide']=await page.evaluate('''()=>{
    const d=window.__footballDebug;d.move(0,0);
    const far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30}));
    // Let the previous poke/fall fade into a stationary stance. A root-level
    // "exposed ball" can still be behind an outstretched animated boot.
    d.scenario({ball:[1,.11,0],owner:12,players:[...far,{index:5,x:0,z:0},{index:12,x:1.6,z:0,heading:Math.PI,freezeFor:10}]});
    d.step(.35);const before=d.snapshot().events.tackles;
    d.tackle('slide');d.step(1.12);const s=d.snapshot(),v=d.playerVisual(5);
    if(s.events.tackles!==before+1||s.sliding||v.action!=='stand')throw Error('clean slide did not win and enter get-up '+JSON.stringify({state:s,visual:v,before}));
    if(v.downUntil-s.elapsed<2.1)throw Error('successful slide skips slow get-up');
    return {state:s,visual:v};
   }''')
   report['groundedHeader']=await page.evaluate('''()=>{
    const d=window.__footballDebug,far=Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:30}));
    d.scenario({ball:[0,1.6,0],players:[...far,{index:5,x:-10,z:0},{index:6,x:0,z:0,downFor:5}]});
    d.step(.05);const p=d.snapshot().players[6];
    if(p.action==='header'||p.action==='headerBall')throw Error('grounded player switched to a header');
    return p;
   }''')
   assert not errors,errors
   assert all('127.0.0.1' not in url for url in failed_requests),failed_requests
   report['errors']=errors
   report['externalResourcesUnavailable']=failed_requests
   (out/'results.json').write_text(json.dumps(report,indent=2))
   print('PASS: 20 opponent and 20 teammate upright tackle wins; works around shield without foul; 12 grounded slide/recovery samples; no JS or shader errors',flush=True)
   for s in samples:print(s['time'],s['visual']['action'],s['size'],s['visual']['bounds']['min'][1],flush=True)
  finally:await browser.close()

if __name__=='__main__':asyncio.run(main())
