import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPreparedProductRelease } from './product-release-publish.mjs';
import { productAssetUrl } from '../../config/product-update-contract.mjs';
import { signedProductFixture } from '../../apps/install-gateway/test/product-release-fixture.mjs';

function fixtureBatch() {
  const mac=signedProductFixture(), win=signedProductFixture({target:'windows-amd64',publishedAt:mac.candidate.publishedAt,expiresAt:mac.candidate.expiresAt},undefined,mac.privateKey);
  return {releaseId:mac.candidate.releaseId,version:mac.candidate.version,sourceRevision:mac.candidate.sourceRevision,channel:'beta',releases:[mac.candidate,win.candidate],files:[{name:mac.candidate.asset.name,path:'/prepared/pkg',size:7,sha256:'b'.repeat(64)},{name:'nimi-update-macos-arm64.json',path:'/prepared/json',size:8,sha256:'c'.repeat(64)}]};
}
function remoteApi(batch,{initial='none',fault,onUpload=()=>undefined}={}) {
  const calls=[]; let nextId=73;
  const assets=batch.files.map(file=>({name:file.name,state:'uploaded',size:file.size,digest:`sha256:${file.sha256}`,browser_download_url:productAssetUrl(batch.releaseId,file.name)}));
  let release=initial==='none'?null:{id:72,tag_name:batch.releaseId,target_commitish:batch.sourceRevision,prerelease:true,draft:initial!=='published',immutable:initial==='published',assets:initial==='published'?structuredClone(assets):[structuredClone(assets[0])]};
  let tag=initial==='published'?{object:{type:'commit',sha:batch.sourceRevision}}:null;
  const gh=async(args)=>{
    calls.push(args);const endpoint=args.at(-1);const method=args.includes('--method')?args[args.indexOf('--method')+1]:'GET';
    if(endpoint.endsWith('immutable-releases'))return {enabled:fault!=='immutable-off'};
    if(endpoint.includes('/git/ref/'))return fault==='wrong-tag'?{object:{type:'commit',sha:'e'.repeat(40)}}:tag;
    // Published-only tag API: drafts deliberately produce the same missing result as 404.
    if(endpoint.includes('/releases/tags/'))return release && !release.draft?structuredClone(release):null;
    if(method==='GET' && endpoint.endsWith('/releases?per_page=100'))return [release?[structuredClone(release),...(fault==='duplicate-draft'?[{...release,id:71}]:[])]:[]];
    if(method==='POST' && endpoint.endsWith('/releases')) {
      release={id:nextId++,tag_name:batch.releaseId,target_commitish:fault==='wrong-source'?'e'.repeat(40):batch.sourceRevision,prerelease:true,draft:true,immutable:false,assets:[]};return structuredClone(release);
    }
    if(endpoint.includes('uploads.github.com')) {
      const id=Number(/\/releases\/(\d+)\//u.exec(endpoint)?.[1]);assert.equal(id,release.id);
      const name=new URL(endpoint).searchParams.get('name'), file=batch.files.find(f=>f.name===name);
      release.assets.push({...assets.find(a=>a.name===name),digest:`sha256:${fault==='digest'?'d'.repeat(64):file.sha256}`});onUpload();return release.assets.at(-1);
    }
    if(method==='PATCH') {assert.ok(endpoint.endsWith(`/releases/${release.id}`));release.draft=false;release.immutable=true;tag={object:{type:'commit',sha:batch.sourceRevision}};return structuredClone(release);}
    if(method==='GET' && /\/releases\/\d+$/u.test(endpoint)) {assert.ok(endpoint.endsWith(`/releases/${release.id}`));return structuredClone(release);}
    throw Error('Unexpected GitHub API '+args.join(' '));
  };
  return {gh,calls,getRelease:()=>release};
}

test('published-only tag API does not prevent draft creation or exact-ID uploads and publication',async()=>{
  const batch=fixtureBatch(),remote=remoteApi(batch);const release=await publishPreparedProductRelease(batch,remote.gh,'/notes');
  assert.equal(release.id,73);assert.equal(release.immutable,true);
  assert.ok(remote.calls.some(c=>c.includes('--slurp')));assert.ok(!remote.calls.some(c=>c.at(-1).includes('/releases/tags/')));
  const writes=remote.calls.filter(c=>c.includes('--method'));assert.deepEqual(writes.map(c=>c[c.indexOf('--method')+1]),['POST','POST','POST','PATCH']);
  assert.ok(writes[0].includes('draft=true'));assert.ok(writes.slice(1).every(c=>c.at(-1).includes('/releases/73')));
});
test('existing exact draft resumes by ID without creating another and only uploads missing assets',async()=>{
  const batch=fixtureBatch(),remote=remoteApi(batch,{initial:'draft'});await publishPreparedProductRelease(batch,remote.gh,'/notes');
  assert.equal(remote.getRelease().id,72);assert.equal(remote.calls.filter(c=>c.at(-1).includes('uploads.github.com')).length,1);
  assert.ok(!remote.calls.some(c=>c.includes('draft=true')));
});
test('already published immutable release is idempotently verified without writes',async()=>{
  const batch=fixtureBatch(),remote=remoteApi(batch,{initial:'published'});await publishPreparedProductRelease(batch,remote.gh,'/notes');
  assert.ok(!remote.calls.some(c=>c.includes('--method')));
});
test('disabled immutable, conflicting tag/source/draft and mismatched remote bytes never publishes',async()=>{
  for(const fault of ['immutable-off','digest','wrong-tag','wrong-source','duplicate-draft']) {
    const batch=fixtureBatch(),remote=remoteApi(batch,{fault,initial:fault==='duplicate-draft'?'draft':'none'});
    await assert.rejects(publishPreparedProductRelease(batch,remote.gh,'/notes'));assert.ok(!remote.calls.some(c=>c.includes('PATCH')));
  }
});
test('upload crossing authenticated metadata expiry leaves draft; valid window publishes unchanged payload',async()=>{
  for(const expired of [true,false]) {
    const batch=fixtureBatch();let time=Date.parse(batch.releases[0].publishedAt)+1000;
    const original=JSON.stringify(batch.releases);const remote=remoteApi(batch,{onUpload:()=>{if(expired)time=Date.parse(batch.releases[0].expiresAt)+1;}});
    if(expired){await assert.rejects(publishPreparedProductRelease(batch,remote.gh,'/notes',()=>time),/UPDATE_METADATA_EXPIRED/);assert.equal(remote.getRelease().draft,true);assert.ok(!remote.calls.some(c=>c.includes('PATCH')));}
    else {await publishPreparedProductRelease(batch,remote.gh,'/notes',()=>time);assert.equal(remote.getRelease().immutable,true);}
    assert.equal(JSON.stringify(batch.releases),original,'publication must never refresh payload times');
  }
});
