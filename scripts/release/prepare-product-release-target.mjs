#!/usr/bin/env node
import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { buildProductUpdateManifest } from '../lib/product-update-manifest.mjs';
import { stageProductReleaseTarget, validateProductReleaseAdmission, requireProductReleaseTrust } from '../lib/product-release-assets.mjs';
import { PRODUCT_UPDATE_POLICY } from '../../config/product-update-policy.mjs';
import { verifySignedMacOSInstaller, runReleaseCommand } from '../../apps/desktop/scripts/lib/macos-release-process.mjs';
import { verifyWindowsUnsignedInstaller } from '../../config/windows-product-installer.mjs';

const args=process.argv.slice(2); if(args[0]==='--') args.shift(); const opts={};
for(let i=0;i<args.length;i+=2) { if(!['--identity','--asset','--inventory','--admission','--signing-key','--output','--source'].includes(args[i]) || !args[i+1] || opts[args[i]]) throw Error('Invalid product release target arguments'); opts[args[i]]=args[i+1]; }
for(const key of ['--identity','--asset','--admission','--signing-key','--output','--source']) if(!opts[key]) throw Error(`Missing ${key}`);
requireProductReleaseTrust();
const sha=opts['--source']; if(!/^[a-f0-9]{40}$/u.test(sha)) throw Error('Invalid source revision');
const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}); if(head.status!==0 || head.stdout.trim()!==sha) throw Error('Release source is not current HEAD');
const status=spawnSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}); if(status.status!==0 || status.stdout.trim()) throw Error('Release source is dirty');
const version=JSON.parse(await readFile('apps/desktop/package.json','utf8')).version;
const identity=JSON.parse(await readFile(opts['--identity'],'utf8'));
const admission=validateProductReleaseAdmission(JSON.parse(await readFile(opts['--admission'],'utf8')),{version,sourceRevision:sha});
const installedInventory=opts['--inventory']?JSON.parse(await readFile(opts['--inventory'],'utf8')):undefined;
if(identity.target==='macos-arm64') {
  verifySignedMacOSInstaller(opts['--asset']);
  const output=runReleaseCommand('/usr/sbin/pkgutil',['--check-signature',opts['--asset']]).stdout;
  if(!new RegExp(`1\\. Developer ID Installer: [^\\n]+\\(${PRODUCT_UPDATE_POLICY.macOSTeamId}\\)`,'u').test(output)) throw Error('Installer publisher mismatch');
} else if(identity.target==='windows-amd64') await verifyWindowsUnsignedInstaller(opts['--asset']); else throw Error('Unsupported product target');
const envelope=await buildProductUpdateManifest({identity,assetPath:opts['--asset'],installedInventory,admission:{channel:admission.channel,publishedAt:admission.publishedAt,expiresAt:admission.expiresAt,compatibility:admission.compatibility[identity.target]},privateKey:await readFile(opts['--signing-key'])});
const output=path.resolve(opts['--output']); if(!output.startsWith(path.resolve('.nimi/local')+path.sep)) throw Error('Release staging must be under .nimi/local');
await mkdir(path.dirname(output),{recursive:true});
await stageProductReleaseTarget({identity,envelope,assetPath:opts['--asset'],installedInventory,sourceRevision:sha,version},output);
process.stdout.write(`Prepared ${identity.target} final release assets: ${output}\n`);
