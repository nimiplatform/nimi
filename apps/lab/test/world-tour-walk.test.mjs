import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:`export * from './src/lab/world-tour/world-tour-collider.ts'; export * from './src/lab/world-tour/world-tour-walk.ts'; export * as THREE from 'three';`,resolveDir:new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {worldSpatialTransform,validateEmbeddedCollider,loadWorldCollisionGeometry,createWorldWalk,THREE}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
function room(ceiling=3,wall=true,floorY=0){
 const vertices=[],indices=[];const bounds=new THREE.Box3();
 const add=(size,pos)=>{const g=new THREE.BoxGeometry(...size);g.translate(...pos);const a=g.getAttribute('position'),base=vertices.length/3;for(let i=0;i<a.count;i++){const p=new THREE.Vector3().fromBufferAttribute(a,i);vertices.push(...p.toArray());bounds.expandByPoint(p)}for(let i=0;i<g.index.count;i++)indices.push(base+g.index.getX(i));g.dispose()};
 add([8,.1,8],[0,floorY-.05,0]);if(wall)add([.1,ceiling??3,8],[1,floorY+(ceiling??3)/2,0]);if(ceiling!==null)add([8,.1,8],[0,floorY+ceiling+.05,0]);return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices),bounds};
}
test('collider metric transform is scale then ground alignment and X half-turn without defaults',()=>{
 const p=new THREE.Vector3(1,2,4).applyMatrix4(worldSpatialTransform(2,3));assert.ok(p.distanceTo(new THREE.Vector3(2,-1,-8))<1e-10);
 for(const [s,g]of [[0,0],[NaN,0],[1,NaN]])assert.throws(()=>worldSpatialTransform(s,g));
 assert.throws(()=>validateEmbeddedCollider(new Uint8Array(23)));
 const json=new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'https://example.invalid/mesh.bin'}]}));const n=Math.ceil(json.length/4)*4;const b=new Uint8Array(20+n);const d=new DataView(b.buffer);d.setUint32(0,0x46546c67,true);d.setUint32(4,2,true);d.setUint32(8,b.length,true);d.setUint32(12,n,true);d.setUint32(16,0x4e4f534a,true);b.fill(32,20);b.set(json,20);assert.throws(()=>validateEmbeddedCollider(b),/external-resource/);
});
test('real Rapier capsule validates spawn, ground, wall, diagonal rate and bounded stall steps',async()=>{
 const walk=await createWorldWalk(room(),new THREE.Vector3(0,1.5,0),{bodyHeight:1.7,radius:.25});try{
 assert.equal(walk.available,true);assert.equal(walk.readState().grounded,true);const start=walk.reset();
 for(let i=0;i<120;i++)walk.move(new THREE.Vector3(1,0,0),1/60,1.6);assert.ok(walk.readEye().x<.76,'capsule crossed wall');assert.equal(walk.readState().grounded,true);
 walk.reset();const short=walk.move(new THREE.Vector3(-1,0,-1),.05,1.6);assert.ok(short.distanceTo(start)<.09,'diagonal speed was boosted');
 walk.reset();const stalled=walk.move(new THREE.Vector3(-1,0,0),2,4);assert.ok(stalled.distanceTo(start)<.41,'stall teleported');
 assert.throws(()=>walk.applyEye(new THREE.Vector3(1,1.5,0)),/unsafe/);walk.reset();
 for(let i=0;i<400;i++)walk.move(new THREE.Vector3(-1,0,0),1/60,4);assert.ok(walk.readEye().x>-3.9,'walk crossed unsupported edge');assert.equal(walk.readState().grounded,true);
 }finally{walk.dispose();walk.dispose()}assert.throws(()=>walk.move(new THREE.Vector3(),.01,1),/unavailable/);
});
test('no clearance restricts walking; explicit smaller body is independently validated',async()=>{
 const large=await createWorldWalk(room(1),new THREE.Vector3(0,.2,0),{bodyHeight:1.7,radius:.25});assert.equal(large.available,false);assert.ok(large.safeFlightEye);assert.throws(()=>large.applyEye(new THREE.Vector3(0,2.6,0)),/unavailable/);large.dispose();
 const small=await createWorldWalk(room(1),new THREE.Vector3(0,.2,0),{bodyHeight:.8,radius:.12,mode:'walk'});assert.deepEqual(small.size,{bodyHeight:.8,radius:.12});assert.equal(small.available,true);assert.equal(small.readState().grounded,true);small.dispose();
});

test('GLB node transforms are applied once before the declared metric/OpenCV transform',async()=>{
 const vertices=new Float32Array([0,0,0,1,0,0,0,1,0]);const indices=new Uint16Array([0,1,2]);
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,translation:[1,2,3]}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,mode:4}]}],buffers:[{byteLength:44}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:6}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5123,count:3,type:'SCALAR'}]};
 const raw=new TextEncoder().encode(JSON.stringify(json));const n=Math.ceil(raw.length/4)*4;const glb=new Uint8Array(20+n+8+44);const d=new DataView(glb.buffer);d.setUint32(0,0x46546c67,true);d.setUint32(4,2,true);d.setUint32(8,glb.length,true);d.setUint32(12,n,true);d.setUint32(16,0x4e4f534a,true);glb.fill(32,20,20+n);glb.set(raw,20);d.setUint32(20+n,44,true);d.setUint32(24+n,0x004e4942,true);glb.set(new Uint8Array(vertices.buffer),28+n);glb.set(new Uint8Array(indices.buffer),28+n+36);
 const geometry=await loadWorldCollisionGeometry(glb,2,3);assert.ok(new THREE.Vector3().fromArray(geometry.vertices,0).distanceTo(new THREE.Vector3(2,-1,-6))<1e-5);assert.equal(geometry.indices.length,3);
});

test('open finite floors and elevated platforms have real capsule clearance above their mesh bounds',async()=>{
 for(const floorY of [0,2]){
  const walk=await createWorldWalk(room(null,false,floorY),new THREE.Vector3(0,floorY+1.5,0),{bodyHeight:1.7,radius:.25});
  try{assert.equal(walk.available,true);assert.ok(Math.abs(walk.spawnEye.y-(floorY+1.55))<.03);assert.ok(walk.safeFlightEye.y>floorY+1.4);assert.equal(walk.readState().grounded,true);const saved=walk.readEye();walk.applyEye(saved);for(let i=0;i<120;i++)walk.move(new THREE.Vector3(1,0,0),1/60,1.6);assert.ok(walk.readEye().x>2);for(let i=0;i<400;i++)walk.move(new THREE.Vector3(1,0,0),1/60,4);assert.ok(walk.readEye().x<3.9);assert.equal(walk.readState().grounded,true);assert.throws(()=>walk.applyEye(new THREE.Vector3(8,floorY+1.55,0)),/unsafe/);}finally{walk.dispose()}
 }
});
test('an initial viewpoint below a low roof cannot be mistaken for an above-roof spawn',async()=>{
 const geometry=room(1,false);const large=await createWorldWalk(geometry,new THREE.Vector3(0,.2,0),{bodyHeight:1.7,radius:.25});assert.equal(large.available,false);assert.equal(large.spawnEye,null);assert.ok(large.safeFlightEye.y<1);large.dispose();
 const small=await createWorldWalk(geometry,new THREE.Vector3(0,.2,0),{bodyHeight:.8,radius:.12});try{assert.equal(small.available,true);assert.ok(small.spawnEye.y<1);small.applyEye(small.spawnEye);assert.throws(()=>small.applyEye(new THREE.Vector3(0,.95,0)),/unsafe/);}finally{small.dispose()}
});
