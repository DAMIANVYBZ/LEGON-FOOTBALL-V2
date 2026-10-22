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
    for(let i=0;i<120;i++)advancePlayer(player,{x:1,z:0},1/120,options);
    speeds[mode]=player.vx;
  }
  assert.equal(speeds.full,RUN_PACE.dribbleSprint);assert.equal(speeds.controlled/speeds.full,.75);
});

test('full sprint accelerates faster and does not collapse to walking speed over a healthy boot-side ball',()=>{
  const a={x:20,z:0,vx:0,vz:0,heading:0},b={...a},input={x:1,z:0},ball={x:20.12,y:.11,z:0};
  const limit=controlStrideLimit(a,input,ball,{x:0,y:0,z:0},{sprint:true});assert.ok(limit>7);
  advancePlayer(a,input,.1,{sprint:true,dribbling:true,speedLimit:limit});advancePlayer(b,input,.1,{dribbling:true});
  assert.ok(a.vx>b.vx);assert.ok(a.vx>=2.4-1e-8);
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
