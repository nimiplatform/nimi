import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { PRODUCT_UPDATE_POLICY } from '../../config/product-update-policy.mjs';
import { PRODUCT_TARGETS, ProductUpdateError, compareProductVersions, productManifestName, verifyProductEnvelope } from '../../config/product-update-contract.mjs';
import { verifyWindowsProductIdentity } from '../../config/windows-product-identity.mjs';
import { hashProductFile } from './product-update-manifest.mjs';

export const buildIdentityName = (target) => `nimi-build-${target}.json`;
export const WINDOWS_INSTALLED_IDENTITY = 'nimi-installed-windows-amd64.json';
export function requireProductReleaseTrust(publicKey = PRODUCT_UPDATE_POLICY.publicKey) {
  if (!publicKey || !/^[A-Za-z0-9+/]{43}=$/u.test(publicKey) || Buffer.from(publicKey,'base64').length!==32) throw new ProductUpdateError('UPDATE_TRUST_NOT_CONFIGURED');
}
export function requireProductSigningKey(privateKey, publicKey = PRODUCT_UPDATE_POLICY.publicKey) {
  requireProductReleaseTrust(publicKey);
  const key=createPrivateKey(privateKey);
  if(key.asymmetricKeyType!=='ed25519' || createPublicKey(key).export({type:'spki',format:'der'}).subarray(-32).toString('base64')!==publicKey) throw new ProductUpdateError('UPDATE_SIGNATURE_INVALID');
}
export function validateProductReleaseAdmission(value, { version, sourceRevision, channel = PRODUCT_UPDATE_POLICY.channel }) {
  if (!value || Object.keys(value).sort().join(',') !== ['releaseId','sourceRevision','channel','publishedAt','expiresAt','compatibility'].sort().join(',')
    || value.releaseId !== `nimi/v${version}` || value.sourceRevision!==sourceRevision || value.channel!==channel
    || Object.keys(value.compatibility ?? {}).sort().join(',')!==PRODUCT_TARGETS.slice().sort().join(',')) throw new ProductUpdateError('UPDATE_RELEASE_INPUT_MISMATCH');
  const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
  const published=Date.parse(value.publishedAt), expires=Date.parse(value.expiresAt);
  if(!utc.test(value.publishedAt) || !utc.test(value.expiresAt) || !Number.isFinite(published) || !Number.isFinite(expires) || published>Date.now()+300_000 || expires<=published || expires<=Date.now()) throw new ProductUpdateError('UPDATE_METADATA_EXPIRED');
  for(const target of PRODUCT_TARGETS) {
    const compatibility=value.compatibility[target];
    if(!compatibility || Object.keys(compatibility).sort().join(',')!==['minimumProductVersion','minimumOsVersion','dataPolicy'].sort().join(',')
      || compatibility.dataPolicy!=='owner-approved-forward' || !/^\d+\.\d+(?:\.\d+)?$/u.test(compatibility.minimumOsVersion)
      || compareProductVersions(compatibility.minimumProductVersion,version)>0) throw new ProductUpdateError('UPDATE_COMPATIBILITY_INVALID');
  }
  return value;
}

