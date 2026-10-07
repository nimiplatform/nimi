import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const compiled=await build({entryPoints:[new URL('../src/lab/world-tour/world-tour-runtime.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {parsePendingWorld,isDefiniteWorldAdmissionRejection,clearRejectedWorldPending}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const config={target:{capabilityId:'world.generate',capabilityContract:'world.generate',section:'world',source:'cloud',status:'configured',detail:'exact committed target',intentLabel:'Cloud',params:{inputMode:'text'},paramsSummary:[],profileOrigin:null},promptControls:{context:'original context',contextAttached:true,attachmentCount:0}};
const saved={version:1,jobId:'known-job',request:{prompt:'original prompt',generationPrompt:'original prompt with original context',createdAt:'2026-10-06T01:00:00.000Z',runConfig:config,inputMode:'text'}};
test('World recovery preserves original request and time; no current draft or config is supplied',()=>{const value=parsePendingWorld(structuredClone(saved));assert.deepEqual(value,saved)});
test('World rejects missing or malformed original snapshots and marks a lost receipt without guessing a Job',()=>{for(const value of [{jobId:'known-job'},{...saved,request:{...saved.request,runConfig:undefined}},{...saved,request:{...saved.request,createdAt:'invalid'}},{...saved,request:{...saved.request,inputMode:'auto'}}])assert.throws(()=>parsePendingWorld(value));const unknown=structuredClone(saved);delete unknown.jobId;assert.equal(parsePendingWorld(unknown).jobId,undefined)});

test('World definite admission rejection uses typed Runtime and SDK reason shapes, not message or retry flags', async()=>{
 for(const reasonCode of ['ai-config-invalid','ai-media-option-unsupported','AI_MEDIA_SPEC_INVALID','SDK_LOCAL_APP_INPUT_INVALID','artifact-forbidden']) {
  let pending={version:1,request:structuredClone(saved.request)};let removed=0;
  const storage={async readJson(){return {value:pending}},async removeJson(){removed++;pending=undefined}};
  assert.equal(isDefiniteWorldAdmissionRejection({reasonCode}),true);
  await clearRejectedWorldPending(storage,saved.request,{reasonCode});assert.equal(removed,1);
 }
 for(const cause of [{reasonCode:'AI_PROVIDER_UNAVAILABLE',retryable:false},{reasonCode:'runtime-grpc-deadline-exceeded'},
   {reasonCode:'unknown-error',message:'ai-config-invalid',retryable:false},{message:'AI_INPUT_INVALID'}]) {
  let removed=0;await clearRejectedWorldPending({async readJson(){return{value:{version:1,request:saved.request}}},async removeJson(){removed++}},saved.request,cause);assert.equal(removed,0);
 }
});
test('World late rejection cannot clear a different request or an already known Job', async()=>{
 for(const pending of [{version:1,jobId:'known-job',request:saved.request},{version:1,request:{...saved.request,prompt:'later request'}}]) {
  let removed=0;await clearRejectedWorldPending({async readJson(){return{value:pending}},async removeJson(){removed++}},saved.request,{reasonCode:'ai-media-option-unsupported'});assert.equal(removed,0);
 }
});
