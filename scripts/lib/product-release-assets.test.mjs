import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { signedProductFixture } from '../../apps/install-gateway/test/product-release-fixture.mjs';
import { createWindowsProductIdentity } from './windows-product-release.mjs';
import { buildProductUpdateManifest,hashProductFile } from './product-update-manifest.mjs';
import { stageProductReleaseTarget,validateProductReleaseDirectory,validateProductReleaseTarget,validateProductReleaseAdmission,requireProductSigningKey } from './product-release-assets.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'nimi-release-assets-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const first=signedProductFixture(); const pem=first.privateKey.export({type:'pkcs8',format:'pem'});
  const cohort=first.candidate.components;
  const windowsRoot=path.join(root,'windows-payload'); await mkdir(windowsRoot);
  for(const file of ['Nimi.exe','runtime/nimi.exe','NimiProductUpdater.exe','resources/app.asar']) {const target=path.join(windowsRoot,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,`fixture ${file}`);}
  const windowsComponents={desktop:{version:first.candidate.version,sha256:await hashProductFile(path.join(windowsRoot,'resources/app.asar'))},runtime:{version:first.candidate.version,sha256:await hashProductFile(path.join(windowsRoot,'runtime/nimi.exe'))},avatar:cohort.avatar};
  const inventory=(await createWindowsProductIdentity({root:windowsRoot,version:first.candidate.version,sourceRevision:first.candidate.sourceRevision,components:windowsComponents,privateKey:pem,publicKey:first.key})).envelope;
  const second=signedProductFixture({target:'windows-amd64',publishedAt:first.candidate.publishedAt,expiresAt:first.candidate.expiresAt,components:windowsComponents},undefined,first.privateKey);
  const inputs=[];
  for(const f of [first,second]) {
    const assetPath=path.join(root,f.candidate.asset.name);await writeFile(assetPath,f.bytes);
    const identity={schema:'nimi-product-build/v1',version:f.candidate.version,target:f.candidate.target,sourceRevision:f.candidate.sourceRevision,minimumOsVersion:'13.0',realmOrigin:'https://realm.nimi.ai',dirtyInput:[],components:f.candidate.components,asset:f.candidate.asset};
    const admission={channel:'beta',publishedAt:f.candidate.publishedAt,expiresAt:f.candidate.expiresAt,compatibility:f.candidate.compatibility};
    const installedInventory=f===second?inventory:undefined;
    const envelope=await buildProductUpdateManifest({identity,assetPath,admission,installedInventory,privateKey:pem,publicKey:first.key});
    inputs.push({identity,envelope,assetPath,installedInventory,sourceRevision:f.candidate.sourceRevision,version:f.candidate.version,publicKey:first.key});
  }
  return {root,first,inputs,pem};
}

test('both platform final bytes and Windows signed inventory form one validated flat release set',async(t)=>{
  const f=await fixture(t); const ready=path.join(f.root,'ready');await mkdir(ready);
  for(const input of f.inputs) {const stage=path.join(f.root,input.identity.target);await stageProductReleaseTarget(input,stage); for(const name of await (await import('node:fs/promises')).readdir(stage)) await (await import('node:fs/promises')).cp(path.join(stage,name),path.join(ready,name));}
  const batch=await validateProductReleaseDirectory(ready,{sourceRevision:f.first.candidate.sourceRevision,version:f.first.candidate.version,publicKey:f.first.key});
  assert.equal(batch.files.length,7);assert.equal(batch.releaseId,f.first.candidate.releaseId);
  for(const input of f.inputs) assert.deepEqual(await readFile(path.join(ready,input.identity.asset.name)),await readFile(input.assetPath));
  await writeFile(path.join(ready,'unexpected.txt'),'not release input'); await assert.rejects(validateProductReleaseDirectory(ready,{sourceRevision:f.first.candidate.sourceRevision,version:f.first.candidate.version,publicKey:f.first.key}),/UPDATE_RELEASE_ASSETS_INCOMPLETE/);
});

test('release/source/version/channel/target/cohort/final byte and missing trust mismatches fail before stage',async(t)=>{
  const {inputs,pem}=await fixture(t);const input=inputs[0];
  for(const patch of [{sourceRevision:'b'.repeat(40)},{version:'0.4.0'},{channel:'stable'},{publicKey:null},{identity:{...input.identity,target:'windows-amd64'}},{identity:{...input.identity,dirtyInput:['modified']}},{identity:{...input.identity,realmOrigin:'http://127.0.0.1:3002'}}]) await assert.rejects(validateProductReleaseTarget({...input,...patch}));
  await assert.rejects(validateProductReleaseTarget({...inputs[1],installedInventory:undefined}));
  await writeFile(input.assetPath,Buffer.alloc((await readFile(input.assetPath)).length));await assert.rejects(validateProductReleaseTarget(input),/UPDATE_ASSET_DIGEST_MISMATCH/);
  assert.throws(()=>requireProductSigningKey(pem,null),/UPDATE_TRUST_NOT_CONFIGURED/);
  assert.throws(()=>requireProductSigningKey(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),input.publicKey),/UPDATE_SIGNATURE_INVALID/);
});

test('publisher admission is an exact request for existing package version/source and both targets',()=>{
  const f=signedProductFixture(); const admission={releaseId:f.candidate.releaseId,sourceRevision:f.candidate.sourceRevision,channel:'beta',publishedAt:f.candidate.publishedAt,expiresAt:f.candidate.expiresAt,compatibility:{'macos-arm64':f.candidate.compatibility,'windows-amd64':f.candidate.compatibility}};
  const expected={version:f.candidate.version,sourceRevision:f.candidate.sourceRevision}; assert.equal(validateProductReleaseAdmission(admission,expected),admission);
  for(const patch of [{releaseId:'sdk/v0.3.0'},{sourceRevision:'b'.repeat(40)},{channel:'stable'},{compatibility:{'macos-arm64':f.candidate.compatibility}},{unknown:true}]) assert.throws(()=>validateProductReleaseAdmission({...admission,...patch},expected));
});
