import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshStandardMaterial, BoxGeometry, Texture } from 'three';
import { ExportTextureLoader, removeMissingExportTextures } from '../src/playerTextures.js';

test('export-machine texture paths do not make requests and absent maps are removed', () => {
 const loader=new ExportTextureLoader();
 const missing=loader.load('/home/app/mixamo-mini/tmp/skins_test.fbm/Ch38_1001_Diffuse.png');
 assert.equal(missing.userData.missingExportSource,true);
 const supplied=new Texture(),material=new MeshStandardMaterial({map:missing,normalMap:supplied});
 const model=new Mesh(new BoxGeometry(),material);
 assert.equal(removeMissingExportTextures(model),model);
 assert.equal(material.map,null);assert.equal(material.normalMap,supplied);
 assert.equal(material.userData.missingExportTextures,true);
});
