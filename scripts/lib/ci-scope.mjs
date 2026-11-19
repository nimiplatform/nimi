export const CI_LANES = {
  'docs-contract': 'docs_changed',
  'core-static': 'core_changed',
  'workspace-regression': 'workspace_changed',
  'kit-native-tests': 'kit_native_changed',
  'windows-runtime-tests': ['windows_runtime_changed', 'windows_app_tools_changed'],
  'macos-platform-tests': ['native_runtime_changed', 'macos_carrier_changed', 'macos_host_changed'],
  'macos-updater-build': 'macos_updater_changed',
  'sdk-quality': 'sdk_changed',
  'runtime-quality': 'runtime_changed',
  'proto-quality': 'proto_changed',
  'desktop-web-quality': 'desktop_changed',
};

const sdkUnitTest = /^sdks\/typescript\/(?:core|runtime)\/.+\.test\.ts$/u;
const webBuildFiles = new Set([
  'package.json', 'tsconfig.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.pnpmfile.cjs',
  'scripts/with-workspace-surfaces.mjs', 'scripts/lib/workspace-surfaces.mjs',
  'scripts/lib/sdk-dist-lock.mjs', 'scripts/lib/command-runner.mjs',
  'scripts/with-sdk-dist-lock.mjs', 'scripts/build-typescript-package.mjs', 'scripts/lib/build-output-publisher.mjs',
  'scripts/release/web-promotion.mjs', '.github/workflows/deploy-web.yml',
]);

export function webBuildInputsChanged(paths) {
  return paths.some(file => {
    if (webBuildFiles.has(file)) return true;
    if (sdkUnitTest.test(file) || /^(?:apps\/web|kit|sdks\/typescript)\/(?:README|AGENTS|CHANGELOG)\.md$/u.test(file)) return false;
    return /^(?:apps\/web|kit|sdks\/typescript|config|runtime\/catalog\/providers)\//u.test(file);
  });
}

