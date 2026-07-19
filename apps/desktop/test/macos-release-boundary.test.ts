import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testRoot, '..');
const repoRoot = path.resolve(desktopRoot, '../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('macOS production builder is Developer-ID-only and carries no release private key', () => {
  const builder = source('apps/desktop/scripts/build-macos-electron-release.mjs');
  const contract = source('apps/desktop/scripts/lib/macos-release-contract.mjs');
  const process = source('apps/desktop/scripts/lib/macos-release-process.mjs');
  const workflow = source('.github/workflows/release-macos-electron.yml');

  assert.match(builder, /readMacOSProductionReleaseInputs\(\)/u);
  assert.match(builder, /NIMI_PLATFORM_RELEASE_ROOT_PRIVATE_KEY_PKCS8_B64URL/u);
  assert.match(builder, /Platform release private keys are forbidden in the build environment/u);
  assert.match(contract, /\/usr\/local\/libexec\/nimi-release-record-signer/u);
  assert.match(process, /input: payload/u);
  assert.match(process, /metadata\.uid !== 0 \|\| metadata\.gid !== 0/u);
  assert.doesNotMatch(workflow, /PRIVATE_KEY|private[-_ ]key|secrets\./iu);
  assert.match(workflow, /runs-on: \[self-hosted, macOS, ARM64, nimi-release\]/u);
  assert.match(workflow, /pnpm release:macos:electron/u);
  assert.doesNotMatch(builder, /identity:\s*['"]-['"]|ad[-_ ]hoc/iu);
});

test('macOS production installer remains fail-closed pending native admission', () => {
  const preinstall = source('apps/desktop/macos/installer/preinstall');
  const postinstall = source('apps/desktop/macos/installer/postinstall');
  const nativeCarrier = source('kit/shell/protected-local/src/macos_native.m');
  const serviceControl = source('kit/shell/protected-local/src/macos_service_control.rs');

  for (const script of [preinstall, postinstall]) {
    assert.match(script, /id -u/u);
    assert.match(script, /id -ru/u);
    assert.doesNotMatch(script, /launchctl\s+(?:bootstrap|load)/u);
  }
  assert.match(preinstall, /launchctl bootout/u);
  assert.match(preinstall, /Runtime service did not stop before update/u);
  assert.match(postinstall, /requirements-only and fail-closed/u);
  assert.match(postinstall, /exit 78/u);
  assert.doesNotMatch(postinstall, /macos-protected-state-provision|dscl|runtime-account/u);
  assert.match(nativeCarrier, /unregisterWithCompletionHandler/u);
  assert.match(nativeCarrier, /dispatch_semaphore_wait/u);
  assert.match(nativeCarrier, /service\.status != SMAppServiceStatusNotRegistered/u);
  assert.match(serviceControl, /SERVICE_ENABLED && runtime_socket_is_absent\(\)/u);
  assert.match(serviceControl, /nimi_macos_reregister_runtime_service\(\)/u);
});

test('macOS daemon and entitlements encode the admitted native boundary exactly', () => {
  const daemon = source('apps/desktop/macos/LaunchDaemons/ai.nimi.runtime.plist');
  const electronEntitlements = source('apps/desktop/macos/entitlements/electron.plist');
  const runtimeEntitlements = source('apps/desktop/macos/entitlements/runtime.plist');

  assert.match(daemon, /<key>BundleProgram<\/key>\s*<string>Contents\/Library\/LaunchServices\/nimi-runtime<\/string>/u);
  assert.match(daemon, /<key>UserName<\/key>\s*<string>_nimiruntime<\/string>/u);
  assert.match(daemon, /<key>GroupName<\/key>\s*<string>_nimiruntime<\/string>/u);
  assert.match(daemon, /\/private\/var\/run\/nimi\/runtime-desktop\.sock/u);
  assert.match(daemon, /\/private\/var\/run\/nimi\/runtime-local-app\.sock/u);
  assert.doesNotMatch(daemon, /localhost|127\.0\.0\.1|TCP|LaunchAgent/u);

  assert.match(electronEntitlements, /com\.apple\.security\.cs\.allow-jit/u);
  assert.doesNotMatch(electronEntitlements, /disable-library-validation|get-task-allow|camera|audio-input/u);
  assert.match(runtimeEntitlements, /<dict\/>/u);
});

test('layout-only output is structurally useful but cannot claim admission', () => {
  const builder = source('apps/desktop/scripts/build-macos-electron-release.mjs');
  const mainBundler = source('apps/desktop/scripts/bundle-electron-main.mjs');
  assert.match(builder, /requirements_only_fail_closed_unsigned_unnotarized_layout/u);
  assert.match(builder, /acceptanceEligible: false/u);
  assert.match(builder, /productionRoleRecords: false/u);
  assert.match(builder, /refusing to overwrite existing macOS release output/u);
  assert.match(builder, /stageSharpRuntime\(source\)/u);
  assert.match(builder, /asar: \{ unpack: '\*\*\/\*\.\{node,dylib\}' \}/u);
  assert.match(mainBundler, /\['electron', 'sharp', '@nimiplatform\/kit-protected-local-darwin-arm64'\]/u);
  assert.match(mainBundler, /const require = __nimiCreateRequire\(import\.meta\.url\)/u);
  assert.doesNotMatch(builder, /acceptanceEligible:\s*true/u);
});

test('macOS non-product build injects the one generated development Host path into both verifiers', () => {
  const builder = source('apps/desktop/scripts/build-macos-electron-release.mjs');
  const bundler = source('apps/desktop/scripts/bundle-electron-main.mjs');
  const plan = source('apps/desktop/src-electron/local-development-plan.ts');
  const generated = source('apps/desktop/scripts/generated/macos-local-development-profile.mjs');
  const hostContract = source('apps/desktop/macos/local-app-host/contract.mjs');

  assert.match(generated, /"localAppHostPath": "\/Applications\/Nimi Dev\.app\/Contents\/Frameworks\/Nimi Local App Host Dev\.app\/Contents\/MacOS\/Nimi Local App Host Dev"/u);
  assert.match(bundler, /MACOS_LOCAL_DEVELOPMENT_PROFILE\.localAppHostPath/u);
  assert.match(bundler, /__NIMI_MACOS_LOCAL_APP_HOST_PATH__/u);
  assert.match(plan, /canonicalFile\(macOSLocalAppHostPath\(\)\)/u);
  assert.match(builder, /contractSource\.replace\(productionPathLiteral, JSON\.stringify\(MACOS_LOCAL_DEVELOPMENT_PROFILE\.localAppHostPath\)\)/u);
  assert.match(hostContract, /MACOS_LOCAL_APP_HOST_EXECUTABLE/u);
  assert.doesNotMatch(builder, /NIMI_MACOS_LOCAL_APP_HOST|process\.env.*localAppHost/iu);
});
