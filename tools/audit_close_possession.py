"""Check close possession, sprint speed by pitch position, turning and pass release in Vite."""
import asyncio,sys,json,shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_first_half import start
from playwright.async_api import async_playwright
JS=r'''()=>{
const d=window.__footballDebug,n=d.snapshot().players.length,c=n/2-2;
const far=Array.from({length:n},(_,index)=>({index,x:2000,z:2000,downFor:100}));
const fresh=x=>{d.release('shift');d.move(0,0);d.aim(null);d.scenario({ball:[x+.34,.11,.1],owner:c,players:[...far,{index:c,x,z:0,stamina:1}]})};
const runs=[];
for(const x of [-20,14]){fresh(x);d.move(1,0);d.press('shift');let maxGap=0;
for(let i=0;i<120;i++){d.step(1/60);const s=d.snapshot(),p=s.players[c];maxGap=Math.max(maxGap,Math.hypot(s.ball[0]-p.x,s.ball[2]-p.z));}
const s=d.snapshot();runs.push({x,speed:Math.hypot(s.players[c].vx,s.players[c].vz),maxGap,owner:s.possessor});}
fresh(-24);d.move(1,0);d.press('shift');let maxGap=0,minSpeed=100;
for(let i=0;i<420;i++){d.step(1/60);const s=d.snapshot(),p=s.players[c];maxGap=Math.max(maxGap,Math.hypot(s.ball[0]-p.x,s.ball[2]-p.z));if(i>120)minSpeed=Math.min(minSpeed,Math.hypot(p.vx,p.vz));}
const stamina=d.snapshot().players[c].stamina;d.move(0,1);d.step(1);d.move(0,0);d.release('shift');d.step(1);
let s=d.snapshot();const stoppedGap=Math.hypot(s.ball[0]-s.players[c].x,s.ball[2]-s.players[c].z);
fresh(0);d.aim({x:1,z:0});d.press('j');d.step(.4);d.release('j');d.step(.25);s=d.snapshot();const pass={owner:s.possessor,velocity:s.velocity};
return {runs,maxGap,minSpeed,stamina,stoppedGap,pass};
}'''
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=await b.new_page(viewport={'width':1200,'height':800});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await start(page,'http://127.0.0.1:5173','sarbah');r=await page.evaluate(JS);print(json.dumps({'report':r,'errors':errors}),flush=True)
  out=Path('/workspace/playtest-artifacts/close-possession');out.mkdir(parents=True,exist_ok=True);(out/'results.json').write_text(json.dumps(r,indent=2));await b.close()
  assert not errors and all(t['maxGap']<.9 and t['speed']>6 for t in r['runs'])
  assert abs(r['runs'][0]['speed']-r['runs'][1]['speed'])<.1
  assert r['maxGap']<.9 and r['minSpeed']>6 and r['stoppedGap']<.7
  assert r['pass']['owner']<0 and r['pass']['velocity'][0]>5
asyncio.run(main())
