import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, AnimationMixer, AnimationClip, NumberKeyframeTrack } from 'three';
import { transitionPlayerAction } from '../src/playerAnimation.js';

test('replaying an action does not flash back to the unanimated bind pose', () => {
 const root=new Object3D(),joint=new Object3D();joint.name='joint';root.add(joint);
 const clip=new AnimationClip('poke',1,[new NumberKeyframeTrack('joint.position[y]',[0,1],[1,1])]);
 const person={mixer:new AnimationMixer(root)};
 transitionPlayerAction(person,clip,{once:true,duration:.55});person.mixer.update(.2);
 assert.equal(joint.position.y,1);
 for(let attempt=0;attempt<4;attempt++) {
  transitionPlayerAction(person,clip,{once:true,duration:.55});person.mixer.update(.01);
  assert.equal(person.currentAction.getEffectiveWeight(),1);
  assert.equal(joint.position.y,1,'a repeat must not expose the zero-height rest pose');
 }
});
test('different moves blend continuously and slower recovery keeps its full duration', () => {
 const root=new Object3D(),joint=new Object3D();joint.name='joint';root.add(joint);
 const clip=(name,y)=>new AnimationClip(name,1,[new NumberKeyframeTrack('joint.position[y]',[0,1],[y,y])]);
 const person={mixer:new AnimationMixer(root)};
 transitionPlayerAction(person,clip('ground',.2));person.mixer.update(.2);
 transitionPlayerAction(person,clip('stand',1),{once:true,duration:2.2});person.mixer.update(.085);
 assert.ok(joint.position.y>.2&&joint.position.y<1);
 person.mixer.update(1.1);assert.equal(person.currentAction.isRunning(),true);
 assert.ok(person.currentAction.time<1);person.mixer.update(1.1);
 assert.equal(person.currentAction.paused,true);assert.equal(joint.position.y,1);
});

test('a released strike begins at foot contact and keeps the remaining follow-through', () => {
 const root=new Object3D(),joint=new Object3D();joint.name='joint';root.add(joint);
 const clip=new AnimationClip('strike',1,[new NumberKeyframeTrack('joint.position[x]',[0,.28,1],[0,.4,.1])]);
 const person={mixer:new AnimationMixer(root)};
 transitionPlayerAction(person,clip,{once:true,duration:.55,fade:0,startPhase:.28});person.mixer.update(0);
 assert.ok(Math.abs(joint.position.x-.4)<1e-6);
 person.mixer.update(.55*.7);assert.equal(person.currentAction.isRunning(),true);
 person.mixer.update(.02);assert.equal(person.currentAction.paused,true);
});
