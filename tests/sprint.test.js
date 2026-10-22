import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayer } from '../src/gameplay.js';
import { controlStrideLimit, footTouch, createBallControl } from '../src/ballControl.js';
import { readGamepad } from '../src/gamepad.js';
import { RUN_PACE } from '../src/movementConfig.js';

test('R1 and R2 produce distinct carrier speeds, with controlled sprint at 75%', () => {
  const speeds={};
  for(const [mode,button]of [['full',5],['controlled',7]]){
    const pad={connected:true,id:'DualSense',mapping:'standard',axes:[1,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};pad.buttons[button].pressed=true;
    const b=readGamepad(pad).actions,options={sprint:b.r1||b.r2,controlledSprint:b.r2&&!b.r1,dribbling:true};
    const player={x:20,z:0,vx:0,vz:0,heading:0};
    for(let i=0;i<720;i++)advancePlayer(player,{x:1,z:0},1/120,options); // 6 s: acceleration now builds over about two seconds
    speeds[mode]=player.vx;
  }
  assert.equal(speeds.full,RUN_PACE.dribbleSprint);assert.equal(speeds.controlled/speeds.full,.75);
});

test('full sprint accelerates faster and does not collapse to walking speed over a healthy boot-side ball',()=>{
  const a={x:20,z:0,vx:0,vz:0,heading:0},b={...a},input={x:1,z:0},ball={x:20.12,y:.11,z:0};
  const limit=controlStrideLimit(a,input,ball,{x:0,y:0,z:0},{sprint:true});assert.ok(limit>7);
  advancePlayer(a,input,.1,{sprint:true,dribbling:true,speedLimit:limit});advancePlayer(b,input,.1,{dribbling:true});
  assert.ok(a.vx>b.vx);assert.ok(a.vx>=.85,'full sprint still starts briskly, but no longer reaches pace in a single step');
  const recovery=controlStrideLimit(a,input,{x:19.4,y:.11,z:0},{x:0,y:0,z:0},{sprint:true});assert.ok(recovery<limit,'a genuinely unreachable rear touch still needs recovery');
});

test('R2 provides shorter and more frequent grounded touches than R1',()=>{
  const p={x:0,z:0,vx:6,vz:0,heading:0},ball={x:.1,y:.11,z:0},foot={x:.1,y:.05,z:0};
  const state=()=>{const s=createBallControl(-1);s.lastTouch=0;return s};
  const tight=footTouch(state(),ball,{x:6,y:0,z:0},p,[foot],.16,{sprint:true,controlledSprint:true});
  const notYet=footTouch(state(),ball,{x:6,y:0,z:0},p,[foot],.16,{sprint:true});
  const heavy=footTouch(state(),ball,{x:6,y:0,z:0},p,[foot],.26,{sprint:true});
  assert.ok(tight?.contact);assert.equal(notYet,null);assert.ok(heavy.velocity.x>tight.velocity.x);
  assert.deepEqual(ball,{x:.1,y:.11,z:0},'touches must not teleport the ball');
});

test('sprinting builds speed over about two seconds and has a real turning circle',()=>{
  const p={x:0,z:0,vx:0,vz:0,heading:0};
  const at={};
  for(let i=1;i<=240;i++){advancePlayer(p,{x:1,z:0},1/60,{sprint:true});if(i===30||i===60||i===120||i===240)at[i]=p.vx}
  assert.ok(at[30]<5&&at[30]>2.5,'half a second in: well short of top speed '+at[30]);
  assert.ok(at[60]<7&&at[60]>5,'one second in '+at[60]);
  assert.ok(at[120]>7.5,'two seconds in: near full pace '+at[120]);
  assert.ok(Math.abs(at[240]-RUN_PACE.sprint)<1e-6);
  // A 90 degree cut at full pace cannot be made instantly.
  const q={x:0,z:0,vx:RUN_PACE.sprint,vz:0,heading:0};
  for(let i=0;i<15;i++)advancePlayer(q,{x:0,z:1},1/60,{sprint:true});
  assert.ok(q.vx>2,'still carrying forward momentum a quarter of a second after the cut '+q.vx);
  assert.ok(q.vz<5,'sideways speed builds gradually '+q.vz);
  // An agile player turns faster than a heavy one.
  const turnTime=agility=>{const r={x:0,z:0,vx:RUN_PACE.sprint,vz:0,heading:0};for(let i=0;i<300;i++){advancePlayer(r,{x:0,z:1},1/60,{sprint:true,agilityFactor:agility});if(r.vz>6)return i/60}return Infinity};
  assert.ok(turnTime(1.2)<turnTime(.8));
});
