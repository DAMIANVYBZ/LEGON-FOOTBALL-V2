import test from 'node:test';
import assert from 'node:assert/strict';
import { createOffsideTracker, offsidePositions, offsideInterference, onsideRunInput, goalCrossing } from '../src/rules.js';
import { pitchExit } from '../src/gameplay.js';
const passer={index:5,home:true,x:5,z:0};
const receiver={index:6,home:true,x:20,z:0};
const defenders=[{index:7,home:false,x:30,z:0},{index:8,home:false,x:15,z:2}];
const players=[passer,receiver,...defenders];
const ball={x:5,y:.11,z:0};
test('offside uses the second-last opponent and ball at the teammate touch',()=>{
 const s=offsidePositions(passer,ball,players);assert.equal(s.line,15);assert.deepEqual(s.candidates,[6]);
 for(const x of [0,-5,15]) assert.deepEqual(offsidePositions(passer,ball,[...players.filter(p=>p.index!==6),{...receiver,x}]).candidates,[]);
 assert.deepEqual(offsidePositions(passer,{...ball,x:22},players).candidates,[]);
});
test('offside works in either direction and ignores sent-off opponents',()=>{
 const mirrored=players.map(p=>({...p,home:!p.home,x:-p.x}));
 assert.deepEqual(offsidePositions(mirrored[0],{...ball,x:-5},mirrored).candidates,[6]);
 assert.deepEqual(offsidePositions(passer,ball,[...players,{index:9,home:false,x:25,z:0,sentOff:true}]).candidates,[6]);
 // The goalkeeper is not necessarily the last defender.
 assert.deepEqual(offsidePositions(passer,ball,[passer,receiver,{...defenders[0],x:10},{...defenders[1],x:25}]).candidates,[6]);
});
test('being offside is not an offence until involvement, even after running back onside',()=>{
 const t=createOffsideTracker();assert.equal(t.touch(passer,ball,players,{deliberate:true}),null);
 assert.deepEqual(t.snapshot().candidates,[6]);
 assert.equal(t.touch({...receiver,x:10},ball,players,{deliberate:true}).index,6);
 assert.equal(t.snapshot(),null);
});
test('post rebounds, accidental defender deflections and saves retain offside',()=>{
 const t=createOffsideTracker();t.touch(passer,ball,players,{deliberate:true});
 t.touch(defenders[1],ball,players);assert.equal(t.involved(receiver),true);
 t.touch(defenders[0],ball,players,{save:true});assert.equal(t.involved(receiver),true);
 assert.equal(t.touch(receiver,ball,players).index,6);
});
test('deliberate opponent control resets offside, as does a restart',()=>{
 const t=createOffsideTracker();t.touch(passer,ball,players,{deliberate:true});
 t.touch(defenders[1],ball,players,{deliberate:true});assert.equal(t.involved(receiver),false);
 t.clear();assert.equal(t.snapshot(),null);
});
test('direct corner, goal kick and throw-in exemptions do not exempt a subsequent teammate touch',()=>{
 const t=createOffsideTracker();t.touch(passer,ball,players,{deliberate:true,exempt:true});assert.equal(t.involved(receiver),false);
 t.touch(passer,ball,players,{deliberate:true});assert.equal(t.involved(receiver),true);
});
test('a new onside teammate touch updates the offside phase',()=>{
 const mate={index:4,home:true,x:8,z:2},t=createOffsideTracker();
 t.touch(passer,ball,[...players,mate],{deliberate:true});
 t.touch(mate,{...ball,x:8},[...players.map(p=>p.index===6?{...p,x:12}:p),mate],{deliberate:true});
 assert.equal(t.involved(receiver),false);
});
test('goals require a full valid crossing, under the bar and between posts',()=>{
 const goal={length:71,width:7.32,height:2.44},field={length:71,width:45};
 for(const side of [-1,1]) {
  const from={x:side*35.4,y:1,z:0},to={x:side*35.8,y:1,z:0};
  assert.equal(goalCrossing(from,pitchExit(from,to,field),goal),true);
  for(const p of [{...from,z:3.6},{...from,y:2.4}]) assert.equal(goalCrossing(p,pitchExit(p,{...p,x:to.x},field),goal),false);
  const behind={...from,x:side*36};assert.equal(goalCrossing(behind,pitchExit(behind,{...behind,x:side*36.1},field),goal),false);
  assert.equal(goalCrossing(from,pitchExit(from,{...to,x:side*35.55},field),goal),false);
 }
});


test('offside interference requires a challenge or an actual keeper screen',()=>{
 const phase={home:true,line:15,candidates:[6]};
 const keeper={index:7,home:false,keeper:true,x:30,z:0};
 assert.equal(offsideInterference(phase,{x:19.5,y:.11,z:0},[receiver,{...defenders[1],x:20.5,z:0}]),6);
 assert.equal(offsideInterference(phase,{x:5,y:.11,z:0},[receiver,keeper]),null);
 assert.equal(offsideInterference(phase,{x:5,y:.11,z:0},[{...receiver,x:27},keeper],{shot:true}),6);
 assert.equal(offsideInterference(phase,{x:5,y:.11,z:0},[{...receiver,x:27,z:2},keeper],{shot:true}),null);
});


test('runners brake before the line in either direction and retreat if already beyond it', () => {
  for (const home of [true, false]) {
    const sign = home ? 1 : -1;
    const far = onsideRunInput({ x: sign * 10 }, { x: sign, z: .2 }, 8, sign * 20, home);
    const close = onsideRunInput({ x: sign * 19.4 }, { x: sign, z: .2 }, 8, sign * 20, home);
    const beyond = onsideRunInput({ x: sign * 20.2 }, { x: sign, z: .2 }, 8, sign * 20, home);
    assert.ok(far.x * sign > .9 && close.x * sign < .3);
    assert.ok(beyond.x * sign < 0);
    assert.equal(close.z, far.z, 'checking the line preserves the lateral run');
  }
});

test('a player onside at release can run beyond the line without becoming offside', () => {
  const t = createOffsideTracker();
  const onside = { ...receiver, x: 14 };
  t.touch(passer, ball, [passer, onside, ...defenders], { deliberate: true });
  assert.equal(t.touch({ ...onside, x: 25 }, { ...ball, x: 25 }, players, { deliberate: true }), null);
});

test('successive touches by one dribbler refresh the offside snapshot', () => {
  const t = createOffsideTracker();
  t.touch(passer, ball, players, { deliberate: true });
  assert.ok(t.involved(receiver));
  t.touch(passer, ball, [passer, { ...receiver, x: 14 }, ...defenders], { deliberate: true });
  assert.equal(t.involved(receiver), false);
});