export function selectCiScope(files, { full = false, docsReviewTargets = [] } = {}) {
  const paths = files.map((file) => file.replaceAll('\\', '/'));
  const sdkTestsChanged = paths.some(file => sdkUnitTest.test(file));
  const codePaths = paths.filter(file => !sdkUnitTest.test(file)
    && (!/\.(?:md|mdx)$/u.test(file) || file.endsWith('.authority.md')));
  const touches = (pattern) => full || codePaths.some((file) => pattern.test(file));
  const shared = touches(/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.pnpmfile\.cjs|\.node-version|\.github\/workflows\/ci\.yml)$/u);
  const scripts = touches(/^scripts\//u);
  const checkerOnly = /^(?:scripts\/(?:ci-scope\.test|check-eol-noise|check-text-encoding-gate)\.mjs|scripts\/lib\/text-encoding-gate\.mjs)$/u;
  const productScripts = full || codePaths.some((file) => file.startsWith('scripts/') && !checkerOnly.test(file));
  const productAuthority = full || codePaths.some((file) => file.startsWith('.nimi/')
    && !file.startsWith('.nimi/methodology/')
    && file !== '.nimi/config/authority-verifiers.yaml'
    && /^(?:\.nimi\/(?:spec|config)\/)/u.test(file));
  const config = touches(/^config\//u);
  const authority = touches(/^\.nimi\/(?:spec\/|config\/|methodology\/)/u);
  const proto = shared || touches(/^(?:proto\/|runtime\/(?:gen|proto)\/|scripts\/(?:proto-breaking|proto-baseline|check-proto-drift|run-buf)[^/]*\.mjs$|scripts\/lib\/proto-wire-baseline\.mjs$)/u);
  const sdk = shared || config || proto || touches(/^(?:sdks\/|\.nimi\/spec\/sdks\/|tsconfig\.json$)/u);
  const kit = shared || config || sdk || touches(/^(?:kit\/|\.nimi\/spec\/platform\/ui-design-system\.authority\.)/u);
  const cognition = shared || touches(/^(?:nimi-cognition\/|go\.work(?:\.sum)?$)/u);
  const runtime = cognition || config || proto || touches(/^(?:runtime\/|npm-packages\/|\.goreleaser\.yml$|\.nimi\/spec\/runtime\/|scripts\/(?:build-runtime|dev-runtime)\.mjs$)/u);
  const macPackageFiles = /^kit\/shell\/protected-local-node\/(?:npm\/darwin-arm64\/|scripts\/build-darwin-arm64-package\.mjs$)/u;
  const windowsPackageFiles = /^kit\/shell\/protected-local-node\/(?:npm\/win32-x64\/|scripts\/build-windows-x64-package\.mjs$)/u;
  const carrierSource = codePaths.some(file => /^kit\/shell\/protected-local(?:-node)?\//u.test(file)
    && !macPackageFiles.test(file) && !windowsPackageFiles.test(file));
  const macosCarrier = proto || carrierSource || touches(/^rust-toolchain\.toml$/u);
  const kitNative = macosCarrier || touches(/^kit\/shell\/(?:capabilities|tauri)\//u);
  const kitNativePackage = macosCarrier || touches(/^(?:kit\/package\.json|config\/product-update-policy\.mjs|\.github\/workflows\/release-kit\.yml|scripts\/release\/(?:component-version|build-component-package)\.mjs)$/u);
  const desktopNative = shared || proto || touches(/^(?:apps\/desktop\/product-control-|kit\/shell\/protected-local\/)/u);
  const desktop = desktopNative || touches(/^apps\/desktop\/(?!AGENTS\.md$)/u);
  const macosUpdater = shared || touches(/^(?:apps\/desktop\/macos\/product-updater\/|apps\/desktop\/scripts\/(?:build-macos-(?:product-updater|electron-release)|lib\/(?:macos-release-process|release-source-maps))\.mjs$|config\/product-update-policy\.mjs$)/u);
  // Keep shared Go inputs conservative. Provider catalog data is exercised by
  // runtime-quality and by the Web landing-data generator on Ubuntu.
  const nativeRuntime = cognition || proto || touches(/^(?:runtime\/(?!catalog\/providers\/[^/]+\.ya?ml$)|config\/runtime-(?!provider-)|npm-packages\/|scripts\/(?:build-runtime|dev-runtime)\.mjs$)/u);
  const macosHost = desktopNative || macosCarrier
    || touches(/^(?:kit\/shell\/electron\/|apps\/desktop\/(?:src-electron\/|macos\/local-app-host\/))/u)
    || touches(/^apps\/desktop\/test\/(?:electron-(?:desktop-open-intent|support-logs|system-resources)-host|macos-(?:local-app-host-contract|release-policy))\.test\./u)
    || touches(/^scripts\/(?:dev-app|dev-runtime|doctor-dev|macos-dev-runtime-service|build-supervised-app-electron)[^/]*\.mjs$/u)
    || touches(/^scripts\/lib\/(?:dev-app-launch(?:\.test)?|electron-carrier-processes|supervised-app-electron-production|ci-scope)\.mjs$/u);
  const windowsRuntime = nativeRuntime || touches(/^config\/windows-/u) || touches(/^(?:scripts\/(?:install-windows-runtime-service\.ps1|accept-runtime-fixed-service(?:\.test)?\.mjs|windows-runtime-service-installer-contract\.test\.mjs|build-windows-runtime-service-installer\.mjs)|scripts\/lib\/windows-powershell\.mjs)$/u);
  const windowsAppTools = shared || touches(/^app-tools\//u);
  const filters = new Set();

  // pnpm resolves transitive workspace consumers; only source-copy dependencies
  // that are not package dependencies need an explicit edge here.
  if (shared || productScripts || config || productAuthority) filters.add('*');
  if (sdk) filters.add('...@nimiplatform/sdk');
  else if (kit) filters.add('...@nimiplatform/kit');
  if (sdk || kit) filters.add('@nimiplatform/app-tools');
  if (!shared && touches(/^runtime\/catalog\/providers\//u)) filters.add('./apps/web');
  for (const file of paths) {
    if (/\.(?:md|mdx)$/u.test(file)) continue;
    const app = file.match(/^(apps\/[^/]+)\//u);
    if (app) filters.add(`./${app[1]}`);
    const gateway = file.match(/^(gateways\/[^/]+)\//u);
    if (gateway) filters.add(`./${gateway[1]}`);
    if (file.startsWith('apps/lab/')) filters.add('@nimiplatform/app-tools');
    if (file.startsWith('app-tools/')) filters.add('@nimiplatform/app-tools');
    if (file.startsWith('nimi2d/')) filters.add('./nimi2d');
  }

  const productWorkspaces = filters.size > 0;
  if (sdkTestsChanged && !sdk && !filters.has('*')) filters.add('@nimiplatform/sdk');

  const remoteGuide = /^docs\/(?:zh\/)?(?:sdk\/|start\/(?:connect-|install\.|troubleshooting\.|use-nimi-lab\.)|runtime\/(?:account-and-session|multimodal)|platform\/(?:kit\/|architecture\/))/u;
  const remoteClients = full || sdk || kit || touches(/^app-tools\//u)
    || touches(/^scripts\/prepare-docs-mobile-reference\.mjs$/u)
    || paths.some(file => /^examples\/remote-runtime-/u.test(file))
    || docsReviewTargets.some(file => remoteGuide.test(file));
  const docsSourceChecks = touches(/^scripts\/(?:check-docs-source|docs-source\.test|ci-scope\.test|lib\/docs-source)\.mjs$/u);

  return {
    remote_clients_changed: remoteClients,
    docs_changed: full || remoteClients || docsSourceChecks || docsReviewTargets.length > 0
      || paths.some((file) => /^(?:docs\/|examples\/)|\.(?:md|mdx)$/u.test(file)),
    core_changed: shared || scripts || config || authority || productWorkspaces
      || touches(/^(?:\.github\/|licenses\/|LICENSE$|\.gitignore$|\.gitattributes$|\.editorconfig$)/u),
    workspace_changed: filters.size > 0,
    workspace_filters: [...filters],
    scripts_changed: scripts || shared,
    authority_changed: authority || shared,
    kit_changed: kit,
    sdk_changed: sdk,
    sdk_adapter_upstream_changed: shared || touches(/^sdks\/typescript\//u),
    sdk_conformance_changed: config || proto || touches(/^(?:sdks\/(?:conformance|generators|go|python|rust)\/|\.nimi\/spec\/sdks\/)/u),
    proto_changed: proto,
    runtime_changed: runtime,
    cognition_changed: cognition,
    desktop_changed: desktop,
    desktop_native_changed: desktopNative,
    kit_native_changed: kitNative,
    native_runtime_changed: nativeRuntime,
    macos_carrier_changed: macosCarrier,
    macos_host_changed: macosHost,
    kit_macos_package_changed: kitNativePackage || touches(macPackageFiles),
    kit_windows_package_changed: kitNativePackage || touches(windowsPackageFiles),
    web_changed: full || webBuildInputsChanged(paths),
    macos_updater_changed: macosUpdater,
    windows_runtime_changed: windowsRuntime,
    windows_app_tools_changed: windowsAppTools,
  };
}

export function assertCiResults(needs) {
  if (needs.changes?.result !== 'success') throw new Error('CI path selection did not pass');
  const failures = [];
  for (const [lane, flags] of Object.entries(CI_LANES)) {
    const selections = [flags].flat().map((flag) => {
      const selected = needs.changes.outputs[flag];
      if (!['true', 'false'].includes(selected)) throw new Error(`missing CI selection: ${flag}`);
      return selected;
    });
    const selected = selections.includes('true') ? 'true' : 'false';
    const result = needs[lane]?.result;
    const expected = selected === 'true' ? ['success'] : ['skipped'];
    if (!expected.includes(result)) failures.push(`${lane}=${result} (selected=${selected})`);
  }
  if (failures.length > 0) throw new Error(`CI lanes did not pass: ${failures.join(', ')}`);
}
