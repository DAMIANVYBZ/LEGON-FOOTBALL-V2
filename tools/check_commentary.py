"""Check in-match goal commentary with a stub speech engine, not an audio audition."""
import asyncio,json,shutil,os
from audit_first_half import start
from playwright.async_api import async_playwright
from pathlib import Path
async def main():
 out=Path('/workspace/playtest-artifacts/commentary');out.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  try:
   page=await b.new_page(viewport={'width':1280,'height':720});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.add_init_script('''window.__spoken=[];
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text}}});
    Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,
      getVoices:()=>[{name:'Google UK English Female',lang:'en-GB',default:true},{name:'Google UK English Male',lang:'en-GB'}],
      addEventListener(){},removeEventListener(){},cancel(){this.speaking=false},
      speak(u){this.speaking=true;window.__spoken.push({text:u.text,voice:u.voice?.name,pitch:u.pitch,rate:u.rate})}}});''')
   await start(page,os.environ.get('FOOTBALL_BASE_URL','http://127.0.0.1:5173'),'sarbah')
   results=[]
   for home,expected in [(True,'opener'),(False,'equaliser'),(False,'lead'),(False,'extend'),(True,'reply')]:
    await page.evaluate('window.__footballDebug.step(3)') # allow goal cooldown and celebration reset
    await page.evaluate('''home=>{const d=window.__footballDebug,s=home?1:-1;
     d.scenario({ball:[s*34.9,.11,0],velocity:[s*18,0,0],touch:home,
      players:Array.from({length:14},(_,index)=>({index,x:5000,z:5000,downFor:10}))});d.step(.2)}''',home)
    await page.wait_for_timeout(50)
    line=await page.evaluate('window.__spoken.at(-1)')
    caption=await page.locator('.commentary-caption').inner_text()
    assert caption==line['text'],(caption,line)
    assert line['voice']=='Google UK English Male',line
    results.append({'moment':expected,'score':await page.evaluate('window.__footballDebug.snapshot().score'),'line':line})
   assert results[-1]['score']==[2,3],results
   assert any(w in results[1]['line']['text'].lower() for w in ['levelled','all square']),results[1]
   assert any(w in results[-1]['line']['text'].lower() for w in ['pull one back','response']),results[-1]
   assert not errors,errors
   (out/'browser-results.json').write_text(json.dumps(results,indent=2))
   print('PASS: five real goal events produce contextual captions and select male voice over female default; no JS errors. Speech synthesis stubbed: no audible quality claim.')
  finally:await b.close()
asyncio.run(main())
