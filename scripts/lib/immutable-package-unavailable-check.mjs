import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const IMMUTABLE_PACKAGE_METHODS = Object.freeze([
  'PrepareAppLifecycleIntent',
  'GetAppLifecycleIntentStatus',
  'InstallApp',
  'UninstallApp',
  'GetAppInstallJob',
  'ListAppInstallJobs',
  'WatchAppInstallJobEvents',
  'UpdateApp',
  'HealthRepairApp',
]);

export const IMMUTABLE_PACKAGE_METHOD_IDS = Object.freeze(
  IMMUTABLE_PACKAGE_METHODS.map((method) => `/nimi.runtime.v1.RuntimeAppService/${method}`),
);

export const CANDIDATE_PATHS = Object.freeze({
  authPosture: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/identity-access.yaml',
  runtimeHandlers: 'runtime/internal/services/app/immutable_package_unavailable.go',
  runtimeReadiness: 'runtime/internal/services/app/package_readiness_handler.go',
  runtimeTransport: 'runtime/internal/grpcserver/immutable_package_transport.go',
  runtimePublicTransport: 'runtime/internal/grpcserver/interceptor_public_transport.go',
  runtimeDesktopTransport: 'runtime/internal/grpcserver/protected_transport.go',
  runtimeLocalAppTransport: 'runtime/internal/grpcserver/local_app_transport.go',
  kitMethodIds: 'kit/shell/tauri/src/runtime_bridge/generated/method_ids.rs',
  sdkLifecycle: 'sdks/typescript/runtime/app-lifecycle.ts',
  sdkLifecycleTypes: 'sdks/typescript/runtime/app-lifecycle-types.ts',
  sdkMethodModules: 'sdks/typescript/runtime/runtime-method-modules.ts',
  sdkRegistryTransport: 'sdks/typescript/core/app/registry-transport.ts',
  desktopAppsRoot: 'apps/desktop/src/shell/renderer/features/apps',
  desktopLegacyLifecycleBridge: 'apps/desktop/src/shell/renderer/features/apps/apps-lifecycle-bridge.ts',
});

const SDK_ACTIVE_METHODS = Object.freeze([
  'getAccountAppInventory',
  'getAppStorage',
  'getAppPackageReadiness',
]);

const SDK_BLOCKED_PACKAGE_METHODS = Object.freeze([
  'prepareAppLifecycleIntent',
  'getAppLifecycleIntentStatus',
  'installApp',
  'uninstallApp',
  'getAppInstallJob',
  'listAppInstallJobs',
  'watchAppInstallJobEvents',
  'updateApp',
  'healthRepairApp',
]);

const DESKTOP_FORBIDDEN_IDENTIFIERS = Object.freeze([
  ...SDK_BLOCKED_PACKAGE_METHODS,
  'loadActiveJobs',
  'listJobs',
  'watchJobs',
  'cancelJob',
  'retryJob',
  'runInstall',
  'runUninstall',
  'runUpdate',
  'runRepair',
]);

function issue(code, target, reason) {
  return { code, target, reason };
}

function arraysEqual(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function setEqual(actual, expected) {
  return actual.size === expected.size && [...actual].every((value) => expected.has(value));
}

function parseYaml(text, target, issues) {
  try {
    return YAML.parse(text);
  } catch (error) {
    issues.push(issue('CANDIDATE_INPUT_INVALID', target, `YAML parse failed: ${error.message}`));
    return {};
  }
}

function findBalanced(source, openingIndex, opening, closing) {
  let depth = 0;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (current === '\\') {
        index += 1;
      } else if (current === quote) {
        quote = '';
      }
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      continue;
    }
    if (current === opening) depth += 1;
    if (current === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(openingIndex, index + 1);
    }
  }
  return '';
}

function extractNamedDelimited(source, name, opening = '[', closing = ']') {
  const nameIndex = source.indexOf(name);
  if (nameIndex < 0) return '';
  const assignment = source.indexOf('=', nameIndex + name.length);
  if (assignment < 0) return '';
  const openingIndex = source.indexOf(opening, assignment + 1);
  if (openingIndex < 0) return '';
  return findBalanced(source, openingIndex, opening, closing);
}

