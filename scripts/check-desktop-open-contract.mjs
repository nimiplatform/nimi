#!/usr/bin/env node

import {
  collectFiles,
  failWith,
  findPatternViolations,
  parseYaml,
  pass,
  read,
  rel,
  requireText,
} from './lib/desktop-open-checks.mjs';

const failures = [];

const rootPackage = JSON.parse(read('package.json'));
if (rootPackage.scripts?.['check:desktop-open-contract'] !== 'node scripts/check-desktop-open-contract.mjs') {
  failures.push('root check:desktop-open-contract must execute the consolidated checker exactly once');
}
const contractFiles = collectFiles([
  '.nimi/spec',
  'apps/desktop/src-tauri/src',
  'apps/desktop/src/shell/renderer',
  'kit',
  'sdks/typescript/core',
]);
failures.push(...findPatternViolations(contractFiles, [
  /\bDesktopLaunchIntent\b/u,
  /desktop-launch\.openIntent/u,
  /desktop-launch:\/\/open-intent/u,
  /desktop-electron-installed-app-host/u,
], {
  allow: (relPath, line) => (
    relPath.includes('desktop-open')
      && line.includes('DesktopLaunchIntent')
      && line.includes('reject')
  ),
}));

const rawUrlFiles = collectFiles([
  'apps/zhiyu/src',
  'apps/desktop/src/shell/renderer',
  'kit/core/src',
  'kit/shell/renderer/src',
  'kit/shell/electron/src',
  'kit/shell/tauri/src',
  'sdks/typescript/core',
]);
failures.push(...findPatternViolations(rawUrlFiles, [
  /nimi-desktop:\/\//u,
  /__nimi_desktop_launch__/u,
  /desktop-launch:\/\/open-intent/u,
  /open_desktop_explore_character_persona/u,
], {
  allow: (relPath, line) => (
    relPath.endsWith('desktop-open-intent-listener.ts')
      || (relPath.includes('/oauth') && line.includes('__nimi_desktop_launch__'))
  ),
}));

const transportFiles = collectFiles([
  'apps/zhiyu/src',
  'apps/desktop/src/shell/renderer',
  'kit/shell/renderer/src',
  'kit/shell/electron/src',
]);
failures.push(...findPatternViolations(transportFiles, [
  /openExternalUrl\([^)]*desktop/iu,
  /webbrowser::open/u,
  /tauri_plugin_single_instance/u,
  /single-instance/u,
  /nimi-desktop:\/\//u,
]));

failures.push(...requireText('sdks/typescript/core/app/desktop-open.ts', [
  'DesktopOpenIntent',
  'desktop-electron-local-app-host',
]));
failures.push(...requireText('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs', [
  'start_desktop_open_intent_bridge',
]));

