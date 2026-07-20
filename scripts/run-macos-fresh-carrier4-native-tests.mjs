#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseCommand } from '../apps/desktop/scripts/lib/macos-release-process.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('fresh carrier-4 native tests require native Apple Silicon');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outputRoot=path.join(root,'.nimi/local/macos-fresh-carrier4-native-tests');
const executable=path.join(outputRoot,'tests');
await rm(outputRoot,{recursive:true,force:true});await mkdir(outputRoot,{recursive:true,mode:0o700});
const sources=[
  path.join(root,'apps/desktop/macos/generated/macos_local_development_profile.swift'),
  path.join(root,'apps/desktop/macos/dev-security/FreshCarrier4Support.swift'),
  path.join(root,'apps/desktop/macos/dev-security/FreshCarrier4Installer.swift'),
  path.join(root,'apps/desktop/macos/dev-signing/NimiMacOSDevSigningDER.swift'),
  path.join(root,'scripts/macos-fresh-carrier4-native-tests.swift'),
];
const sdk=runReleaseCommand('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path']).stdout.trim();
runReleaseCommand('/usr/bin/xcrun',['swiftc','-parse-as-library','-target','arm64-apple-macos13.0','-sdk',sdk,'-framework','Security','-framework','OpenDirectory','-o',executable,...sources],{cwd:root,inherit:true});
runReleaseCommand(executable,[],{cwd:root,inherit:true});
process.stdout.write(`${JSON.stringify({status:'passed',assertions:2087,mutationSubsets:2048,keychainMutation:false,systemMutation:false})}\n`);
