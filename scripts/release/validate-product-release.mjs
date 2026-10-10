#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateProductReleaseDirectory } from '../lib/product-release-assets.mjs';
const args=process.argv.slice(2); if(args[0]==='--')args.shift();
if(args.length!==4 || args[0]!=='--directory' || args[2]!=='--source' || !/^[a-f0-9]{40}$/u.test(args[3])) throw Error('Required: --directory <flat assets> --source <exact SHA>');
const version=JSON.parse(await readFile('apps/desktop/package.json','utf8')).version;
const release=await validateProductReleaseDirectory(args[1],{sourceRevision:args[3],version});
process.stdout.write(JSON.stringify({releaseId:release.releaseId,sourceRevision:release.sourceRevision,channel:release.channel,assets:release.files.map(f=>({name:f.name,size:f.size,sha256:f.sha256}))},null,2)+'\n');
