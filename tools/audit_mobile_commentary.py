"""Mobile speech-policy regression using a stub: verifies gestures, not audible output."""
import asyncio,json,shutil
from pathlib import Path
from playwright.async_api import async_playwright
POLICY=r'''(()=>{
 const listeners=new Set();let ready=false,requested=false,serial=0;
 window.__speech={spoken:[],rejected:[],granted:false,denyGestures:false};
 const voice={name:'Daniel',lang:'en-GB',localService:true};
 Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
 const synth={speaking:false,paused:false,
  getVoices(){if(!requested){requested=true;setTimeout(()=>{ready=true;listeners.forEach(fn=>fn());},100);}return ready?[voice]:[];},
  addEventListener(type,fn){if(type==='voiceschanged')listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);},
  cancel(){serial++;this.speaking=false;},resume(){this.paused=false;},
  speak(u){const type=window.event?.type;const gesture=['touchend','click','keydown'].includes(type);
   if(!window.__speech.granted&&(!gesture||window.__speech.denyGestures)){
    window.__speech.rejected.push({text:u.text,type});setTimeout(()=>u.onerror?.({error:'not-allowed'}),0);return;
   }
   window.__speech.granted=true;window.__speech.spoken.push({text:u.text,type,voice:u.voice?.name,volume:u.volume});
   this.speaking=true;const id=++serial;setTimeout(()=>{if(id===serial)u.onstart?.();},0);
   setTimeout(()=>{if(id===serial){this.speaking=false;u.onend?.();}},100);
  }};
 Object.defineProperty(window,'speechSynthesis',{value:synth});
})();'''
async def start(page,muted=False):
 if muted:await page.add_init_script("localStorage.setItem('legon-football-preferences-v2',JSON.stringify({hud:{commentary:false}}));")
 await page.add_init_script(POLICY)
 await page.goto('http://127.0.0.1:5173/?venue=sarbah')
 await page.get_by_role('button',name='YES · OPEN FOOTBALL').tap()
 await page.get_by_role('button',name='KICK OFF').tap()
 await page.wait_for_function('window.__footballDebug?.snapshot().started',timeout=120000)
async def main():
 out=Path('/workspace/playtest-artifacts/mobile-commentary');out.mkdir(parents=True,exist_ok=True)
 errors=[];report={}
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  ctx=await b.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True)
  page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await start(page)
  await page.wait_for_function('window.__speech.spoken.length>=2')
  initial=await page.evaluate('window.__speech')
  assert initial['spoken'][0]['text']=='Welcome to Legon football.' and initial['spoken'][0]['type']=='click',initial
  assert all(s['text'].strip() and s['volume']==1 for s in initial['spoken']),initial
  assert initial['spoken'][-1]['voice']=='Daniel',initial
  report['startup']=initial
  # Simulate permission being lost, then make a real in-match goal event.
  await page.evaluate('''()=>{window.__speech.granted=false;window.__speech.denyGestures=true;
   const d=window.__footballDebug,n=d.snapshot().players.length;d.scenario({ball:[35.2,.11,0],velocity:[12,0,0],touch:true,players:Array.from({length:n},(_,index)=>({index,x:2000,z:2000,downFor:10}))});d.step(.15);}''')
  await page.wait_for_function('window.__speech.rejected.some(s=>/GOAL|In it goes/i.test(s.text))')
  before=await page.evaluate('window.__speech.spoken.length')
  await page.touchscreen.tap(410,130);await page.wait_for_timeout(300)
  assert await page.evaluate('window.__speech.spoken.length')==before,'first blocked gesture unexpectedly bypassed policy'
  await page.evaluate('window.__speech.denyGestures=false')
  await page.touchscreen.tap(410,130)
  await page.wait_for_function('n=>window.__speech.spoken.length>n',arg=before)
  recovered=await page.evaluate('window.__speech.spoken.at(-1)')
  assert recovered['type'] in ['touchend','click'] and recovered['voice']=='Daniel',recovered
  assert any(s in recovered['text'] for s in ['GOAL','In it goes']),recovered
  report['recoveredGoal']=recovered;report['policy']=await page.evaluate('window.__speech')
  await ctx.close()
  ctx=await b.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True)
  muted=await ctx.new_page();muted.on('pageerror',lambda e:errors.append(str(e)))
  await start(muted,muted=True);await muted.touchscreen.tap(410,130);await muted.wait_for_timeout(150)
  quiet=await muted.evaluate('window.__speech');assert not quiet['spoken'] and not quiet['rejected'],quiet
  report['commentaryOff']=True;report['errors']=errors;assert not errors,errors
  (out/'results.json').write_text(json.dumps(report,indent=2))
  print('PASS: mobile kickoff click primes real speech; delayed local male voice selected; blocked goal recovers on a later touch after an earlier failed tap; commentary-off stays silent; ERRORS []. Speech stubbed, not a real-phone audio audition.',flush=True)
  await b.close()
if __name__=='__main__':asyncio.run(main())