function extractQuotedValues(source) {
  const values = [];
  const pattern = /(['"])(.*?)\1/gsu;
  for (const match of source.matchAll(pattern)) values.push(match[2]);
  return values;
}

function extractGoMethod(source, method) {
  const pattern = new RegExp(`func\\s*\\([^)]*\\*Service\\)\\s*${method}\\s*\\(`, 'u');
  const match = pattern.exec(source);
  if (!match) return { header: '', body: '' };
  const bodyStart = source.indexOf('{', match.index + match[0].length);
  if (bodyStart < 0) return { header: '', body: '' };
  return {
    header: source.slice(match.index, bodyStart),
    body: findBalanced(source, bodyStart, '{', '}'),
  };
}

function normalizedBody(body) {
  return body
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\s+/gu, '');
}

function validatePostures(files, issues) {
  const target = CANDIDATE_PATHS.authPosture;
  const table = parseYaml(files.get(target) ?? '', target, issues);
  const rows = new Map((Array.isArray(table?.methods) ? table.methods : []).map((row) => [row?.method_id, row]));
  for (const methodId of IMMUTABLE_PACKAGE_METHOD_IDS) {
    const row = rows.get(methodId);
    if (row?.posture !== 'unavailable_by_authority' || row?.transport_disposition !== 'deny_all') {
      issues.push(issue(
        'AUTH_PACKAGE_POSTURE_INVALID',
        `${target}#${methodId}`,
        `${methodId} must be unavailable_by_authority with deny_all transport disposition.`,
      ));
    }
  }
  const readiness = rows.get('/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness');
  if (readiness?.posture !== 'authenticated_required' || readiness?.transport_disposition === 'deny_all') {
    issues.push(issue(
      'AUTH_READINESS_POSTURE_INVALID',
      `${target}#/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness`,
      'GetAppPackageReadiness must remain callable only as the authenticated typed-unavailable projection.',
    ));
  }
}

function validateRuntimeHandlers(files, issues) {
  const target = CANDIDATE_PATHS.runtimeHandlers;
  const source = files.get(target) ?? '';
  for (const method of IMMUTABLE_PACKAGE_METHODS) {
    const extracted = extractGoMethod(source, method);
    if (!extracted.body) {
      issues.push(issue('RUNTIME_PACKAGE_HANDLER_SET_INVALID', `${target}#${method}`, `Missing frozen ${method} handler.`));
      continue;
    }
    const expected = method === 'WatchAppInstallJobEvents'
      ? '{returnimmutablePackageUnavailable()}'
      : '{returnnil,immutablePackageUnavailable()}'
    if (normalizedBody(extracted.body) !== expected) {
      issues.push(issue(
        'RUNTIME_PACKAGE_HANDLER_BEHAVIOR_INVALID',
        `${target}#${method}`,
        `${method} must return the common immutable-package typed-unavailable result before parsing a target.`,
      ));
    }
  }
  const helper = source.match(/func\s+immutablePackageUnavailable\s*\(\s*\)\s*error\s*\{([\s\S]*?)\n\}/u)?.[1] ?? '';
  if (!/grpcerr\.WithReasonCode\(codes\.Unimplemented,\s*runtimev1\.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE\)/u.test(helper)) {
    issues.push(issue(
      'RUNTIME_PACKAGE_ERROR_INVALID',
      `${target}#immutablePackageUnavailable`,
      'Common immutable-package failure must be Unimplemented/LOCAL_APP_OPERATION_UNAVAILABLE.',
    ));
  }
}

function validateRuntimeReadiness(files, issues) {
  const target = CANDIDATE_PATHS.runtimeReadiness;
  const source = files.get(target) ?? '';
  const extracted = extractGoMethod(source, 'GetAppPackageReadiness');
  if (!extracted.body) {
    issues.push(issue('RUNTIME_READINESS_PROJECTION_INVALID', target, 'GetAppPackageReadiness handler is missing.'));
    return;
  }
  if (!/context\.Context\s*,\s*\*runtimev1\.GetAppPackageReadinessRequest\s*\)/u.test(extracted.header)) {
    issues.push(issue(
      'RUNTIME_READINESS_SELECTOR_INVALID',
      `${target}#GetAppPackageReadiness`,
      'The 0K readiness handler must not bind or consume a caller-selected request target.',
    ));
  }
  const body = extracted.body;
  const required = [
    /State:\s*runtimev1\.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_BLOCKED/u,
    /ReasonCode:\s*runtimev1\.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE/u,
    /Detail:\s*immutableProfileUnavailableDetail/u,
  ];
  if (required.some((pattern) => !pattern.test(body))) {
    issues.push(issue(
      'RUNTIME_READINESS_PROJECTION_INVALID',
      `${target}#GetAppPackageReadiness`,
      'Readiness must return blocked/LOCAL_APP_OPERATION_UNAVAILABLE/immutable_profile_unavailable.',
    ));
  }
  const sensitiveAssignments = [
    'AppId',
    'ReleaseDescriptorRef',
    'StoragePolicyRef',
    'ExpectedVersion',
    'ActiveVersion',
    'InstalledVersion',
    'Sha256',
    'VerificationState',
  ].filter((field) => new RegExp(`\\b${field}\\s*:`, 'u').test(body));
  if (sensitiveAssignments.length > 0) {
    issues.push(issue(
      'RUNTIME_READINESS_TRUTH_LEAK',
      `${target}#GetAppPackageReadiness`,
      `Readiness populated forbidden package truth: ${sensitiveAssignments.join(', ')}.`,
    ));
  }
}

