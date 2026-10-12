#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { validateProductReleaseDirectory } from '../lib/product-release-assets.mjs';
import { publishPreparedProductRelease, readProductPublishSource } from '../lib/product-release-publish.mjs';
const args=process.argv.slice(2); if(args[0]==='--')args.shift();
if(args.length!==6 || args[0]!=='--directory' || args[2]!=='--source' || args[4]!=='--notes' || !/^[a-f0-9]{40}$/u.test(args[3])) throw Error('Required: --directory <flat ready assets> --source <SHA> --notes <file>');
const {version}=readProductPublishSource(args[3]);
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
