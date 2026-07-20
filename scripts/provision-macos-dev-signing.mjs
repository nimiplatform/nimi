#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { copyFile, chmod, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE as P } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const systemResiduePaths = Object.freeze([
  '/Library/Application Support/Nimi/RuntimeDev',
  '/Applications/Nimi Dev.app',
  '/Library/LaunchDaemons/ai.nimi.runtime.dev.plist',
  '/private/var/run/nimi-dev',
  '/usr/local/libexec/nimi-macos-dev-security',
  '/usr/local/libexec/nimi-macos-dev-security-bootstrap',
]);

export function assertFreshSystemBaseline({ pathExists = existsSync, spawn = spawnSync } = {}) {
  const residue = systemResiduePaths.filter(pathExists);
  const principal = spawn('/usr/bin/id', ['_nimiruntimedev'], { stdio: 'ignore' });
  if (principal.error || !Number.isInteger(principal.status)) {
    throw baselineFailure('dev-signing-baseline-query-failed', 'inspect_the_exact_runtime_principal', 'The Runtime principal absence query did not return a definitive result.');
  }
  if (principal.status === 0) residue.push('principal:_nimiruntimedev');
  else if (principal.status !== 1) {
    throw baselineFailure('dev-signing-baseline-query-failed', 'inspect_the_exact_runtime_principal', `The Runtime principal absence query returned status ${principal.status}.`);
  }
  const launchd = spawn('/bin/launchctl', ['print', 'system/ai.nimi.runtime.dev'], { stdio: 'ignore' });
  if (launchd.error || !Number.isInteger(launchd.status)) {
    throw baselineFailure('dev-signing-baseline-query-failed', 'inspect_the_exact_launchd_job', 'The Runtime launchd absence query did not return a definitive result.');
  }
  if (launchd.status === 0) residue.push('launchd:system/ai.nimi.runtime.dev');
  else if (launchd.status !== 113) {
    throw baselineFailure('dev-signing-baseline-query-failed', 'inspect_the_exact_launchd_job', `The Runtime launchd absence query returned status ${launchd.status}.`);
  }
  if (residue.length > 0) {
    throw baselineFailure(P.legacyReasonCode, 'run_only_the_identity_bound_local_delete_only_cutover_or_exact_carrier_4_reset', `Fresh carrier-4 signing requires the fixed system namespace to be absent: ${residue.join(', ')}`);
  }
}

async function main() {
  if (process.argv.length !== 2) fail('macos-dev-signing-argument-invalid', 'run_without_arguments', 'provision:macos-dev-signing accepts no arguments');
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.getuid?.() === 0) fail('dev-runtime-platform-unsupported', 'use_a_native_non_root_apple_silicon_session', 'macOS development signing requires native Apple Silicon in a non-root login session.');
  try { assertFreshSystemBaseline(); } catch (error) { fail(error.reasonCode, error.actionHint, error.message); }
  const keychainPath = path.join(process.env.HOME ?? '', 'Library/Keychains/nimi-local-development-signing.keychain-db');
  const profileRoot = path.join(process.env.HOME ?? '', '.nimi/macos-dev-signing');
  const profilePath = path.join(profileRoot, 'public-profile.json');
  const toolPath = path.join(profileRoot, 'bin/nimi-macos-dev-signing');
  const partial = [keychainPath, profilePath, toolPath].filter(existsSync);
  if (partial.length > 0) fail(partial.length === 3 ? 'dev-signing-profile-already-present' : 'dev-signing-profile-partial', 'inspect_or_unprovision_the_exact_user_domain_profile', `Fresh carrier-4 signing state is not absent: ${partial.join(', ')}`);
  const impact = Object.freeze({
    creates: [keychainPath, profilePath, toolPath, 'one non-exportable ephemeral CA key during issuance', 'five stable non-exportable P-256 role keys and certificates', 'one login-Keychain generic secret restricted to the fixed signing tool'],
    modifies: ['user login Keychain: adds only ai.nimi.macos-local-development.signing-keychain.carrier4/unlock-v1'],
    excludes: ['System Keychain', 'Trust Settings', 'OpenDirectory', 'launchd', 'sudo', 'administrator authorization', 'Runtime custody'],
    productAdmission: false,
  });
  await confirm(impact, 'PROVISION NIMI MACOS DEV SIGNING');
  const build = run(process.execPath, [path.join(root, 'scripts/build-macos-dev-signing-tool.mjs')]);
  const receipt = JSON.parse(String(build.stdout).trim().split(/\r?\n/u).at(-1));
  let nativeMutationStarted = false;
  try {
    await mkdir(path.dirname(toolPath), { recursive: true, mode: 0o700 });
    await copyFile(receipt.output, toolPath, 0);
    await chmod(toolPath, 0o700);
    const secret = randomBytes(48).toString('base64url');
    nativeMutationStarted = true;
    const result = run(toolPath, ['provision', keychainPath, profilePath], `${secret}\n`);
    const value = JSON.parse(String(result.stdout).trim());
    process.stdout.write(`${JSON.stringify({ ...value, impact, profileId: P.profileId, carrier: P.carrier })}\n`);
  } catch (error) {
    if (!nativeMutationStarted) await rm(profileRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function confirm(value, phrase) {
  process.stdout.write(`${JSON.stringify({ status: 'confirmation-required', confirmation: phrase, impact: value })}\n`);
  if (!process.stdin.isTTY || !process.stderr.isTTY) fail('macos-dev-machine-mutation-confirmation-required', 'rerun_in_an_interactive_terminal', 'Interactive confirmation is required.');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await terminal.question(`Type ${JSON.stringify(phrase)} to continue: `); terminal.close();
  if (answer !== phrase) fail('macos-dev-machine-mutation-cancelled', 'rerun_only_after_approving_the_reported_changes', 'Signing provisioning was cancelled.');
}
function run(command, args, input = undefined) { const result=spawnSync(command,args,{cwd:root,encoding:'utf8',env:process.env,input,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}); if(result.error||result.status!==0){const line=String(result.stderr||'').trim().split(/\r?\n/u).at(-1);try{const value=JSON.parse(line);fail(value.reasonCode,value.actionHint,value.message);}catch{} throw new Error(`${path.basename(command)} failed with status ${result.status ?? 'unavailable'}: ${String(result.stderr||result.stdout||'').trim().slice(0,1000)}`,{cause:result.error});}return result; }
function baselineFailure(reasonCode, actionHint, message) { return Object.assign(new Error(message), { reasonCode, actionHint }); }
function fail(reasonCode, actionHint, message) { process.stderr.write(`${JSON.stringify({status:'failed',reasonCode,actionHint,message,mutation:'none'})}\n`); process.exit(1); }

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) await main();
