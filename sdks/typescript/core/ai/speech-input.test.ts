import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSpeechInputCapabilities } from './speech-input.js';
test('speech reference projection keeps separate conditions and bounded transcript support',()=>{
 const p={supportsIdentityAudio:true,supportsPerformanceAudio:true,maxReferenceBytes:32*1024*1024,maxReferenceDurationSeconds:30,maxPerformanceTextBytes:4096};
 assert.deepEqual(projectSpeechInputCapabilities(p),p);
 for(const invalid of [{...p,maxReferenceDurationSeconds:0x100000000},{...p,supportsPerformanceAudio:false},{...p,endpoint:'private'}]) assert.throws(()=>projectSpeechInputCapabilities(invalid));
});