function validateRuntimeTransports(files, issues) {
  const target = CANDIDATE_PATHS.runtimeTransport;
  const source = files.get(target) ?? '';
  const denySetStart = source.indexOf('var immutablePackageDenyAllMethods');
  const denySetEnd = denySetStart < 0 ? -1 : source.indexOf('\nfunc immutablePackageTransportDenied', denySetStart);
  const denySetSource = denySetStart < 0 || denySetEnd < 0 ? '' : source.slice(denySetStart, denySetEnd);
  const denied = new Set(extractQuotedValues(denySetSource));
  const expected = new Set(IMMUTABLE_PACKAGE_METHOD_IDS);
  if (!setEqual(denied, expected)) {
    issues.push(issue(
      'RUNTIME_TRANSPORT_DENY_SET_INVALID',
      `${target}#immutablePackageDenyAllMethods`,
      `Deny-all set must contain exactly the ${expected.size} frozen positive package methods.`,
    ));
  }
  if (!/codes\.Unimplemented[\s\S]*ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE/u.test(source)) {
    issues.push(issue(
      'RUNTIME_TRANSPORT_ERROR_INVALID',
      `${target}#immutablePackageTransportUnavailable`,
      'Every transport must use the common Unimplemented/LOCAL_APP_OPERATION_UNAVAILABLE result.',
    ));
  }
  for (const transportPath of [
    CANDIDATE_PATHS.runtimePublicTransport,
    CANDIDATE_PATHS.runtimeDesktopTransport,
    CANDIDATE_PATHS.runtimeLocalAppTransport,
  ]) {
    const transport = files.get(transportPath) ?? '';
    const checks = transport.match(/immutablePackageTransportDenied\s*\(/gu)?.length ?? 0;
    const failures = transport.match(/immutablePackageTransportUnavailable\s*\(/gu)?.length ?? 0;
    if (checks < 2 || failures < 2) {
      issues.push(issue(
        'RUNTIME_TRANSPORT_WIRING_INVALID',
        transportPath,
        'Unary and stream interceptors must reject the immutable package deny-all set before handler dispatch.',
      ));
    }
  }
}

function validateKit(files, issues) {
  const target = CANDIDATE_PATHS.kitMethodIds;
  const source = files.get(target) ?? '';
  const allowlist = new Set(extractQuotedValues(extractNamedDelimited(source, 'RUNTIME_BRIDGE_ALLOWLISTED_METHODS')));
  const exposed = IMMUTABLE_PACKAGE_METHOD_IDS.filter((methodId) => allowlist.has(methodId));
  if (exposed.length > 0) {
    issues.push(issue(
      'KIT_GENERIC_BRIDGE_PACKAGE_EXPOSURE',
      `${target}#RUNTIME_BRIDGE_ALLOWLISTED_METHODS`,
      `Generic Kit bridge exposed unavailable package methods: ${exposed.join(', ')}.`,
    ));
  }
  if (!allowlist.has('/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness')) {
    issues.push(issue(
      'KIT_GENERIC_BRIDGE_READINESS_MISSING',
      `${target}#RUNTIME_BRIDGE_ALLOWLISTED_METHODS`,
      'Kit must preserve the authenticated typed-unavailable readiness projection.',
    ));
  }
}

function extractInterfaceBody(source, name) {
  const match = new RegExp(`export\\s+interface\\s+${name}\\s*\\{`, 'u').exec(source);
  if (!match) return '';
  const opening = source.indexOf('{', match.index);
  return findBalanced(source, opening, '{', '}');
}

function interfaceMethodNames(body) {
  return [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(/gmu)].map((match) => match[1]);
}

function validateSdk(files, issues) {
  const methodsTarget = CANDIDATE_PATHS.sdkMethodModules;
  const methodsSource = files.get(methodsTarget) ?? '';
  const active = extractQuotedValues(extractNamedDelimited(methodsSource, 'RUNTIME_APP_LIFECYCLE_METHODS'));
  if (!arraysEqual(active, SDK_ACTIVE_METHODS)) {
    issues.push(issue(
      'SDK_LIFECYCLE_ACTIVE_SURFACE_INVALID',
      `${methodsTarget}#RUNTIME_APP_LIFECYCLE_METHODS`,
      `Active lifecycle module must be exactly ${SDK_ACTIVE_METHODS.join(', ')}.`,
    ));
  }
  const blockedDeclaration = methodsSource.match(/(?:^|\n)const\s+RUNTIME_BLOCKED_APP_LIFECYCLE_METHODS\s*=/u);
  const blocked = new Set(extractQuotedValues(extractNamedDelimited(methodsSource, 'RUNTIME_BLOCKED_APP_LIFECYCLE_METHODS')));
  if (!blockedDeclaration || SDK_BLOCKED_PACKAGE_METHODS.some((method) => !blocked.has(method))) {
    issues.push(issue(
      'SDK_LIFECYCLE_BLOCKED_SURFACE_INVALID',
      `${methodsTarget}#RUNTIME_BLOCKED_APP_LIFECYCLE_METHODS`,
      'Frozen generated package methods must remain private and blocked, never active high-level exports.',
    ));
  }

  const typesTarget = CANDIDATE_PATHS.sdkLifecycleTypes;
  const typesSource = files.get(typesTarget) ?? '';
  const clientBody = extractInterfaceBody(typesSource, 'NimiRuntimeAppLifecycleClient');
  const generatedBody = extractInterfaceBody(typesSource, 'NimiRuntimeAppLifecycleGeneratedClient');
  if (!arraysEqual(interfaceMethodNames(clientBody), ['accountInventory', 'storage', 'packageReadiness']) ||
      !arraysEqual(interfaceMethodNames(generatedBody), SDK_ACTIVE_METHODS)) {
    issues.push(issue(
      'SDK_LIFECYCLE_PUBLIC_CLIENT_INVALID',
      typesTarget,
      'SDK lifecycle clients must expose only account inventory, storage, and selector-free readiness.',
    ));
  }
  if (!/packageReadiness\s*\(\s*options\??\s*:\s*RuntimeTypedCallOptions\s*\)/u.test(clientBody)) {
    issues.push(issue(
      'SDK_PACKAGE_READINESS_SELECTOR_INVALID',
      `${typesTarget}#NimiRuntimeAppLifecycleClient.packageReadiness`,
      'Public packageReadiness accepts call options only and no app/path/source selector.',
    ));
  }
  const projectionBody = typesSource.match(/export\s+type\s+NimiRuntimeAppPackageReadinessProjection\s*=\s*\{([\s\S]*?)\n\};/u)?.[1] ?? '';
  if (!/readonly\s+state:\s*'unavailable'/u.test(projectionBody) ||
      !/readonly\s+reasonCode:\s*string/u.test(projectionBody) ||
      /\b(appId|releaseDescriptorRef|storagePolicyRef|expectedVersion|activeVersion|installedVersion|sha256|verificationState|path|evidence|jobId)\b/u.test(projectionBody)) {
    issues.push(issue(
      'SDK_PACKAGE_READINESS_TRUTH_LEAK',
      `${typesTarget}#NimiRuntimeAppPackageReadinessProjection`,
      'SDK readiness projection must be typed unavailable and carry no package selector or materialization truth.',
    ));
  }

  const lifecycleTarget = CANDIDATE_PATHS.sdkLifecycle;
  const lifecycleSource = files.get(lifecycleTarget) ?? '';
  if (!/async\s+packageReadiness\s*\(\s*options\s*\)[\s\S]*getAppPackageReadiness\(\s*\{\s*appId:\s*''\s*\}\s*,\s*options\s*\)/u.test(lifecycleSource)) {
    issues.push(issue(
      'SDK_PACKAGE_READINESS_SELECTOR_INVALID',
      `${lifecycleTarget}#packageReadiness`,
      'SDK must invoke the frozen wire with an empty reserved selector and expose no selector input.',
    ));
  }

  const registryTarget = CANDIDATE_PATHS.sdkRegistryTransport;
  const registrySource = files.get(registryTarget) ?? '';
  const callbackShape = /readonly\s+loadPackageReadiness\??:\s*\(\s*\)\s*=>/u.test(registrySource);
  if (!callbackShape || /loadPackageReadiness\??:\s*\([^)]*(app|path|source|descriptor)/iu.test(registrySource)) {
    issues.push(issue(
      'SDK_PACKAGE_READINESS_SELECTOR_INVALID',
      `${registryTarget}#loadPackageReadiness`,
      'Registry composition may consume only one global selector-free typed-unavailable readiness projection.',
    ));
  }
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
}

function validateDesktop(files, issues) {
  const desktopEntries = [...files.entries()].filter(([relative]) => relative.startsWith(`${CANDIDATE_PATHS.desktopAppsRoot}/`));
  if (desktopEntries.length === 0) {
    issues.push(issue('DESKTOP_APPS_SURFACE_MISSING', CANDIDATE_PATHS.desktopAppsRoot, 'Desktop Apps renderer sources are missing.'));
    return;
  }
  for (const [relative, raw] of desktopEntries) {
    const source = stripComments(raw);
    const identifiers = DESKTOP_FORBIDDEN_IDENTIFIERS.filter((identifier) => new RegExp(`\\b${identifier}\\b`, 'u').test(source));
    if (identifiers.length > 0) {
      issues.push(issue(
        'DESKTOP_PACKAGE_LIFECYCLE_SURFACE_PRESENT',
        relative,
        `Desktop Apps renderer retains positive package lifecycle identifiers: ${identifiers.join(', ')}.`,
      ));
    }
  }
  if ((files.get(CANDIDATE_PATHS.desktopLegacyLifecycleBridge) ?? '').trim()) {
    issues.push(issue(
      'DESKTOP_PACKAGE_LIFECYCLE_SURFACE_PRESENT',
      CANDIDATE_PATHS.desktopLegacyLifecycleBridge,
      'The retired Desktop Apps lifecycle bridge must remain absent.',
    ));
  }
  const actionsPath = `${CANDIDATE_PATHS.desktopAppsRoot}/apps-card-actions.ts`;
  const actionsSource = stripComments(files.get(actionsPath) ?? '');
  if (!/export\s+type\s+AppCardActionId\s*=\s*'sign_in'\s*\|\s*'details'\s*;/u.test(actionsSource)) {
    issues.push(issue(
      'DESKTOP_CARD_ACTION_SET_INVALID',
      actionsPath,
      'The 0K Desktop Apps action set must be exactly sign_in | details.',
    ));
  }
  if (/(['"])open\1/u.test(actionsSource) || /\bopenApp\b/u.test(actionsSource)) {
    issues.push(issue(
      'DESKTOP_PACKAGE_OPEN_ACTION_PRESENT',
      actionsPath,
      'Desktop Apps inventory must not expose a positive package/open action; local development launches through Developer Mode.',
    ));
  }
}

export function validateImmutablePackageCandidate(files) {
  const issues = [];
  validatePostures(files, issues);
  validateRuntimeHandlers(files, issues);
  validateRuntimeReadiness(files, issues);
  validateRuntimeTransports(files, issues);
  validateKit(files, issues);
  validateSdk(files, issues);
  validateDesktop(files, issues);
  return issues;
}

function listDesktopSources(root) {
  const absolute = path.join(root, CANDIDATE_PATHS.desktopAppsRoot);
  if (!fs.existsSync(absolute)) return [];
  const sources = [];
  const visit = (directory, relativeDirectory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path.join(directory, entry.name), relative);
      } else if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) {
        sources.push(relative);
      }
    }
  };
  visit(absolute, CANDIDATE_PATHS.desktopAppsRoot);
  return sources.sort();
}

