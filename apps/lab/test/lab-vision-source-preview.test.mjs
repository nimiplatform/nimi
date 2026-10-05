import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname,'..');
const requireKit = createRequire(path.resolve(root,'../../kit/package.json'));
const { JSDOM } = requireKit('jsdom');
const dom = new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
for (const key of ['window','document','HTMLElement','Element','Node']) globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement,act,useLayoutEffect}=await import('react');
const {createRoot}=await import('react-dom/client');
mkdirSync(path.join(root,'.tmp'),{recursive:true});
const dir=mkdtempSync(path.join(root,'.tmp','vision-source-'));
await build({stdin:{contents:"export { VisionLocateResultView } from './src/ai-studio-core/section-ai-testing-vision-result.tsx'; export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';",resolveDir:root,loader:'ts'},outfile:path.join(dir,'view.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',logLevel:'silent',plugins:[{name:'owned-media-test',setup(b){b.onResolve({filter:/^@nimiplatform\/kit\/shell\/renderer\/bridge$/},()=>({path:'media',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const openNimiLocalAppAssetMediaUrl=(path)=>globalThis.__VISION_MEDIA_TEST__.open(path);',loader:'js'}));}}]});
const {VisionLocateResultView,AIStudioHostProvider}=await import(pathToFileURL(path.join(dir,'view.mjs')).href);
test.after(async()=>{dom.window.close();delete globalThis.__VISION_MEDIA_TEST__;await rm(dir,{recursive:true,force:true});});

test('switching saved vision sources never overlays B coordinates on A retained image',async()=>{
 const readB=Promise.withResolvers();const revoked=[];const observed=[];
 const source=key=>({relativePath:'media/'+key+'.jpg',mediaType:'image/jpeg',sizeBytes:20,sha256:'sha256:'+key.repeat(64),previewSource:'managed-asset'});
 const a=source('a'),b=source('b');
 const host={translate:key=>key,sdk:{assets:{stat:async path=>path===a.relativePath? a:readB.promise}}};
 globalThis.__VISION_MEDIA_TEST__={open:async path=>({url:'https://localhost/'+path,revoke:async()=>revoked.push(path)})};
 const result=(key,image)=>({kind:'vision-locate',jobId:key,sourceImage:image,result:{imageArtifactId:key,width:20,height:10,locations:[{type:'box',x1:key==='a'?0.1:0.5,y1:0.1,x2:0.8,y2:0.9}]}});
 function Probe({output}){useLayoutEffect(()=>{observed.push({id:output.jobId,src:document.querySelector('img')?.getAttribute('src')??null});},[output]);return createElement(VisionLocateResultView,{output});}
 const renderer=createRoot(document.getElementById('root'));
 const render=output=>renderer.render(createElement(AIStudioHostProvider,{value:host},createElement(Probe,{output})));
 try{
  await act(async()=>render(result('a',a)));
  assert.equal(document.querySelector('img').getAttribute('src'),'https://localhost/media/a.jpg');
  await act(async()=>render(result('b',b)));
  assert.equal(observed.findLast(x=>x.id==='b').src,null,'B commit already hides A before passive effects reset state');
  assert.equal(document.querySelector('img'),null,'B source is still being read');
  await act(async()=>readB.resolve(b));
  assert.equal(document.querySelector('img').getAttribute('src'),'https://localhost/media/b.jpg');
  assert.ok(revoked.includes(a.relativePath));
 }finally{await act(async()=>renderer.unmount());}
});
