import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAsset } from '../src/publicAsset.js';

test('public URLs work on root hosting, GitHub project Pages and custom domains', () => {
 for (const base of ['/', '/LEGON-FOOTBALL-V2/', '/another-project/']) {
  for (const path of ['/models/player.fbx','/animations/clips.json','/campus/manifest.json','/images/logo.svg','/version.json']) {
   const expected=base+path.slice(1);
   assert.equal(publicAsset(path,base),expected);
   assert.equal(publicAsset(expected,base),expected,'already based paths must not be prefixed twice');
  }
 }
 for(const url of ['https://example.com/model.glb','data:image/png;base64,test','blob:https://example.com/id','//example.com/asset'])
  assert.equal(publicAsset(url,'/LEGON-FOOTBALL-V2/'),url);
});
