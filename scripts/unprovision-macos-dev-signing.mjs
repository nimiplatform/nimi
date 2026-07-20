#!/usr/bin/env node
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { readdir, rmdir, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';

if (process.argv.length !== 2) fail('macos-dev-signing-argument-invalid', 'run_without_arguments', 'unprovision:macos-dev-signing accepts no arguments');
if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.getuid?.() === 0) fail('dev-runtime-platform-unsupported', 'use_a_native_non_root_apple_silicon_session', 'macOS development signing removal requires a native non-root login session.');
const home = process.env.HOME ?? '';
const keychainPath = path.join(home, 'Library/Keychains/nimi-local-development-signing.keychain-db');
const profileRoot = path.join(home, '.nimi/macos-dev-signing');
const profilePath = path.join(profileRoot, 'public-profile.json');
const toolPath = path.join(profileRoot, 'bin/nimi-macos-dev-signing');
const installedRuntimeObjects = [
  '/Library/Application Support/Nimi/RuntimeDev',
  '/Library/Application Support/Nimi/RuntimeDev/active',
  '/Library/Application Support/Nimi/RuntimeDev/state',
  '/Library/Application Support/Nimi/RuntimeDev/installation-transaction.json',
  '/Library/LaunchDaemons/ai.nimi.runtime.dev.plist',
  '/usr/local/libexec/nimi-macos-dev-security',
  '/Applications/Nimi Dev.app',
  '/private/var/run/nimi-dev/runtime-desktop.sock',
  '/private/var/run/nimi-dev/runtime-local-app.sock',
].filter(existsSync);
if (installedRuntimeObjects.length) fail('dev-signing-unprovision-runtime-installed', 'run_the_explicit_Runtime_uninstall_first', `Runtime service objects still exist: ${installedRuntimeObjects.join(', ')}`);
const present = [keychainPath, profilePath, toolPath].filter(existsSync);
if (present.length === 0 && !existsSync(profileRoot)) { process.stdout.write(`${JSON.stringify({status:'absent',mutation:'none',productAdmission:false})}\n`); process.exit(0); }
if (!existsSync(toolPath)) {
  if (existsSync(keychainPath) || existsSync(profilePath)) fail('dev-signing-profile-partial', 'preserve_and_inspect_the_exact_user_domain_profile', `Signing recovery tool is absent while authority residue remains: ${present.join(', ')}`);
  const entries=await readdir(profileRoot);
  if(entries.length===1&&entries[0]==='bin'){const bin=await readdir(path.dirname(toolPath));if(bin.length!==0)fail('dev-signing-profile-partial','preserve_and_inspect_the_exact_user_domain_profile','Signing recovery directory contains unknown residue.');}
  else if(entries.length!==0)fail('dev-signing-profile-partial','preserve_and_inspect_the_exact_user_domain_profile','Signing profile contains unknown residue without its recovery tool.');
  const filesystemImpact={deletes:[profileRoot],preserves:['System Keychain','Runtime custody','all user signing identities'],productAdmission:false};
  await confirm(filesystemImpact,'UNPROVISION NIMI MACOS DEV SIGNING');
  if(entries.length===1)await rmdir(path.dirname(toolPath));await rmdir(profileRoot);
  process.stdout.write(`${JSON.stringify({status:'unprovisioned',mutation:'exact_empty_user_domain_signing_directory_deleted',impact:filesystemImpact,productAdmission:false})}\n`);process.exit(0);
}
const toolMetadata=lstatSync(toolPath);
if(!toolMetadata.isFile()||toolMetadata.isSymbolicLink()||toolMetadata.nlink!==1||(toolMetadata.mode&0o077)!==0||realpathSync(toolPath)!==toolPath)fail('dev-signing-profile-partial','preserve_and_inspect_the_exact_user_domain_profile','Signing recovery tool metadata is untrusted.');
const rootEntries=await readdir(profileRoot),binEntries=await readdir(path.dirname(toolPath));
const allowedRoot=new Set(['bin','public-profile.json',...rootEntries.filter((entry)=>/^public-profile\.json\.tmp\.[1-9][0-9]*$/u.test(entry))]);
if(rootEntries.some((entry)=>!allowedRoot.has(entry))||binEntries.length!==1||binEntries[0]!=='nimi-macos-dev-signing')fail('dev-signing-profile-partial','preserve_and_inspect_the_exact_user_domain_profile','Signing profile contains unknown residue and cannot be deleted as the exact profile.');
const impact = Object.freeze({ deletes: [keychainPath, profilePath, toolPath, 'login-Keychain ai.nimi.macos-local-development.signing-keychain.carrier4/unlock-v1'], preserves: ['System Keychain', 'Runtime custody', 'all non-Nimi user identities'], productAdmission: false });
await confirm(impact, 'UNPROVISION NIMI MACOS DEV SIGNING');
const result = spawnSync(toolPath, ['unprovision', keychainPath, profilePath], { encoding: 'utf8', env: process.env, stdio: ['ignore','pipe','pipe'] });
if (result.error || result.status !== 0) {
  const line=String(result.stderr||'').trim().split(/\r?\n/u).at(-1); try { const value=JSON.parse(line); fail(value.reasonCode,value.actionHint,value.message); } catch {}
  throw new Error(`signing unprovision failed with status ${result.status ?? 'unavailable'}: ${String(result.stderr||'').slice(0,1000)}`, { cause: result.error });
}
const value=JSON.parse(String(result.stdout).trim());
for(const entry of rootEntries.filter((value)=>/^public-profile\.json\.tmp\.[1-9][0-9]*$/u.test(value))){await unlink(path.join(profileRoot,entry));}
await unlink(toolPath);await rmdir(path.dirname(toolPath));await rmdir(profileRoot);
if ([keychainPath,profileRoot].some(existsSync)) fail('dev-signing-unprovision-incomplete','inspect_the_exact_user_domain_paths','Signing profile residue remains after deletion.');
process.stdout.write(`${JSON.stringify({...value,impact})}\n`);

async function confirm(value, phrase) { process.stdout.write(`${JSON.stringify({status:'confirmation-required',confirmation:phrase,impact:value})}\n`); if(!process.stdin.isTTY||!process.stderr.isTTY)fail('macos-dev-machine-mutation-confirmation-required','rerun_in_an_interactive_terminal','Interactive confirmation is required.'); const terminal=readline.createInterface({input:process.stdin,output:process.stderr});const answer=await terminal.question(`Type ${JSON.stringify(phrase)} to continue: `);terminal.close();if(answer!==phrase)fail('macos-dev-machine-mutation-cancelled','rerun_only_after_approving_the_reported_changes','Signing unprovision was cancelled.'); }
function fail(reasonCode,actionHint,message){process.stderr.write(`${JSON.stringify({status:'failed',reasonCode,actionHint,message,mutation:'none'})}\n`);process.exit(1);}
