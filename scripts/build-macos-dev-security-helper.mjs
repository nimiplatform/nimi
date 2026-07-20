#!/usr/bin/env node
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseCommand } from '../apps/desktop/scripts/lib/macos-release-process.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('fresh carrier-4 helper requires native Apple Silicon macOS');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/desktop/macos/dev-security');
const generated = path.join(root, 'apps/desktop/macos/generated/macos_local_development_profile.swift');
const outputRoot = path.join(root, '.nimi/local/macos-dev-security-build');
const outputPath = path.join(outputRoot, 'nimi-macos-dev-security');
const objectPath = `${outputPath}.o`;
// Complete privileged TCB source list. Directory discovery is forbidden.
export const PRIVILEGED_HELPER_SOURCES = Object.freeze([
  generated,
  path.join(source, 'FreshCarrier4Support.swift'),
  path.join(source, 'FreshCarrier4Installer.swift'),
  path.join(source, 'main.swift'),
]);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const sdk = runReleaseCommand('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']).stdout.trim();
const frontend = runReleaseCommand('/usr/bin/xcrun', ['--find', 'swift-frontend']).stdout.trim();
const toolchain = path.resolve(path.dirname(frontend), '..');
runReleaseCommand('/usr/bin/xcrun', ['swift-frontend','-c','-O','-whole-module-optimization','-parse-as-library','-target','arm64-apple-macos13.0','-sdk',sdk,'-module-name','NimiMacOSFreshCarrier4Installer','-o',objectPath,...PRIVILEGED_HELPER_SOURCES], { cwd: root, inherit: true });
runReleaseCommand('/usr/bin/xcrun', ['clang','-target','arm64-apple-macos13.0','-isysroot',sdk,'-L',path.join(sdk,'usr/lib/swift'),'-L',path.join(toolchain,'lib/swift-5.0/macosx'),'-Wl,-rpath,/usr/lib/swift','-framework','Security','-framework','OpenDirectory','-o',outputPath,objectPath], { cwd: root, inherit: true });
await rm(objectPath,{force:true});
const metadata=await stat(outputPath);if(!metadata.isFile()||metadata.size===0||(metadata.mode&0o111)===0)throw new Error('helper build missing executable');
runReleaseCommand('/usr/bin/lipo',['-archs',outputPath]);
process.stdout.write(`${JSON.stringify({status:'built',architecture:'arm64',outputPath,sourceCount:PRIVILEGED_HELPER_SOURCES.length,operations:['status','verify-candidate','install-candidate','restart-service','reset-service-state','uninstall-service'],posture:'linker_signed_non_authorizing_candidate_requires_user_domain_local_CA_signature_before_install'})}\n`);