const desktopBridge = read('apps/desktop/src-tauri/src/desktop_open_intent.rs');
const desktopBootstrap = read('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
const sdkContract = read('sdks/typescript/core/app/desktop-open.ts');
if (!desktopBridge.includes('TcpListener::bind("127.0.0.1:0")')) {
  failures.push('Desktop bridge must bind exact 127.0.0.1:0 loopback');
}
if (desktopBridge.includes('0.0.0.0') || desktopBridge.includes('[::]:')) {
  failures.push('Desktop bridge must not bind wildcard addresses');
}
if (desktopBootstrap.includes('DeepLinkOpenTabPayload')) {
  failures.push('Desktop bootstrap still admits the retired deep-link navigation payload');
}
if (/MENU_BAR_OPEN_TAB_EVENT[\s\S]*DeepLinkOpenTabPayload/u.test(desktopBootstrap)) {
  failures.push('Desktop bootstrap still maps deep-link URLs to menu-bar navigation');
}
if (sdkContract.includes('desktop-open-bridge-unavailable')) {
  failures.push('SDK contains the non-admitted v1 result code desktop-open-bridge-unavailable');
}
if (desktopBridge.includes('desktop-open-host-unavailable')) {
  failures.push('Desktop bridge must not produce the host-only desktop-open-host-unavailable result');
}

const registrationFiles = collectFiles([
  'apps/desktop/src-tauri',
  'apps/desktop/src',
  'kit',
], {
  extensions: new Set(['.json', '.rs', '.toml', '.ts', '.tsx', '.mjs', '.js']),
});
for (const file of registrationFiles) {
  const relPath = rel(file);
  if (relPath.endsWith('_tests.rs') || relPath.includes('/test/') || relPath.includes('/tests/')) {
    continue;
  }
  const text = read(relPath);
  if (/tauri-plugin-deep-link|deep_link\(\)|\.deep_link\(\)|register\(\s*["']nimi-desktop["']\s*\)/u.test(text)) {
    failures.push(`${relPath} contains forbidden Desktop Open OS-scheme registration`);
  }
  if (relPath.endsWith('tauri.conf.json') && /"schemes"\s*:\s*\[[^\]]*"nimi-desktop"/u.test(text)) {
    failures.push(`${relPath} registers the nimi-desktop OS scheme`);
  }
  if (relPath.endsWith('Cargo.toml') && /tauri-plugin-deep-link/u.test(text)) {
    failures.push(`${relPath} depends on tauri-plugin-deep-link`);
  }
  if (relPath.endsWith('capabilities/default.json') && /deep-link:default/u.test(text)) {
    failures.push(`${relPath} admits deep-link permissions`);
  }
}

const capabilityCatalogSource = read('kit/shell/tauri/src/capabilities/catalog.rs');
if (capabilityCatalogSource.includes('id: "desktop-open"')
  && capabilityCatalogSource.includes('command: "nimi.shell.desktopOpen.openIntent"')) {
  failures.push(...requireText('kit/shell/renderer/src/bridge/tauri-api.ts', [
    "[NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent']]",
  ]));
  failures.push(...requireText('kit/shell/tauri/src/command_registration.rs', [
    'desktop_open_intent_open_intent',
    'DESKTOP_OPEN_INTENT_COMMANDS',
  ]));
}

failures.push(...requireText('kit/shell/electron/src/main/oauth.ts', [
  'isDesktopOpenReservedOauthUrl',
  'decodeURIComponent',
  '/v1/open-intent',
  '/__nimi_desktop_launch__',
  '/desktop-open',
]));
failures.push(...requireText('kit/shell/tauri/src/oauth_commands.rs', [
  'is_desktop_open_reserved_oauth_url',
  'percent_decode_path',
  '/v1/open-intent',
  '/__nimi_desktop_launch__',
  '/desktop-open',
]));
const electronOauthTest = read('kit/shell/electron/test/electron-shell-bridge-host-features.test.ts');
const tauriOauthTest = read('kit/shell/tauri/src/oauth_commands.rs');
for (const variant of [
  'http://[::1]:4500/v1/open-intent',
  '/%76%31/%6f%70%65%6e%2d%69%6e%74%65%6e%74',
  '/v1/open-intent/',
  '/v1/open-intent?x=1#fragment',
  '/V1/Open-Intent',
  '/desktop-open/%2e%2e/v1/open-intent',
]) {
  if (!electronOauthTest.includes(variant) || !tauriOauthTest.includes(variant)) {
    failures.push(`OAuth reserved-route tests missing ${variant}`);
  }
}

failures.push(...requireText('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs', [
  'PageLoadEvent::Started',
  'WindowEvent::Destroyed',
  'RunEvent::ExitRequested',
  'set_desktop_open_intent_ready(app_handle, false)',
  'runtime.set_ready(ready)',
  'desktop_open_intent_set_ready',
]));
failures.push(...requireText('apps/desktop/src/shell/renderer/infra/desktop-open/desktop-open-intent-listener.ts', [
  'hasNimiShellRuntime',
  'listenShell',
  'desktop-open://open-intent',
  'setDesktopOpenIntentReady(true)',
  'setDesktopOpenIntentReady(false)',
  'DESKTOP_OPEN_READY_HEARTBEAT_INTERVAL_MS',
  'globalThis.setInterval',
  'globalThis.clearInterval',
]));
failures.push(...requireText('apps/desktop/src-tauri/src/desktop_open_intent.rs', [
  'desktop-open-desktop-not-ready',
  'wait_for_desktop_ready',
  'RENDERER_READY_HEARTBEAT_TTL_MS',
  'last_ready_heartbeat',
  'is_desktop_open_ready',
]));

const sdkFiles = collectFiles(['sdks/typescript/core/app']);
failures.push(...findPatternViolations(sdkFiles, [
  /from ['"]@nimiplatform\/kit/u,
  /import\(['"]@nimiplatform\/kit/u,
  /from ['"][^'"]*(?:electron|tauri)/u,
  /import\(['"][^'"]*(?:electron|tauri)/u,
  /window\./u,
  /openExternalUrl\(/u,
]));
const kitCoreFiles = collectFiles(['kit/core/src']);
failures.push(...findPatternViolations(kitCoreFiles, [
  /from ['"][^'"]*(?:apps\/desktop|apps\/zhiyu|react|electron|tauri)/u,
  /import\(['"][^'"]*(?:apps\/desktop|apps\/zhiyu|react|electron|tauri)/u,
]));
const desktopNavigation = read('apps/desktop/src/shell/renderer/infra/desktop-open/desktop-open-intent-navigation.ts');
for (const ownedState of [
  'setExploreActiveSection',
  'runtimeConfigNavigation.openPage',
  'dispatchSettingsOpenSection',
  'setAppsDetailAppId',
]) {
  if (!desktopNavigation.includes(ownedState)) {
    failures.push(`Desktop renderer navigation missing owner state action ${ownedState}`);
  }
}

failures.push(...requireText('apps/desktop/src-tauri/src/desktop_open_intent.rs', [
  'PRESENCE_RELATIVE_PATH',
  '"run", "desktop", "open-intent", "presence.v1.json"',
  'last_heartbeat_at',
]));
failures.push(...requireText('apps/desktop/src-tauri/src/desktop_open_intent_presence.rs', [
  '0o700',
  '0o600',
  'reject_symlink_ancestry(parent',
  'reject_symlink_if_exists(path',
  'reject_descriptor_temp_symlinks(parent, path)',
  'descriptor_temp_path(path)',
  '.create_new(true)',
  'libc::O_NOFOLLOW',
  'replace_presence_descriptor_atomically(&temp_path, path)',
]));
failures.push(...requireText('apps/desktop/src-tauri/src/desktop_open_intent_presence_tests.rs', [
  'desktop_open_presence_descriptor_replaces_existing_descriptor',
  'desktop_open_presence_descriptor_rejects_temp_symlink_before_token_write',
]));
failures.push(...requireText('kit/shell/electron/src/main/desktop-open.ts', [
  "['.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json']",
  'assertNoDescriptorSymlink',
  'descriptorPathAncestors',
  'lastHeartbeatAt',
  'desktop-open-desktop-not-running',
  'Authorization',
]));
failures.push(...requireText('kit/shell/tauri/src/standard_desktop_open.rs', [
  'assert_no_symlink_ancestry',
  'Desktop Open descriptor ancestry must not contain symlinks',
]));
const electronHost = read('kit/shell/electron/src/main/desktop-open.ts');
if (desktopBridge.includes('resolve_nimi_data_dir') || electronHost.includes('nimi_data')) {
  failures.push('Desktop Open presence descriptor must not use the product nimi_data root');
}
if (/console\.(?:log|error|warn).*token/u.test(electronHost)) {
  failures.push('Electron Desktop Open host must not log descriptor token material');
}

for (const [relPath, needles] of [
  ['docs/authority/platform-core-protocol-rationale.md', ['desktop-electron-local-app-host']],
  ['config/platform-desktop-open-intents.yaml', ['desktop-electron-local-app-host']],
  ['sdks/typescript/core/app/desktop-open.ts', ['desktop-electron-local-app-host']],
  ['apps/desktop/src-tauri/src/desktop_open_intent_parser.rs', ['desktop-electron-local-app-host']],
  ['apps/desktop/e2e/fixtures/desktop-open-test-launcher.mjs', [
    'owner.local-app-source-host',
    'desktop-electron-local-app-host',
    'local-app-standard-shell-v1',
  ]],
  ['kit/shell/electron/src/main/desktop-open.ts', [
    'NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID',
    "return 'desktop-electron-local-app-host';",
  ]],
]) {
  failures.push(...requireText(relPath, needles));
}
const standardShellCapabilities = parseYaml('config/platform-standard-shell-capabilities.yaml');
const localAppCapabilitySet = standardShellCapabilities.capability_sets?.find(
  (entry) => entry?.set_id === 'local-app-standard-shell-v1',
);
if (!localAppCapabilitySet?.allowed_operations?.includes('desktop-open.openIntent')) {
  failures.push('local-app-standard-shell-v1 does not admit desktop-open.openIntent');
}
if (localAppCapabilitySet?.planned_operations?.includes('desktop-open.openIntent')) {
  failures.push('desktop-open.openIntent remains planned after local-app admission');
}

const desktopOpenConfig = parseYaml('config/desktop-open-targets.yaml');
const desktopOpenCatalogs = desktopOpenConfig.catalogs ?? {};
const desktopTargets = desktopOpenCatalogs.desktop_open_targets;
const targetTables = {
  'open-explore': desktopOpenCatalogs.desktop_explore_open_targets,
  'open-runtime-config': desktopOpenCatalogs.desktop_runtime_config_open_actions,
  'open-agents': desktopOpenCatalogs.desktop_agents_open_targets,
  'open-apps': desktopOpenCatalogs.desktop_apps_open_targets,
  'open-settings': desktopOpenCatalogs.desktop_settings_open_targets,
};
if (!desktopTargets) {
  failures.push('desktop open config missing catalogs.desktop_open_targets');
}
for (const [kind, table] of Object.entries(targetTables)) {
  if (!table) {
    failures.push(`desktop open config missing catalog for ${kind}`);
  }
  if (!desktopTargets?.target_refs?.[kind]) {
    failures.push(`desktop open config missing target_refs.${kind}`);
  }
}
const targetEntries = Object.fromEntries(
  Object.entries(targetTables).map(([kind, table]) => [kind, new Set(table?.entries ?? [])]),
);
const goldenVectors = parseYaml('scripts/testdata/desktop-open-intent-golden-vectors.yaml');
for (const vector of goldenVectors.accepted ?? []) {
  const intent = vector.envelope?.intent ?? {};
  let key;
  if (intent.kind === 'open-explore') {
    key = intent.productIntent ? `${intent.section}.${intent.productIntent}` : intent.section;
  } else if (intent.kind === 'open-runtime-config') {
    key = `${intent.page}.${intent.action}`;
  } else if (intent.kind === 'open-agents') {
    key = intent.view;
  } else if (intent.kind === 'open-apps') {
    key = intent.appId ? 'app-selection' : 'surface';
  } else if (intent.kind === 'open-settings') {
    key = intent.section;
  }
  if (key && !targetEntries[intent.kind]?.has(key)) {
    failures.push(`${vector.id} is absent from the ${intent.kind} target catalog (${key})`);
  }
}

const desktopIndex = read('.nimi/spec/desktop/kernel/index.md');
if (!desktopIndex.includes('config/desktop-open-targets.yaml')) {
  failures.push('Desktop kernel index missing config/desktop-open-targets.yaml');
}
const platformIndex = read('.nimi/spec/platform/kernel/index.md');
if (!platformIndex.includes('desktop-open-intent-contract.md')
  || !platformIndex.includes('desktop-open-intents.yaml')) {
  failures.push('Platform kernel index missing the Desktop Open contract or intent table');
}

const ownerContracts = [
  '.nimi/spec/canonical/desktop/shell-ui.authority.yaml',
  '.nimi/spec/canonical/desktop/product-surfaces.authority.yaml',
  '.nimi/spec/canonical/desktop/bridge-ipc.authority.yaml',
].map((file) => read(file)).join('\n');
for (const phrase of ['Settings', 'Agents', 'Apps', 'Runtime Config', 'Explore']) {
  if (!ownerContracts.includes(phrase)) {
    failures.push(`Desktop owner contracts missing anchor phrase ${phrase}`);
  }
}

failWith('Desktop Open contract gate failed.', failures);
pass('desktop open contract gate passed');
