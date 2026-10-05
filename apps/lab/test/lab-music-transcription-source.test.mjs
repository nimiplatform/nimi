import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');const {JSDOM}=createRequire(path.resolve(root,'../../kit/package.json'))('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});for(const k of ['window','document','HTMLElement','Element','Node'])globalThis[k]=dom.window[k];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const{createElement,act,useLayoutEffect}=await import('react');const{createRoot}=await import('react-dom/client');
mkdirSync(path.join(root,'.tmp'),{recursive:true});const dir=mkdtempSync(path.join(root,'.tmp','music-source-'));
await build({stdin:{contents:"export { MusicTranscriptionNotice } from './src/ai-studio-core/section-ai-testing-transcription-result.tsx';export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';",resolveDir:root,loader:'ts'},outfile:path.join(dir,'view.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'owned-media-test',setup(b){b.onResolve({filter:/section-ai-testing-output\.js$/},()=>({path:'preview',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function ArtifactMediaResult(){return null}',loader:'js'}));}}]});
const{MusicTranscriptionNotice,AIStudioHostProvider}=await import(pathToFileURL(path.join(dir,'view.mjs')).href);
test.after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true})});
const button=key=>[...document.querySelectorAll('button')].find(x=>x.textContent===key);
const click=async key=>{const b=button(key);assert.ok(b,'button '+key);await act(async()=>b.click())};
const value=key=>({sourceAudio:{relativePath:`media/${key}.wav`,sha256:'sha256:'+key.repeat(64),mediaType:'audio/wav',sizeBytes:20,previewSource:'managed-asset'},sourceInfo:{sampleRateHz:32000},inputRange:{startFrame:0,endFrame:32000},completeness:'unknown',scores:[{format:'midi',part:'note-events',relativePath:`media/${key}.mid`}],timelineRelativePath:`media/${key}.json`});
const ownedRead=(text,mime)=>{const bytes=new TextEncoder().encode(text);return{asset:{sizeBytes:bytes.length,mediaType:mime},body:(async function*(){yield bytes})()}};

test('record and MIDI/timeline switches gate previews and export actions before effects finish',async()=>{
 const pending=Promise.withResolvers();const timeline=Promise.withResolvers();const committed=[];let bReads=0;
 const host={translate:key=>key,sdk:{assets:{read:async({relativePath:p})=>p==='media/b.mid'?(++bReads===1?pending.promise:ownedRead('B-MIDI','audio/midi')):p.endsWith('.json')?timeline.promise:ownedRead('A-MIDI','audio/midi')}}};
 function Probe({id}){useLayoutEffect(()=>{committed.push({id,exportVisible:!!button('Transcription.exportMidi'),body:document.querySelector('textarea')?.value})},[id]);return createElement(MusicTranscriptionNotice,{recordId:id,value:value(id)})}
 const renderer=createRoot(document.getElementById('root'));const render=id=>renderer.render(createElement(AIStudioHostProvider,{value:host},createElement(Probe,{id})));
 try{
  await act(async()=>render('a'));await click('Transcription.parts.note-events · MIDI');assert.ok(button('Transcription.exportMidi'));
  await act(async()=>render('b'));assert.equal(committed.findLast(x=>x.id==='b').exportVisible,false,'B commit must hide A export before passive cleanup');
  await click('Transcription.parts.note-events · MIDI');assert.equal(button('Transcription.exportMidi'),undefined);
  await act(async()=>pending.resolve(ownedRead('B-MIDI','audio/midi')));assert.ok(button('Transcription.exportMidi'));
  await click('Transcription.timeline');assert.equal(button('Transcription.exportMidi'),undefined);assert.equal(document.querySelector('textarea'),null);assert.equal(button('Transcription.export'),undefined);
  await act(async()=>timeline.resolve(ownedRead('{"B":true}','application/vnd.nimi.music-timeline+json')));assert.equal(document.querySelector('textarea').value,'{"B":true}');
  await click('Transcription.parts.note-events · MIDI');assert.equal(document.querySelector('textarea'),null);assert.ok(button('Transcription.exportMidi'));
 }finally{await act(async()=>renderer.unmount())}
});

for(const outcome of ['success','failure'])test(`an in-flight A export keeps A bytes/MIME and ${outcome} feedback never appears on B`,async()=>{
 const write=Promise.withResolvers();const writes=[];const revealed=[];
 const host={translate:(key,args)=>key+(args?.path?':'+args.path:''),sdk:{assets:{read:async({relativePath:p})=>ownedRead(p.endsWith('.mid')?'A-MIDI':'{"B":true}',p.endsWith('.mid')?'audio/midi':'application/vnd.nimi.music-timeline+json'),write:async request=>{const bytes=[];for await(const chunk of request.body)bytes.push(...chunk);writes.push({...request,body:bytes});return write.promise},reveal:async p=>{revealed.push(p)}}}};
 const renderer=createRoot(document.getElementById('root'));const render=id=>renderer.render(createElement(AIStudioHostProvider,{value:host},createElement(MusicTranscriptionNotice,{recordId:id,value:value(id)})));
 try{
  await act(async()=>render('a'));await click('Transcription.parts.note-events · MIDI');await click('Transcription.exportMidi');
  assert.equal(writes.length,1);assert.equal(writes[0].mediaType,'audio/midi');assert.match(writes[0].relativePath,/estimated-notes\.mid$/);assert.equal(new TextDecoder().decode(new Uint8Array(writes[0].body)),'A-MIDI');
  await act(async()=>render('b'));await click('Transcription.timeline');assert.equal(document.querySelector('textarea').value,'{"B":true}');
  await act(async()=>outcome==='success'?write.resolve({relativePath:'studio/music/exports/A/estimated-notes.mid'}):write.reject(Error('A-export-failed')));
  assert.equal(document.body.textContent.includes('studio/music/exports/A'),false);assert.equal(document.body.textContent.includes('A-export-failed'),false);assert.equal(document.querySelector('textarea').value,'{"B":true}');
  assert.deepEqual(revealed,outcome==='success'?['studio/music/exports/A/estimated-notes.mid']:[]);
 }finally{await act(async()=>renderer.unmount())}
});

test('MIDI export preserves the saved path when reveal fails and does not write a second copy',async()=>{
 const writes=[];
 const host={translate:(key,args)=>key+(args?.path?':'+args.path:''),sdk:{assets:{
  read:async()=>ownedRead('MIDI','audio/midi'),
  write:async request=>{writes.push(request);return{relativePath:'studio/music/exports/saved.mid'}},
  reveal:async()=>{throw Error('host unavailable')},
 }}};
 const renderer=createRoot(document.getElementById('root'));
 try{
  await act(async()=>renderer.render(createElement(AIStudioHostProvider,{value:host},createElement(MusicTranscriptionNotice,{recordId:'a',value:value('a')}))));
  await click('Transcription.parts.note-events · MIDI');await click('Transcription.exportMidi');
  assert.equal(writes.length,1);
  assert.match(document.body.textContent,/Transcription.exported:studio\/music\/exports\/saved.mid/);
  assert.equal(document.querySelector('[role="alert"]').textContent,'Common.exportSavedRevealFailed:studio/music/exports/saved.mid');
  await click('Transcription.showFile');
  assert.equal(document.querySelector('[role="alert"]').textContent,'Common.assetRevealFailed:media/a.mid');
  assert.equal(writes.length,1);
 }finally{await act(async()=>renderer.unmount())}
});
