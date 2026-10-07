import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const compiled = await build({stdin:{contents:`export * from './src/lab/world-tour/world-tour-object-asset.ts'; export * from './src/lab/world-tour/world-tour-composition.ts'; export * as THREE from 'three';`,resolveDir:new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {validateWorldObjectGLB,loadWorldObject,parseWorldComposition,validateObjectTransform,checkCompositionBudget,readWorldObjectAsset,objectDigest,saveWorldComposition,THREE}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function fixture(mutate=()=>{}) {
 const mesh=new THREE.BoxGeometry(1,1,1),p=mesh.getAttribute('position');const positions=new Float32Array(p.array),indices=new Uint16Array(mesh.index.array);mesh.dispose();
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,translation:[4,2,3]}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.1,.8,.3,1],metallicFactor:0,roughnessFactor:.7}}],buffers:[{byteLength:positions.byteLength+indices.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],accessors:[{bufferView:0,componentType:5126,count:p.count,type:'VEC3',min:[-.5,-.5,-.5],max:[.5,.5,.5]},{bufferView:1,componentType:5123,count:indices.length,type:'SCALAR'}]};mutate(doc);
 const raw=new TextEncoder().encode(JSON.stringify(doc));const length=Math.ceil(raw.length/4)*4;const out=new Uint8Array(20+length+8+positions.byteLength+indices.byteLength),v=new DataView(out.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,length,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+length);out.set(raw,20);v.setUint32(20+length,positions.byteLength+indices.byteLength,true);v.setUint32(24+length,0x004e4942,true);out.set(new Uint8Array(positions.buffer),28+length);out.set(new Uint8Array(indices.buffer),28+length+positions.byteLength);return out;
}
test('real GLTFLoader preserves static content and places its declared bounds around a bottom-center pivot',async()=>{
 const bytes=fixture(),budget=validateWorldObjectGLB(bytes);assert.equal(budget.vertices,24);assert.equal(budget.triangles,12);
 const model=await loadWorldObject(bytes);try{const box=new THREE.Box3().setFromObject(model.root);assert.deepEqual(model.dimensions,[1,1,1]);assert.ok(Math.abs(box.min.y)<1e-7);assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x)<1e-7);let meshes=0;model.root.traverse(n=>{if(n instanceof THREE.Mesh)meshes++});assert.equal(meshes,1)}finally{model.dispose()}
});
test('GLB rejects external, compressed, animated, cyclic and oversized geometry before decoding',()=>{
 for(const mutate of [d=>d.buffers[0].uri='https://outside.invalid/model.bin',d=>d.images=[{uri:'file:///private.png'}],d=>d.extensionsUsed=['KHR_draco_mesh_compression'],d=>d.animations=[{}],d=>d.skins=[{}],d=>d.nodes[0].children=[0],d=>d.accessors[0].count=10000000,d=>d.nodes[0].translation=[Infinity,0,0],d=>{d.meshes[0].primitives[0].attributes.NORMAL=2;d.accessors.push({count:24,type:'MAT4',componentType:5126})},d=>d.accessors[1].type='VEC4'])assert.throws(()=>validateWorldObjectGLB(fixture(mutate)));
 const corrupt=fixture();new DataView(corrupt.buffer).setUint32(8,1,true);assert.throws(()=>validateWorldObjectGLB(corrupt));
});
test('texture budget counts multiple texture allocations that share one decoded image',()=>{
 const bytes=fixture(d=>{d.images=[{bufferView:0,mimeType:'image/png'}];d.textures=Array.from({length:3},()=>({source:0}));});
 const v=new DataView(bytes.buffer),offset=28+v.getUint32(12,true);v.setUint32(offset,0x89504e47);v.setUint32(offset+4,0x0d0a1a0a);v.setUint32(offset+12,0x49484452);v.setUint32(offset+16,2048);v.setUint32(offset+20,2048);
 assert.throws(()=>validateWorldObjectGLB(bytes),/limit/);
});
const identity={archivePath:'world-tour/world-a/world.zip',archiveSha256:'sha256:'+'a'.repeat(64)};
function item(i=0){return{id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),name:'Object',asset:{relativePath:'world-tour/objects/'+'b'.repeat(64)+'.glb',sha256:'sha256:'+'b'.repeat(64),sizeBytes:100},transform:{position:[0,0,-2],rotation:[0,45,0],scale:[1,1,1]}}}
function doc(){return{version:1,...identity,revision:1,instances:[item()]}}
test('composition keeps exact instance transforms and rejects archive mixing, invalid assets and budgets',()=>{
 const source=doc();assert.deepEqual(parseWorldComposition(JSON.parse(JSON.stringify(source)),identity),source);
 assert.throws(()=>parseWorldComposition(source,{...identity,archiveSha256:'sha256:'+'c'.repeat(64)}));
 for(const mutate of [x=>x.instances[0].asset.relativePath='../other.glb',x=>x.instances[0].transform.scale=[0,1,1],x=>x.instances.push(x.instances[0]),x=>x.instances[0].transform.position=[NaN,0,0]]){const x=doc();mutate(x);assert.throws(()=>parseWorldComposition(x,identity))}
 const models=new Map([[item().asset.relativePath,{vertices:250000,triangles:100000,textureBytes:32000000}]]);checkCompositionBudget([item()],models);assert.throws(()=>checkCompositionBudget(Array.from({length:5},(_,i)=>item(i)),models),/limit/);
 assert.throws(()=>validateObjectTransform({position:[0,0,0],rotation:[0,0,0],scale:[Infinity,1,1]}));
});
test('owned object read checks metadata, full stream and bytes; failed files cannot be silently reused',async()=>{
 const bytes=fixture(),sha256=await objectDigest(bytes);const asset={relativePath:'world-tour/objects/'+sha256.slice(7)+'.glb',sha256,sizeBytes:bytes.length};
 const read=async()=>({asset:{...asset,mediaType:'model/gltf-binary'},body:(async function*(){yield bytes})()});assert.deepEqual(await readWorldObjectAsset(asset,{read}),bytes);
 await assert.rejects(()=>readWorldObjectAsset(asset,{read:async()=>{throw {code:'not-found'}}}),/missing/);
 await assert.rejects(()=>readWorldObjectAsset(asset,{read:async()=>({asset:{...asset,mediaType:'model/gltf-binary'},body:(async function*(){yield bytes.subarray(1)})()})}),/missing/);
 const changed=bytes.slice();changed[changed.length-1]^=1;await assert.rejects(()=>readWorldObjectAsset(asset,{read:async()=>({asset:{...asset,mediaType:'model/gltf-binary'},body:(async function*(){yield changed})()})}),/missing/);
});
test('scene save detects a stale baseline, exposes storage failure and never claims read-write is CAS',async()=>{
 let value=null,writes=0;const storage={readJson:async()=>{if(value===null)throw{code:'not-found'};return{value}},writeJson:async(p,v)=>{writes++;value=JSON.parse(JSON.stringify(v))}};
 const saved=await saveWorldComposition(storage,identity,[item()],null);assert.equal(saved.revision,1);assert.deepEqual(value.instances,[item()]);
 value={...saved,revision:2};await assert.rejects(()=>saveWorldComposition(storage,identity,[],saved),/conflict/);assert.equal(writes,1);
 await assert.rejects(()=>saveWorldComposition({...storage,writeJson:async()=>{throw Error('storage failed')}},identity,[],value),/storage failed/);assert.equal(value.instances.length,1);
});
