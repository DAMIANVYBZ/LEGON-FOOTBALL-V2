import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { restartFraming } from '../src/camera.js';

test('restart camera contains taker, ball, target and goal for both teams and touchlines',()=>{
 for(const phone of [false,true]) for(const aspect of [844/390,1200/800,390/844])
 for(const home of [false,true]) for(const side of [-1,1])
 for(const type of ['freeKick','indirectFreeKick','penalty','corner','goalKick','throwIn']) {
  const sign=home?1:-1,goalX=sign*35.5;
  const spot=type==='corner'?{x:sign*35.1,z:side*22.1}:type==='goalKick'?{x:-sign*30,z:side*3}
   :type==='throwIn'?{x:0,z:side*22.3}:type==='penalty'?{x:sign*27,z:0}:{x:sign*15.5,z:side*7};
  const aim=type==='corner'?{x:goalX-sign*6,z:0}:type==='goalKick'?{x:spot.x+sign*24,z:0}
   :type==='throwIn'?{x:spot.x+sign*8,z:spot.z*.3}:{x:goalX,y:1.6,z:side*2};
  const dx=aim.x-spot.x,dz=aim.z-spot.z,length=Math.hypot(dx,dz),taker={x:spot.x-dx/length*2.3,z:spot.z-dz/length*2.3};
  const frame=restartFraming({piece:{home,type,spot},taker,aim,goalX,goalWidth:7.32,goalHeight:2.44,aspect,fov:48,phone});
  const cam=new PerspectiveCamera(48,aspect,.1,400);cam.position.copy(frame.position);cam.lookAt(frame.focus);cam.updateMatrixWorld();
  for(const p of frame.points){const ndc=p.clone().project(cam);assert.ok(ndc.z>-1&&ndc.z<1);assert.ok(ndc.x>=frame.bounds.left-1e-6&&ndc.x<=frame.bounds.right+1e-6);assert.ok(ndc.y>=frame.bounds.bottom-1e-6&&ndc.y<=frame.bounds.top+1e-6);}
 }
});

test('close gameplay camera follows either carrier at both touchlines and enlarges players', async () => {
 const { gameplayFraming } = await import('../src/camera.js');
 for (const phone of [false,true]) for (const x of [-33,0,33]) for (const z of [-22,0,22]) {
  const ball={x:x+.6,y:.11,z},carrier={x,z};
  const frame=gameplayFraming({ball,velocity:{x:0,z:0},carrier,width:44.5,length:71,aspect:844/390});
  const camera=new PerspectiveCamera(42,844/390,.1,400);camera.zoom=phone?1.25:1;
  camera.updateProjectionMatrix();camera.position.copy(frame.position);camera.lookAt(frame.focus);camera.updateMatrixWorld();
  const foot=new Vector3(x,0,z).project(camera);
  const head=new Vector3(x,1.8,z).project(camera);
  assert.ok(Math.abs(foot.x)<.8&&foot.y>-.72&&head.y<.59,'carrier stays clear of HUD');
  assert.ok(head.y-foot.y>.085,'player occupies a useful portion of the screen');
  assert.ok(Math.abs(frame.focus.z-z)<.01,'camera tracks the carrier across pitch width');
 }
 const loose=gameplayFraming({ball:{x:12,y:.11,z:-14},velocity:{x:20,z:-20},width:44.5,length:71,aspect:2});
 assert.equal(loose.focus.x,14.8);assert.equal(loose.focus.z,-15.8);
});
