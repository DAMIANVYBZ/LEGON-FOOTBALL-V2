import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshPhongMaterial, Texture, Color } from 'three';
import { playerMaterial } from '../src/playerMaterial.js';

test('player materials retain authored skin and surface detail without changing the shared source', () => {
 const source=new MeshPhongMaterial({color:'#cccccc',map:new Texture(),normalMap:new Texture()});
 const skin=playerMaterial(source,{roughness:.68});
 assert.equal(skin.map,source.map);assert.equal(skin.normalMap,source.normalMap);
 assert.notEqual(skin.normalScale,source.normalScale);assert.ok(skin.color.equals(source.color));
 const shirt=playerMaterial(source,{cloth:true,color:'#193cbe',roughness:.92});
 assert.ok(shirt.color.equals(new Color('#193cbe')));assert.equal(shirt.map,source.map);
 assert.equal(shirt.normalMap,source.normalMap);assert.equal(source.color.getHexString(),'cccccc');
 assert.notEqual(shirt.customProgramCacheKey(),skin.customProgramCacheKey());
});