export function loadImmutablePackageCandidate(root) {
  const files = new Map();
  for (const relative of [
    CANDIDATE_PATHS.authPosture,
    CANDIDATE_PATHS.runtimeHandlers,
    CANDIDATE_PATHS.runtimeReadiness,
    CANDIDATE_PATHS.runtimeTransport,
    CANDIDATE_PATHS.runtimePublicTransport,
    CANDIDATE_PATHS.runtimeDesktopTransport,
    CANDIDATE_PATHS.runtimeLocalAppTransport,
    CANDIDATE_PATHS.kitMethodIds,
    CANDIDATE_PATHS.sdkLifecycle,
    CANDIDATE_PATHS.sdkLifecycleTypes,
    CANDIDATE_PATHS.sdkMethodModules,
    CANDIDATE_PATHS.sdkRegistryTransport,
    CANDIDATE_PATHS.desktopLegacyLifecycleBridge,
    ...listDesktopSources(root),
  ]) {
    const absolute = path.join(root, relative);
    files.set(relative, fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '');
  }
  return files;
}

function replaceExact(files, relative, from, to) {
  const source = files.get(relative) ?? '';
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`negative fixture marker missing in ${relative}: ${from}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`negative fixture marker is not unique in ${relative}: ${from}`);
  }
  files.set(relative, `${source.slice(0, first)}${to}${source.slice(first + from.length)}`);
}

export const NEGATIVE_FIXTURES = Object.freeze([
  {
    fixtureId: 'install-posture-authorized',
    expectedCode: 'AUTH_PACKAGE_POSTURE_INVALID',
    mutate(files) {
      replaceExact(
        files,
        CANDIDATE_PATHS.authPosture,
        '  - method_id: /nimi.runtime.v1.RuntimeAppService/InstallApp\n    posture: unavailable_by_authority\n    transport_disposition: deny_all',
        '  - method_id: /nimi.runtime.v1.RuntimeAppService/InstallApp\n    posture: authenticated_required\n    transport_disposition: allow',
      );
    },
  },
  {
    fixtureId: 'install-handler-positive',
    expectedCode: 'RUNTIME_PACKAGE_HANDLER_BEHAVIOR_INVALID',
    mutate(files) {
      replaceExact(
        files,
        CANDIDATE_PATHS.runtimeHandlers,
        'return nil, immutablePackageUnavailable()\n}\n\nfunc (s *Service) UninstallApp',
        'return &runtimev1.InstallAppResponse{}, nil\n}\n\nfunc (s *Service) UninstallApp',
      );
    },
  },
  {
    fixtureId: 'readiness-selects-request',
    expectedCode: 'RUNTIME_READINESS_SELECTOR_INVALID',
    mutate(files) {
      replaceExact(
        files,
        CANDIDATE_PATHS.runtimeReadiness,
        'context.Context, *runtimev1.GetAppPackageReadinessRequest)',
        'context.Context, request *runtimev1.GetAppPackageReadinessRequest)',
      );
    },
  },
  {
    fixtureId: 'readiness-leaks-version',
    expectedCode: 'RUNTIME_READINESS_TRUTH_LEAK',
    mutate(files) {
      replaceExact(
        files,
        CANDIDATE_PATHS.runtimeReadiness,
        'Detail:     immutableProfileUnavailableDetail,',
        'Detail:     immutableProfileUnavailableDetail,\n\t\t\tActiveVersion: "1.0.0",',
      );
    },
  },
  {
    fixtureId: 'desktop-transport-bypasses-deny-all',
    expectedCode: 'RUNTIME_TRANSPORT_WIRING_INVALID',
    mutate(files) {
      const target = CANDIDATE_PATHS.runtimeDesktopTransport;
      const source = files.get(target) ?? '';
      const changed = source.replace(/\n\s*if immutablePackageTransportDenied\(info\.FullMethod\) \{\n\s*return (?:nil, )?immutablePackageTransportUnavailable\(\)\n\s*\}/gu, '');
      if (changed === source) throw new Error(`negative fixture marker missing in ${target}`);
      files.set(target, changed);
    },
  },
  {
    fixtureId: 'kit-exposes-install',
    expectedCode: 'KIT_GENERIC_BRIDGE_PACKAGE_EXPOSURE',
    mutate(files) {
      replaceExact(
        files,
        CANDIDATE_PATHS.kitMethodIds,
        '    "/nimi.runtime.v1.RuntimeAppService/GetAccountAppInventory",',
        '    "/nimi.runtime.v1.RuntimeAppService/GetAccountAppInventory",\n    "/nimi.runtime.v1.RuntimeAppService/InstallApp",',
      );
    },
  },
  {
    fixtureId: 'sdk-activates-install',
    expectedCode: 'SDK_LIFECYCLE_ACTIVE_SURFACE_INVALID',
    mutate(files) {
      replaceExact(
        files,
        CANDIDATE_PATHS.sdkMethodModules,
        "  'getAppPackageReadiness',\n] as const",
        "  'getAppPackageReadiness',\n  'installApp',\n] as const",
      );
    },
  },
  {
    fixtureId: 'sdk-readiness-accepts-app-selector',
    expectedCode: 'SDK_PACKAGE_READINESS_SELECTOR_INVALID',
    mutate(files) {
      replaceExact(
        files,
        CANDIDATE_PATHS.sdkLifecycleTypes,
        'packageReadiness(options?: RuntimeTypedCallOptions)',
        'packageReadiness(appId: string, options?: RuntimeTypedCallOptions)',
      );
    },
  },
  {
    fixtureId: 'desktop-restores-install-action',
    expectedCode: 'DESKTOP_PACKAGE_LIFECYCLE_SURFACE_PRESENT',
    mutate(files) {
      const target = `${CANDIDATE_PATHS.desktopAppsRoot}/apps-card-actions.ts`;
      const source = files.get(target) ?? '';
      files.set(target, `${source}\nexport const runInstall = () => undefined;\n`);
    },
  },
  {
    fixtureId: 'desktop-restores-open-action',
    expectedCode: 'DESKTOP_PACKAGE_OPEN_ACTION_PRESENT',
    mutate(files) {
      const target = `${CANDIDATE_PATHS.desktopAppsRoot}/apps-card-actions.ts`;
      const source = files.get(target) ?? '';
      files.set(target, `${source}\nexport const fixtureAction = 'open';\n`);
    },
  },
]);

export function runImmutablePackageNegativeFixtures(baseline) {
  return NEGATIVE_FIXTURES.map((fixture) => {
    const files = new Map(baseline);
    fixture.mutate(files);
    const issues = validateImmutablePackageCandidate(files);
    const matching = issues.filter((item) => item.code === fixture.expectedCode);
    if (matching.length !== 1) {
      throw new Error(
        `negative fixture ${fixture.fixtureId} expected one ${fixture.expectedCode}, received ${JSON.stringify(issues)}`,
      );
    }
    return {
      fixtureId: fixture.fixtureId,
      code: matching[0].code,
      reason: matching[0].reason,
      issueCount: issues.length,
    };
  });
}
