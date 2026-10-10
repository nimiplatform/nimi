#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { validateProductReleaseDirectory } from '../lib/product-release-assets.mjs';
import { publishPreparedProductRelease } from '../lib/product-release-publish.mjs';
const args=process.argv.slice(2); if(args[0]==='--')args.shift();
if(args.length!==6 || args[0]!=='--directory' || args[2]!=='--source' || args[4]!=='--notes' || !/^[a-f0-9]{40}$/u.test(args[3])) throw Error('Required: --directory <flat ready assets> --source <SHA> --notes <file>');
const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}); if(head.status!==0 || head.stdout.trim()!==args[3]) throw Error('Product publish source differs from current checkout');
const status=spawnSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}); if(status.status!==0 || status.stdout.trim()) throw Error('Product publish source is dirty');
const version=JSON.parse(await readFile('apps/desktop/package.json','utf8')).version;
const batch=await validateProductReleaseDirectory(args[1],{sourceRevision:args[3],version});
const gh=async(argv,allowMissing=false)=>{
  const result=spawnSync('gh',argv,{encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.error || result.status!==0) {
    if(allowMissing && /HTTP 404/u.test(result.stderr ?? '')) return null;
    throw Error(`Product release GitHub command failed: ${result.error?.message ?? result.stderr?.slice(0,300)}`);
  }
  if(argv[0]==='api') return JSON.parse(result.stdout); return null;
};
const release=await publishPreparedProductRelease(batch,gh,args[5]);
process.stdout.write(`Published immutable product release: ${release.html_url}\n`);
