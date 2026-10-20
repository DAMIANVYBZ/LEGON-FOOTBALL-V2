import test from 'node:test';
import assert from 'node:assert/strict';
import { assessChallenge } from '../src/challenges.js';

test('a clean exposed-ball poke is legal even when the defender is behind',()=>{
 const tackler={x:0,z:0,vx:0,vz:0},carrier={x:1.6,z:0,vx:0,vz:0};
 for(const style of ['standing','hard','slide']) {
  const v=assessChallenge(tackler,carrier,{x:1,y:.11,z:0},{style,reach:{x:.9,z:0}});
  assert.equal(v.blocked,false);assert.equal(v.foul,false);assert.equal(v.card,null);
 }
});
test('a shielded ball is not a foul until a challenge makes contact',()=>{
 const carrier={x:1.6,z:0,vx:0,vz:0},ball={x:2.28,y:.11,z:0};
 const distant=assessChallenge({x:0,z:0,vx:5,vz:0},carrier,ball);
 assert.equal(distant.blocked,true);assert.equal(distant.contact,false);assert.equal(distant.foul,false);
 const gentle=assessChallenge({x:1,z:0,vx:.5,vz:0},carrier,ball);
 assert.equal(gentle.contact,true);assert.equal(gentle.foul,false);
});
test('a reckless body-first slide is a foul and can warrant a red card',()=>{
 const v=assessChallenge({x:.2,z:0,vx:7.5,vz:0},{x:1.6,z:0,vx:0,vz:0},{x:2.28,y:.11,z:0},{style:'slide',reach:{x:1.1,z:0}});
 assert.equal(v.blocked,true);assert.equal(v.contact,true);assert.equal(v.foul,true);assert.equal(v.card,'red');
});
test('a carrier running into a stationary defender does not create a tackle foul',()=>{
 const v=assessChallenge({x:0,z:0,vx:0,vz:0},{x:.7,z:0,vx:-4,vz:0},{x:1.38,y:.11,z:0});
 assert.equal(v.foul,false);assert.equal(v.approachSpeed,0);
});
