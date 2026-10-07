import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled=await build({stdin:{contents:`export * from './src/lab/world-tour/world-tour-native-view.ts'; export * as THREE from 'three';`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {nativeWorldBrowsingAnchor,THREE}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
test('native browsing keeps an in-bounds origin and supplies a stable scene-unit reset anchor for shifted scenes',()=>{
 const centered=new THREE.Box3(new THREE.Vector3(-2,-1,-3),new THREE.Vector3(2,1,3));
 assert.deepEqual(nativeWorldBrowsingAnchor(centered).origin.toArray(),[0,0,0]);
 const shifted=new THREE.Box3(new THREE.Vector3(100,20,-50),new THREE.Vector3(110,24,-40));
 const anchor=nativeWorldBrowsingAnchor(shifted);assert.deepEqual(anchor.origin.toArray(),[105,22,-45]);assert.ok(shifted.containsPoint(anchor.origin));assert.ok(anchor.speed>0);
 const camera=new THREE.PerspectiveCamera();camera.position.copy(anchor.origin);camera.position.add(new THREE.Vector3(10,5,3));camera.position.copy(anchor.origin);
 assert.deepEqual(camera.position.toArray(),[105,22,-45]);assert.deepEqual(anchor.origin.toArray(),[105,22,-45]);
 assert.throws(()=>nativeWorldBrowsingAnchor(new THREE.Box3()));
 assert.throws(()=>nativeWorldBrowsingAnchor(new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(Infinity,1,1))));
});
test('native browsing resolves dirty OpenCV object transforms before choosing the reset anchor',()=>{
 const local=new THREE.Box3(new THREE.Vector3(100,20,-50),new THREE.Vector3(110,24,-40));
 const object=new THREE.Object3D();object.rotation.x=Math.PI;
 const anchor=nativeWorldBrowsingAnchor(local,object);
 assert.ok(anchor.origin.distanceTo(new THREE.Vector3(105,-22,45))<1e-6);
 assert.deepEqual(local.min.toArray(),[100,20,-50]);
 const camera=new THREE.PerspectiveCamera();camera.position.copy(anchor.origin);camera.position.x+=10;camera.position.copy(anchor.origin);
 assert.ok(camera.position.distanceTo(new THREE.Vector3(105,-22,45))<1e-6);
});
