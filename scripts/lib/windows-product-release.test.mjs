import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWindowsProductIdentity, verifyWindowsUnsignedInstaller, windowsNsisScript } from './windows-product-release.mjs';
import { verifyWindowsProductIdentity, validateWindowsProductIdentity } from '../../config/windows-product-identity.mjs';
import { hashProductFile } from './product-update-manifest.mjs';

export function engineeringPe(x64 = false, certificate = false) {
  const bytes = Buffer.alloc(1024); bytes.writeUInt16LE(0x5a4d,0); bytes.writeUInt32LE(128,0x3c); bytes.writeUInt32LE(0x4550,128); bytes.writeUInt16LE(x64 ? 0x8664 : 0x14c,132); bytes.writeUInt16LE(x64 ? 0x20b : 0x10b,152); bytes.writeUInt32LE(16,152+(x64 ? 108 : 92)); if (certificate) bytes.writeUInt32LE(512,152+(x64 ? 112 : 96)+32); return bytes;
}
test('unsigned setup architecture is separate from x64 product; unknown or certificate-bearing bytes fail', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'nimi-windows-pe-')); try {
    for(const [index,bytes,good] of [[0,engineeringPe(),true],[1,engineeringPe(true),true],[2,engineeringPe(true,true),false],[3,Buffer.from('download events are not installer bytes'),false]]) {
      const file=path.join(root,`candidate${index}.part`); await writeFile(file,bytes); if(good) await verifyWindowsUnsignedInstaller(file); else await assert.rejects(verifyWindowsUnsignedInstaller(file),/UPDATE_INSTALLER_TRUST_FAILED/);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('signed full inventory binds native dependencies, cohort and role; policy key is mandatory', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'nimi-windows-identity-')); try {
    for(const file of ['Nimi.exe','runtime/nimi.exe','NimiProductUpdater.exe','resources/app.asar','resources/app.asar.unpacked/native.node']) { const target=path.join(root,file); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,`engineering ${file}`); }
    const key=generateKeyPairSync('ed25519'), publicKey=key.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64');
    const components={desktop:{version:'0.3.0',sha256:await hashProductFile(path.join(root,'resources/app.asar'))},runtime:{version:'0.3.0',sha256:await hashProductFile(path.join(root,'runtime/nimi.exe'))},avatar:{version:'0.2.0',sha256:'a'.repeat(64)}};
    const input={root,version:'0.3.0',sourceRevision:'a'.repeat(40),components,privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}),publicKey};
    const result=await createWindowsProductIdentity(input); assert.deepEqual(await verifyWindowsProductIdentity(result.envelope,publicKey),result.identity);
    assert.ok(result.identity.files['resources/app.asar.unpacked/native.node']);
    await assert.rejects(createWindowsProductIdentity({...input,publicKey:null}),/UPDATE_TRUST_NOT_CONFIGURED/);
    for(const name of ['../escape','resources/CON.txt','Nimi.exe:evil','nimi.exe']) assert.throws(()=>validateWindowsProductIdentity({...result.identity,files:{...result.identity.files,[name]:'a'.repeat(64)}}),/UPDATE_COHORT_INVALID/);
    await assert.rejects(verifyWindowsProductIdentity({...result.envelope,signature:'A'.repeat(88)},publicKey),/UPDATE_(SIGNATURE|METADATA)_INVALID/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('formal generated installer secures bootstrap before extraction and never launches Home elevated', () => {
  const script=windowsNsisScript({root:'C:\\candidate\\$source',output:'C:\\candidate\\Nimi.exe',version:'0.3.0',extraction:{logicalBytes:4096,entries:8}});
  assert.ok(script.indexOf('SetFileSecurityW(w r0')<script.indexOf('\n  File "C:'));
  assert.ok(script.includes('RequestExecutionLevel admin')); assert.ok(script.includes('RunningX64')); assert.ok(script.includes('--install 0.3.0')); assert.ok(!script.includes('ExecShell')); assert.ok(script.includes('$$source'));
  assert.throws(()=>windowsNsisScript({root:'C:\\x',output:'C:\\x',version:'../arbitrary'}));
});

test('each generated attempt has its own bootstrap and every exit reaches bounded cleanup; current owner bypasses extract', () => {
  const script=windowsNsisScript({root:'C:\\candidate',output:'C:\\candidate\\Nimi.exe',version:'0.3.0',extraction:{logicalBytes:4096,entries:8}});
  assert.ok(!script.includes('ProductInstaller-0.3.0'));
  const create=script.indexOf('GetTempFileName $0'), owned=script.indexOf('StrCpy $7 1');
  assert.ok(create>0 && owned>create);
  const cleanup=script.slice(script.indexOf('\n  end:'));
  assert.ok(cleanup.includes('StrCmp $7 1 cleanup endmutex'));
  assert.ok(cleanup.includes('Delete "$0\\NimiProductUpdater.exe"'));
  assert.ok(cleanup.includes('Delete "$0\\nimi-product-identity.json"'));
  assert.ok(cleanup.includes('RMDir "$0"') && !cleanup.includes('RMDir /r'));
  assert.ok(script.indexOf('IntCmp $2 10 currentowner')<script.indexOf('\n  extract:'));
  assert.ok(script.indexOf('\n  currentowner:')>script.indexOf('File /r'));
  assert.ok(script.includes('Goto end\n  installfail:') && script.includes('SetErrorLevel $2\n  end:'));
  assert.ok(script.includes('--prepare 0.3.0 4096 8'));
  assert.ok(script.indexOf('--prepare 0.3.0 4096 8') < script.indexOf('File /r'));
});
