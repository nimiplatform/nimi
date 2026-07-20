#!/usr/bin/env node
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseCommand } from '../apps/desktop/scripts/lib/macos-release-process.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('macOS development signing tool requires native Apple Silicon');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/desktop/macos/dev-signing');
const outputRoot = path.join(root, '.nimi/local/macos-dev-signing-build');
const output = path.join(outputRoot, 'nimi-macos-dev-signing');
const object = `${output}.o`;
// Closed user-domain signing-tool source list. This is not part of the privileged installer TCB.
const sources = [
  path.join(source, 'NimiMacOSDevSigningDER.swift'),
  path.join(source, 'NimiMacOSDevSigningTool.swift'),
];
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const sdk = runReleaseCommand('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']).stdout.trim();
const frontend = runReleaseCommand('/usr/bin/xcrun', ['--find', 'swift-frontend']).stdout.trim();
const toolchain = path.resolve(path.dirname(frontend), '..');
runReleaseCommand('/usr/bin/xcrun', ['swift-frontend', '-c', '-O', '-whole-module-optimization', '-parse-as-library', '-target', 'arm64-apple-macos13.0', '-sdk', sdk, '-module-name', 'NimiMacOSDevSigningTool', '-o', object, ...sources], { cwd: root, inherit: true });
runReleaseCommand('/usr/bin/xcrun', ['clang', '-target', 'arm64-apple-macos13.0', '-isysroot', sdk, '-L', path.join(sdk, 'usr/lib/swift'), '-L', path.join(toolchain, 'lib/swift-5.0/macosx'), '-Wl,-rpath,/usr/lib/swift', '-framework', 'Security', '-o', output, object], { cwd: root, inherit: true });
await rm(object, { force: true });
const metadata = await stat(output);
if (!metadata.isFile() || metadata.size === 0 || (metadata.mode & 0o111) === 0) throw new Error('development signing tool build is invalid');
runReleaseCommand('/usr/bin/lipo', ['-archs', output]);
process.stdout.write(`${JSON.stringify({ status: 'built', output, architecture: 'arm64', sourceCount: sources.length, privilegedTCB: false })}\n`);
