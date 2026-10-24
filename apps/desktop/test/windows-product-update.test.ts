import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProductUpdateTestHost } from './helpers/product-update-test-cache.js';
import { WindowsProductUpdateAdapter, admittedWindowsHelperPath } from '../src-electron/windows-product-update-adapter.js';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { verifyWindowsUnsignedInstaller } from '../../../config/windows-product-installer.mjs';
import { signedProductFixture } from '../../install-gateway/test/product-release-fixture.mjs';

test('Windows helper comparison accepts actual case variants and rejects other cohorts or roles', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-helper-case-'));
  try {
    const cohort = path.join(root, 'Product', '0.2.5-rc.8');
    await mkdir(cohort, { recursive: true });
    const helper = path.join(cohort, 'NimiProductUpdater.exe');
    const home = path.join(cohort, 'Nimi.exe');
    await writeFile(helper, 'helper path fixture');
    await writeFile(home, 'home path fixture');
    const expected = await realpath(helper);
    assert.equal(admittedWindowsHelperPath(helper, home.toLowerCase()), expected);
    assert.equal(admittedWindowsHelperPath(helper.toUpperCase(), home), expected);
    const other = path.join(root, 'Other.exe');
    await writeFile(other, 'helper path fixture');
    assert.throws(() => admittedWindowsHelperPath(other, home), /UPDATE_INSTALL_NOT_READY/);
    assert.throws(() => admittedWindowsHelperPath(helper, path.join(root, '0.2.5-rc.9', 'Nimi.exe')), /UPDATE_INSTALL_NOT_READY/);
    assert.throws(() => admittedWindowsHelperPath(path.join(cohort, 'Missing.exe'), home), /UPDATE_INSTALL_NOT_READY/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows controller verifies PE fixture bytes, projects prepared without install readiness and refuses consent', async () => {
  const bytes = Buffer.alloc(1024); bytes.writeUInt16LE(0x5a4d,0); bytes.writeUInt32LE(128,0x3c); bytes.writeUInt32LE(0x4550,128); bytes.writeUInt16LE(0x14c,132); bytes.writeUInt16LE(0x10b,152); bytes.writeUInt32LE(16,244);
  const fixture = signedProductFixture({ target: 'windows-amd64', compatibility: { minimumProductVersion: '0.2.0', minimumOsVersion: '10.0.19041', dataPolicy: 'owner-approved-forward' } }, bytes);
  const root = await mkdtemp(path.join(os.tmpdir(),'nimi-windows-controller-')); const adapter = new WindowsProductUpdateAdapter(root,true); let quits=0, shutdowns=0;
  const host = createProductUpdateTestHost({ currentVersion:'0.2.0',target:'windows-amd64',osVersion:'10.0.22631',cacheRoot:path.join(root,'cache'),policy:{...PRODUCT_UPDATE_POLICY,publicKey:fixture.key},
    fetchImpl:async (url) => String(url).endsWith('latest.json') ? new Response(fixture.manifestBytes.toString()) : new Response(Uint8Array.from(bytes).buffer),
    verifyInstaller: verifyWindowsUnsignedInstaller,
    installation:{ready:()=>adapter.ready(),preflight:(c)=>adapter.preflight(c),shutdown:async()=>{shutdowns++;return {criticalCleanupComplete:true,criticalFailures:[],diagnostics:[]};},handoff:(c,r)=>adapter.handoff(c,r),preserveFailure:async()=>undefined,reopenCurrentVersion:()=>adapter.prepareCurrentVersionReopen(),quit:()=>{quits++;}},
  });
  try { await host.check(); assert.equal(host.status().phase,'prepared'); assert.equal(host.status().downloadedBytes,1024); assert.equal(host.status().installationAvailable,false); await host.install(fixture.candidate.releaseId,true); assert.equal(host.status().phase,'failed'); assert.equal(host.status().reason,'UPDATE_INSTALL_NOT_READY'); assert.equal(shutdowns,0); assert.equal(quits,0); assert.equal(await adapter.ready(),false); }
  finally { await host.stop(); await rm(root,{recursive:true,force:true}); }
});
test('Windows candidate corruption or an unsupported channel cannot produce an installable Home state', async () => {
  for (const fault of ['digest','channel']) {
    const fixture = signedProductFixture({ target:'windows-amd64',...(fault==='channel'?{channel:'stable'}:{}),compatibility:{minimumProductVersion:'0.2.0',minimumOsVersion:'10.0.19041',dataPolicy:'owner-approved-forward'} });
    const root=await mkdtemp(path.join(os.tmpdir(),'nimi-windows-failure-'));
    const host=createProductUpdateTestHost({currentVersion:'0.2.0',target:'windows-amd64',osVersion:'10.0.22631',cacheRoot:path.join(root,'cache'),policy:{...PRODUCT_UPDATE_POLICY,publicKey:fixture.key},fetchImpl:async(url)=>String(url).endsWith('latest.json')?new Response(fixture.manifestBytes.toString()):new Response(new Uint8Array(fixture.bytes.length).buffer),verifyInstaller:verifyWindowsUnsignedInstaller});
    try { await host.check(); assert.equal(host.status().phase,'failed'); assert.equal(host.status().reason,fault==='digest'?'UPDATE_ASSET_DIGEST_MISMATCH':'UPDATE_CHANNEL_MISMATCH'); assert.equal(host.status().installationAvailable,false); }
    finally { await host.stop(); await rm(root,{recursive:true,force:true}); }
  }
});