export async function validateProductReleaseTarget({ identity, envelope, assetPath, installedInventory, sourceRevision, version, channel = PRODUCT_UPDATE_POLICY.channel, publicKey = PRODUCT_UPDATE_POLICY.publicKey }) {
  requireProductReleaseTrust(publicKey);
  const release=await verifyProductEnvelope(envelope,publicKey);
  if (release.sourceRevision!==sourceRevision || release.version!==version || release.channel!==channel
    || identity.schema!=='nimi-product-build/v1' || !Array.isArray(identity.dirtyInput) || identity.dirtyInput.length
    || identity.sourceRevision!==sourceRevision || identity.version!==version || identity.target!==release.target
    || identity.minimumOsVersion!==release.compatibility.minimumOsVersion || !isDeepStrictEqual(identity.components,release.components)
    || identity.asset.name!==release.asset.name || identity.asset.sha256!==release.asset.sha256 || identity.asset.size!==release.asset.size) throw new ProductUpdateError('UPDATE_RELEASE_INPUT_MISMATCH');
  if (release.target==='macos-arm64' && identity.realmOrigin!=='https://realm.nimi.ai') throw new ProductUpdateError('UPDATE_RELEASE_POLICY_MISMATCH');
  const info=await lstat(assetPath);
  if (!info.isFile() || info.isSymbolicLink() || path.basename(assetPath)!==release.asset.name || info.size!==release.asset.size || await hashProductFile(assetPath)!==release.asset.sha256) throw new ProductUpdateError('UPDATE_ASSET_DIGEST_MISMATCH');
  if (release.target==='windows-amd64') {
    const installed=await verifyWindowsProductIdentity(installedInventory,publicKey);
    if (installed.releaseId!==release.releaseId || installed.sourceRevision!==sourceRevision || installed.channel!==channel || !isDeepStrictEqual(installed.components,release.components)) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
  } else if (installedInventory!==undefined) throw new ProductUpdateError('UPDATE_TARGET_MISMATCH');
  return release;
}

export async function stageProductReleaseTarget(input, output) {
  const release=await validateProductReleaseTarget(input);
  await mkdir(output, { recursive: false, mode: 0o700 });
  const asset=path.join(output,release.asset.name);
  await cp(input.assetPath,asset,{force:false,errorOnExist:true});
  // Copy final signed bytes verbatim; never re-sign/repackage after metadata.
  if (await hashProductFile(asset)!==release.asset.sha256) throw new ProductUpdateError('UPDATE_ASSET_DIGEST_MISMATCH');
  await writeFile(path.join(output,productManifestName(release.target)),JSON.stringify(input.envelope)+'\n',{flag:'wx'});
  await writeFile(path.join(output,buildIdentityName(release.target)),JSON.stringify(input.identity)+'\n',{flag:'wx'});
  if (release.target==='windows-amd64') await writeFile(path.join(output,WINDOWS_INSTALLED_IDENTITY),JSON.stringify(input.installedInventory)+'\n',{flag:'wx'});
  return release;
}

export async function validateProductReleaseDirectory(directory, input) {
  requireProductReleaseTrust(input.publicKey);
  const releases=[]; const expected=[];
  for (const target of PRODUCT_TARGETS) {
    const envelope=JSON.parse(await readFile(path.join(directory,productManifestName(target)),'utf8'));
    const identity=JSON.parse(await readFile(path.join(directory,buildIdentityName(target)),'utf8'));
    const inventory=target==='windows-amd64'?JSON.parse(await readFile(path.join(directory,WINDOWS_INSTALLED_IDENTITY),'utf8')):undefined;
    const release=await validateProductReleaseTarget({...input,identity,envelope,installedInventory:inventory,assetPath:path.join(directory,identity.asset.name)});
    if (release.target!==target) throw new ProductUpdateError('UPDATE_TARGET_MISMATCH');
    releases.push(release); expected.push(release.asset.name,productManifestName(target),buildIdentityName(target));
  }
  expected.push(WINDOWS_INSTALLED_IDENTITY);
  const entries=await readdir(directory,{withFileTypes:true});
  if (entries.some((entry)=>!entry.isFile()) || entries.map(e=>e.name).sort().join(',')!==expected.sort().join(',')) throw new ProductUpdateError('UPDATE_RELEASE_ASSETS_INCOMPLETE');
  for (const component of ['desktop','runtime','avatar']) if (releases[0].components[component].version!==releases[1].components[component].version) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
  if (releases[0].publishedAt!==releases[1].publishedAt || releases[0].expiresAt!==releases[1].expiresAt) throw new ProductUpdateError('UPDATE_RELEASE_INPUT_MISMATCH');
  const files=[];
  for (const name of expected) files.push({name,path:path.join(directory,name),size:(await lstat(path.join(directory,name))).size,sha256:await hashProductFile(path.join(directory,name))});
  return {releaseId:releases[0].releaseId,version:releases[0].version,sourceRevision:releases[0].sourceRevision,channel:releases[0].channel,releases,files};
}
