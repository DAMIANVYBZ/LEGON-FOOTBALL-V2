import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
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
