#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs', '.go', '.json', '.md']);
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'generated',
  'gen',
  'node_modules',
  'target',
]);

const LOCAL_FIRST_PARTY_DESKTOP_ROOTS = [
  'apps/desktop/src/',
  'apps/desktop/test/',
];

// NON_ADMITTED_LOCAL_APP_SLICE_ROOTS: closed set of local-first-party Tauri
// apps that have NOT yet been admitted as RuntimeAccountService consumers.
// Each must declare its non-admitted state by carrying NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER
// in its app-shell contract; missing marker is a governance violation.
//
// Apps are removed from this set as part of their D-Wave admission migration
// (alongside the spec-level admission rules that replace the fence text).
// When this set is empty, all in-tree local app slices have been migrated
// and the named arrays remain only as future-proofing for new entrants.
export const NON_ADMITTED_LOCAL_APP_SLICE_ROOTS = [];

export const NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER = 'ACCOUNT_HARDCUT_NON_ADMITTED_APP_SLICE_FENCE';

export const NON_ADMITTED_LOCAL_APP_SLICE_FENCE_SPECS = new Map([]);

const LOCAL_FIRST_PARTY_APP_OWNED_INPUTS = [
  'accessToken',
  'accessTokenProvider',
  'refreshTokenProvider',
  'subjectUserIdProvider',
  'sessionStore',
];

const AVATAR_FORBIDDEN_PATTERNS = [
  { label: 'shared auth IPC', pattern: /\bauth_session_(?:load|save|clear)\b/g },
  { label: 'Runtime account session event subscription', pattern: /\bSubscribeAccountSessionEvents\b|\bsubscribeAccountSessionEvents\s*\(/g },
  { label: 'Runtime scoped binding issue', pattern: /\bIssueScopedAppBinding\b|\bissueScopedAppBinding\s*\(/g },
  { label: 'Runtime login begin', pattern: /\bBeginLogin\b|\bbeginLogin\s*\(/g },
  { label: 'Runtime login complete', pattern: /\bCompleteLogin\b|\bcompleteLogin\s*\(/g },
  { label: 'Runtime auth register app', pattern: /\bRegisterApp\b|\bregisterApp\s*\(/g },
  { label: 'Runtime auth open session', pattern: /\bOpenSession\b|\bopenSession\s*\(/g },
  { label: 'Realm current user authority', pattern: /\bMeService\.getMe\b|\bgetMe\s*\(/g },
  { label: 'Realm auth/client authority', pattern: /\bRealmAuthService\b|\bnew\s+Realm\s*\(|\bcreateRealmClient\s*\(/g },
  { label: 'Desktop-launched Avatar account caller mode', pattern: /\bDESKTOP_LAUNCHED_AVATAR\b/g },
  { label: 'Avatar default binding-only failure', pattern: /\bscoped_binding_unavailable\b|\bscoped binding is\b/gi },
  { label: 'Avatar app-owned access token provider', pattern: /\baccessTokenProvider\b/g },
  { label: 'Avatar refresh-token custody', pattern: /\brefreshTokenProvider\b|\brefreshToken\b|\brefresh_token\b/g },
  { label: 'Avatar subject provider', pattern: /\bsubjectUserIdProvider\b/g },
  { label: 'Avatar raw JWT custody', pattern: /\brawJwt\b|\braw_jwt\b/g },
];

const DESKTOP_AVATAR_LAUNCH_FORBIDDEN_FIELDS = [
  'avatarPackage',
  'avatarPackageKind',
  'avatarPackageId',
  'avatarPackageRef',
  'avatarPackageSchemaVersion',
  'avatarAsset',
  'avatarAssetKind',
  'avatarAssetId',
  'avatarAssetSchemaVersion',
  'localAvatarAssetRef',
  'backendCapabilityProfileRef',
  'materializationRef',
  'localMaterializationRef',
  'conversationAnchorId',
  'anchorMode',
  'runtimeAppId',
  'worldId',
  'scopedBinding',
  'bindingId',
  'bindingHandle',
  'bindingScopes',
  'bindingState',
  'bindingReasonCode',
  'bindingAppInstanceId',
  'bindingWindowId',
  'accountId',
  'agentCenterAccountId',
  'userId',
  'subjectUserId',
  'realmBaseUrl',
  'realmUrl',
  'accessToken',
  'accountAccessToken',
  'refreshToken',
  'jwt',
];

export const AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS = [
  'avatar_package',
  'avatar_package_kind',
  'avatar_package_id',
  'avatar_package_ref',
  'avatar_package_schema_version',
  'avatar_asset',
  'avatar_asset_kind',
  'avatar_asset_id',
  'avatar_asset_schema_version',
  'local_avatar_asset_ref',
  'backend_capability_profile_ref',
  'materialization_ref',
  'local_materialization_ref',
  'conversation_anchor_id',
  'anchor_mode',
  'runtime_app_id',
  'world_id',
  'scoped_binding',
  'binding_id',
  'binding_handle',
  'binding_app_instance_id',
  'binding_window_id',
  'binding_scopes',
  'binding_state',
  'binding_reason_code',
  'agent_center_account_id',
  'account_id',
  'user_id',
  'subject_user_id',
  'realm_base_url',
  'realm_url',
  'access_token',
  'account_access_token',
  'refresh_token',
  'jwt',
  'raw_jwt',
  'shared_auth',
  'login_route',
];

const AVATAR_CAPABILITY_FORBIDDEN = [
  /auth_session_/,
  /runtime\.account\./,
  /subscribeAccountSessionEvents/,
  /runtime\.auth\./,
  /\.nimi\/auth/,
  /RegisterApp/,
  /OpenSession/,
  /GetAccessToken/,
  /AccountProjection/,
  /IssueScopedAppBinding/,
  /BeginLogin/,
  /CompleteLogin/,
];

const RUNTIME_ACCOUNT_FORBIDDEN_PATTERNS = [
  { label: 'Desktop shared auth import/read', pattern: /\bauth_session_(?:load|save|clear)\b|\bshared_auth\b|\bsharedAuth\b/g },
  { label: 'caller subject as account truth', pattern: /\bsubject_user_id\b/g },
];

// NOTE: the legacy LOCAL_APP_SLICE_AUTH_DRIFT_PATTERNS source-text scan has
// been retired. After the runtime-account migration (Waves A-D), token-custody
// drift for admitted apps is enforced by scanPlatformClientConstruction (which
// covers both `createPlatformClient` and `createLocalFirstPartyRuntimePlatformClient`
// constructions across all walked roots) and by per-app static source-text
// locks in each app's bootstrap/auth-adapter test. The broad accessToken /
// subjectUserId pattern scan over-matched legitimate post-migration code
// (e.g. `auth.user?.id` projections) and was redundant with the construction
// scanner.

function toPosix(input) {
  return input.split(path.sep).join('/');
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function isTestPath(relPath) {
  return /(?:^|\/)(?:test|tests|__tests__)\//.test(relPath)
    || /\.(?:test|spec)\.[^.]+$/.test(relPath)
    || relPath.endsWith('_test.go')
    || relPath.endsWith('_test.rs');
}

function shouldSkipDir(name) {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

function walkFiles(root, output = []) {
  if (!existsSync(root)) {
    return output;
  }
  const entry = statSync(root);
  if (entry.isDirectory()) {
    for (const name of readdirSync(root)) {
      if (shouldSkipDir(name)) {
        continue;
      }
      walkFiles(path.join(root, name), output);
    }
    return output;
  }
  if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(root))) {
    output.push(root);
  }
  return output;
}

function collectRepoFiles() {
  const roots = [
    'sdk/src',
    'sdk/test',
    'apps/desktop/src',
    'apps/desktop/test',
    'apps/web/src',
    'apps/avatar/src',
    'apps/avatar/src-tauri',
    'apps/shiji/src',
    'apps/shiji/src-tauri',
    'apps/shiji/spec/kernel',
    'apps/moment/src',
    'apps/moment/src-tauri',
    'apps/moment/spec/kernel',
    'apps/polyinfo/src',
    'apps/polyinfo/src-tauri',
    'apps/polyinfo/spec/kernel',
    'apps/parentos/src',
    'apps/parentos/src-tauri',
    'apps/parentos/spec/kernel',
    // FG-SHELL-011 / FG-SHELL-012: Forge is admitted as a local-first-party
    // Runtime account consumer. Walked here so scanPlatformClientConstruction
    // and scanJwtSubjectAuthority detect regressions in forge sources.
    // Forge intentionally does NOT appear in LOCAL_APP_SLICE_ROOTS — it is
    // admitted, not fenced.
    'apps/forge/src',
    'apps/forge/spec/kernel',
    // LD-SHELL-010 / LD-SHELL-011: Lookdev is admitted as a local-first-party
    // Runtime account consumer. Walked here so scanPlatformClientConstruction
    // and scanJwtSubjectAuthority detect regressions in lookdev sources.
    // Lookdev intentionally does NOT appear in NON_ADMITTED_LOCAL_APP_SLICE_ROOTS
    // — it is admitted, not fenced.
    'apps/lookdev/src',
    'apps/lookdev/spec/kernel',
    // RD-SHELL-009 / RD-SHELL-010: Realm Drift is admitted as a
    // local-first-party Runtime account consumer. Walked here so
    // scanPlatformClientConstruction and scanJwtSubjectAuthority detect
    // regressions in realm-drift sources. Realm Drift intentionally does NOT
    // appear in NON_ADMITTED_LOCAL_APP_SLICE_ROOTS; it is admitted, not
    // fenced.
    'apps/realm-drift/src',
    'apps/realm-drift/src-tauri',
    'apps/realm-drift/spec/kernel',
    // SJ-SHELL-010 / SJ-SHELL-011: ShiJi is admitted as a local-first-party
    // Runtime account consumer. Walked here for the same reason as forge /
    // lookdev. ShiJi intentionally does NOT appear in
    // NON_ADMITTED_LOCAL_APP_SLICE_ROOTS — it is admitted, not fenced.
    // Existing roots above (shiji/src, shiji/src-tauri, shiji/spec/kernel)
    // are retained — they were previously walked while shiji was non-admitted.
    // Overtone admitted as a local-first-party Runtime account consumer
    // (apps/overtone/spec/architecture.md §"Auth & Runtime Account").
    // Walked here so scanPlatformClientConstruction and
    // scanJwtSubjectAuthority detect regressions in overtone sources.
    // Overtone uses prose-only spec (Option A) — no kernel/, fact tables
    // live at apps/overtone/spec/tables/.
    'apps/overtone/src',
    'apps/overtone/src-tauri',
    'apps/overtone/spec',
    'runtime/internal/services/account',
    'runtime/internal/grpcserver',
  ];
  return roots.flatMap((root) => walkFiles(path.join(repoRoot, root))).map((absPath) => ({
    relPath: toPosix(path.relative(repoRoot, absPath)),
    source: readFileSync(absPath, 'utf8'),
  }));
}

function findCallBlocks(source, calleeName) {
	const blocks = [];
  let searchIndex = 0;
  const needle = `${calleeName}(`;
  while (searchIndex < source.length) {
    const start = source.indexOf(needle, searchIndex);
    if (start < 0) {
      break;
    }
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = start + calleeName.length; index < source.length; index += 1) {
      const char = source[index] || '';
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = '';
        }
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          blocks.push({ start, end: index + 1, text: source.slice(start, index + 1) });
          searchIndex = index + 1;
          break;
        }
      }
    }
    if (searchIndex <= start) {
      searchIndex = start + needle.length;
    }
  }
	return blocks;
}

function findGoServiceMethod(source, methodName) {
  const signature = new RegExp(`func \\(s \\*Service\\) ${methodName}\\b`, 'u');
  const match = signature.exec(source);
  if (!match) {
    return null;
  }
  const braceStart = source.indexOf('{', match.index);
  if (braceStart < 0) {
    return { start: match.index, text: source.slice(match.index) };
  }
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start: match.index, text: source.slice(match.index, index + 1) };
      }
    }
  }
  return { start: match.index, text: source.slice(match.index) };
}

function firstIndexOfAny(source, needles) {
  let first = -1;
  for (const needle of needles) {
    const index = source.indexOf(needle);
    if (index >= 0 && (first < 0 || index < first)) {
      first = index;
    }
  }
  return first;
}

function hasAuthMode(block, mode) {
	const modePattern = new RegExp(`\\bauthMode\\s*:\\s*['"]${mode}['"]`);
	return modePattern.test(block);
}

function hasForbiddenInput(block, fieldName) {
  return new RegExp(`\\b${fieldName}\\s*:`).test(block);
}

function isDesktopLocalFirstPartyPath(relPath) {
  return LOCAL_FIRST_PARTY_DESKTOP_ROOTS.some((root) => relPath.startsWith(root));
}

function nonAdmittedLocalAppSliceRoot(relPath) {
  return NON_ADMITTED_LOCAL_APP_SLICE_ROOTS.find((root) => relPath.startsWith(root)) || null;
}

function isExplicitlyFencedProviderMode(block) {
  return hasAuthMode(block, 'web-cloud') || hasAuthMode(block, 'external-principal');
}

function pushViolation(violations, relPath, source, index, label, detail) {
  violations.push(`${relPath}:${lineNumber(source, index)} ${label}: ${detail}`);
}

function scanPlatformClientConstruction(files, violations) {
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.relPath)) {
      continue;
    }
    for (const block of findCallBlocks(file.source, 'createPlatformClient')) {
      if (file.relPath === 'sdk/test/platform-client.test.ts' && hasAuthMode(block.text, 'local-first-party-runtime')) {
        continue;
      }
      const localMode = hasAuthMode(block.text, 'local-first-party-runtime');
      const desktopImplicitLocal = isDesktopLocalFirstPartyPath(file.relPath) && !isExplicitlyFencedProviderMode(block.text);
      if (!localMode && !desktopImplicitLocal) {
        continue;
      }
      for (const field of LOCAL_FIRST_PARTY_APP_OWNED_INPUTS) {
        if (hasForbiddenInput(block.text, field)) {
          pushViolation(
            violations,
            file.relPath,
            file.source,
            block.start + block.text.indexOf(field),
            'local first-party app-owned auth seam',
            `${field} is forbidden unless the construction is explicitly web-cloud or external-principal`,
          );
        }
      }
    }
    for (const block of findCallBlocks(file.source, 'createLocalFirstPartyRuntimePlatformClient')) {
      for (const field of LOCAL_FIRST_PARTY_APP_OWNED_INPUTS) {
        if (hasForbiddenInput(block.text, field)) {
          pushViolation(
            violations,
            file.relPath,
            file.source,
            block.start + block.text.indexOf(field),
            'local first-party wrapper auth seam',
            `${field} is forbidden on createLocalFirstPartyRuntimePlatformClient`,
          );
        }
      }
    }
  }
}

function scanJwtSubjectAuthority(files, violations) {
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.relPath)) {
      continue;
    }
    const matches = file.source.matchAll(/\bdecodeJwtSubject\b/g);
    for (const match of matches) {
      if (
        file.relPath === 'sdk/src/platform-client.ts'
        || file.relPath.startsWith('scripts/')
        || isTestPath(file.relPath)
      ) {
        continue;
      }
      pushViolation(
        violations,
        file.relPath,
        file.source,
        match.index || 0,
        'JWT subject authority',
        'JWT subject decoding is not local first-party account truth',
      );
    }
  }
}

function scanDesktopSharedAuthOwner(files, violations) {
  for (const file of files) {
    if (!file.relPath.startsWith('apps/desktop/src/') && !file.relPath.startsWith('kit/shell/tauri/src/')) {
      continue;
    }
    if (isTestPath(file.relPath)) {
      continue;
    }
    const allowedDisabledWrappers = new Set([
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/auth-session.ts',
      'apps/desktop/src/shell/renderer/features/auth/shared-auth-session.ts',
      'apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-auth.ts',
    ]);
    if (allowedDisabledWrappers.has(file.relPath)) {
      continue;
    }
    const pattern = /\bauth_session_(?:load|save|clear)\b|\bloadResolvedSharedDesktopBootstrapAuthSession\b|\bpersistSharedDesktopSession\b|\bdesktopBridge\.loadAuthSession\b|\bdesktopBridge\.saveAuthSession\b|\bdesktopBridge\.clearAuthSession\b/g;
    for (const match of file.source.matchAll(pattern)) {
      pushViolation(
        violations,
        file.relPath,
        file.source,
        match.index || 0,
        'Desktop shared auth owner path',
        'Desktop shared auth load/save/clear must not be active local account truth',
      );
    }
  }
}

function scanAvatarBoundary(files, violations) {
  for (const file of files) {
    if (!file.relPath.startsWith('apps/avatar/')) {
      continue;
    }
    if (file.relPath.split('/')[0] === 'apps' && file.relPath.split('/')[1] === 'avatar' && file.relPath.split('/')[2] === 'spec') {
      continue;
    }
    if (isTestPath(file.relPath)) {
      continue;
    }
    if (file.relPath === 'apps/avatar/src/shell/renderer/bridge/launch-context.ts') {
      continue;
    }
    if (file.relPath.includes('/src-tauri/capabilities/') && file.relPath.endsWith('.json')) {
      for (const pattern of AVATAR_CAPABILITY_FORBIDDEN) {
        const match = pattern.exec(file.source);
        if (match) {
          pushViolation(
            violations,
            file.relPath,
            file.source,
            match.index,
            'Avatar forbidden Tauri permission',
            'Desktop-launched Avatar capability set must exclude auth/session/account permissions',
          );
        }
      }
      continue;
    }
    if (!file.relPath.startsWith('apps/avatar/src/')) {
      continue;
    }
    for (const check of AVATAR_FORBIDDEN_PATTERNS) {
      check.pattern.lastIndex = 0;
      for (const match of file.source.matchAll(check.pattern)) {
          pushViolation(
            violations,
            file.relPath,
            file.source,
            match.index || 0,
            `Avatar forbidden ${check.label}`,
          'Default Avatar must use Runtime first-party account authority without shared auth, refresh-token custody, or Desktop scoped-binding launch truth',
        );
      }
    }
  }
}

function scanAvatarAssetScope(files, violations) {
  const file = files.find((item) => item.relPath === 'apps/avatar/src-tauri/tauri.conf.json');
  const source = requireSource(file, violations, 'apps/avatar/src-tauri/tauri.conf.json');
  if (!source) {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    pushViolation(
      violations,
      'apps/avatar/src-tauri/tauri.conf.json',
      source,
      0,
      'Avatar asset protocol scope',
      `tauri.conf.json must parse as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  const scope = parsed?.app?.security?.assetProtocol?.scope || [];
  if (!Array.isArray(scope)) {
    pushViolation(
      violations,
      file.relPath,
      source,
      source.indexOf('assetProtocol') >= 0 ? source.indexOf('assetProtocol') : 0,
      'Avatar asset protocol scope',
      'Avatar asset protocol scope must be an explicit visual-package-only list',
    );
    return;
  }
  for (const entry of scope) {
    const value = String(entry || '');
    if (/^\$HOME\/\.nimi\/(?:\*\*|\*)?$/u.test(value) || value === '$HOME/.nimi/**' || value === '$HOME/.nimi/*') {
      pushViolation(
        violations,
        file.relPath,
        source,
        source.indexOf(value) >= 0 ? source.indexOf(value) : 0,
        'Avatar broad .nimi asset scope',
        'Desktop-launched Avatar asset protocol must not expose shared .nimi auth/session/account truth',
      );
    }
    if (value.includes('$HOME/.nimi/') && !value.includes('/agent-center/modules/avatar_asset/packages/') && !value.includes('/files/')) {
      pushViolation(
        violations,
        file.relPath,
        source,
        source.indexOf(value) >= 0 ? source.indexOf(value) : 0,
        'Avatar non-visual .nimi asset scope',
        'Any .nimi asset scope must be narrowed to Agent Center avatar asset files',
      );
    }
  }
}

function scanRuntimeAccountBroker(files, violations) {
  for (const file of files) {
    if (!file.relPath.startsWith('runtime/internal/services/account/') || isTestPath(file.relPath)) {
      continue;
    }
    for (const check of RUNTIME_ACCOUNT_FORBIDDEN_PATTERNS) {
      check.pattern.lastIndex = 0;
      for (const match of file.source.matchAll(check.pattern)) {
        pushViolation(
          violations,
          file.relPath,
          file.source,
          match.index || 0,
          `Runtime account broker ${check.label}`,
          'Runtime account broker must not read Desktop shared auth or caller subject truth',
        );
      }
    }
  }
}

function scanNonAdmittedLocalAppSliceFence(files, violations) {
  // Each NON-admitted local app slice MUST carry NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER
  // in its app-shell contract — this is the explicit governance signal that
  // legacy auth seams in the slice are tolerated only because the slice has
  // not yet been admitted as a RuntimeAccountService consumer. Once admitted
  // via a D-Wave migration, the app is removed from
  // NON_ADMITTED_LOCAL_APP_SLICE_ROOTS and the fence text is removed from its
  // spec.
  for (const root of NON_ADMITTED_LOCAL_APP_SLICE_ROOTS) {
    const specPath = NON_ADMITTED_LOCAL_APP_SLICE_FENCE_SPECS.get(root);
    const spec = files.find((item) => item.relPath === specPath);
    const hasMarker = Boolean(spec && spec.source.includes(NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER));
    if (!hasMarker) {
      violations.push(`${specPath}:1 Non-admitted local app slice fence: missing ${NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER} authority classification`);
    }
  }
}

function requireSource(file, violations, relPath) {
  if (!file) {
    violations.push(`${relPath}:1 missing hardcut source: required file is absent`);
    return '';
  }
  return file.source;
}

function runtimeAccountServiceSources(files) {
  return files
    .filter((item) => item.relPath.startsWith('runtime/internal/services/account/') && item.relPath.endsWith('.go') && !item.relPath.endsWith('_test.go'))
    .sort((left, right) => left.relPath.localeCompare(right.relPath));
}

function scanRuntimeCallerAdmission(files, violations) {
  const file = files.find((item) => item.relPath === 'runtime/internal/services/account/service.go');
  const source = requireSource(file, violations, 'runtime/internal/services/account/service.go');
  if (!source) {
    return;
  }
  const accountServiceSource = runtimeAccountServiceSources(files).map((item) => item.source).join('\n');
  const requireMethodAdmission = ({
    methodName,
    tokenRequest,
    label,
    detail,
    beforeNeedles = [],
  }) => {
    const method = findGoServiceMethod(source, methodName);
    const methodIndex = method ? method.start : source.indexOf(methodName);
    const methodSource = method ? method.text : '';
    const admissionPattern = new RegExp(`(?:s\\.)?validateRuntimeAdmittedCaller\\(req\\.GetCaller\\(\\),\\s*${tokenRequest}\\)`, 'u');
    const admissionMatch = admissionPattern.exec(methodSource);
    if (!method || !admissionMatch) {
      pushViolation(
        violations,
        'runtime/internal/services/account/service.go',
        source,
        methodIndex >= 0 ? methodIndex : 0,
        label,
        detail,
      );
      return;
    }
    const firstProtectedOperation = firstIndexOfAny(methodSource, beforeNeedles);
    if (firstProtectedOperation >= 0 && admissionMatch.index > firstProtectedOperation) {
      pushViolation(
        violations,
        'runtime/internal/services/account/service.go',
        source,
        method.start + firstProtectedOperation,
        label,
        `${detail}; admission must happen before state read/mutation or token refresh`,
      );
    }
  };

  requireMethodAdmission({
    methodName: 'GetAccountSessionStatus',
    tokenRequest: false,
    label: 'Runtime status caller admission',
    detail: 'GetAccountSessionStatus must use Runtime app registry/admission, not shape-only caller validation',
    beforeNeedles: ['s.mu.RLock()'],
  });
  requireMethodAdmission({
    methodName: 'GetAccessToken',
    tokenRequest: true,
    label: 'Runtime GetAccessToken caller admission',
    detail: 'GetAccessToken must use Runtime app registry/admission, not shape-only caller validation',
    beforeNeedles: ['s.mu.RLock()', 's.RefreshAccountSession('],
  });
  requireMethodAdmission({
    methodName: 'SubscribeAccountSessionEvents',
    tokenRequest: false,
    label: 'Runtime account event subscription caller admission',
    detail: 'SubscribeAccountSessionEvents must use req.GetCaller() and Runtime app registry/admission before sending account projection or registering subscribers',
    beforeNeedles: ['s.subscribe(req)', 'stream.Send(snapshot)'],
  });
  requireMethodAdmission({
    methodName: 'RefreshAccountSession',
    tokenRequest: false,
    label: 'Runtime refresh caller admission',
    detail: 'RefreshAccountSession must use req.GetCaller() and Runtime app registry/admission before account mutation or refresh',
    beforeNeedles: ['s.mu.Lock()', 's.refresher.Refresh('],
  });
  requireMethodAdmission({
    methodName: 'Logout',
    tokenRequest: false,
    label: 'Runtime logout caller admission',
    detail: 'Logout must use req.GetCaller() and Runtime app registry/admission before account mutation',
    beforeNeedles: ['s.logout('],
  });
  requireMethodAdmission({
    methodName: 'SwitchAccount',
    tokenRequest: false,
    label: 'Runtime switch caller admission',
    detail: 'SwitchAccount must use req.GetCaller() and Runtime app registry/admission before account mutation',
    beforeNeedles: ['s.mu.Lock()'],
  });
  requireMethodAdmission({
    methodName: 'RevokeScopedAppBinding',
    tokenRequest: false,
    label: 'Runtime binding revoke caller admission',
    detail: 'RevokeScopedAppBinding must use req.GetCaller() and Runtime app registry/admission before binding mutation',
    beforeNeedles: ['s.mu.Lock()', 'record.relation.State'],
  });
  if (!/GetAccessToken[\s\S]*validateRuntimeAdmittedCaller\(req\.GetCaller\(\),\s*true\)/u.test(source)) {
    pushViolation(
      violations,
      'runtime/internal/services/account/service.go',
      source,
      source.indexOf('GetAccessToken') >= 0 ? source.indexOf('GetAccessToken') : 0,
      'Runtime GetAccessToken caller admission',
      'GetAccessToken must use Runtime app registry/admission, not shape-only caller validation',
    );
  }
  if (!/IssueScopedAppBinding[\s\S]*validateRuntimeAdmittedCaller\(req\.GetCaller\(\),\s*false\)/u.test(source)) {
    pushViolation(
      violations,
      'runtime/internal/services/account/service.go',
      source,
      source.indexOf('IssueScopedAppBinding') >= 0 ? source.indexOf('IssueScopedAppBinding') : 0,
      'Runtime binding caller admission',
      'IssueScopedAppBinding must use Runtime app registry/admission',
    );
  }
  if (!/IssueScopedAppBinding[\s\S]*validateBindingCallerRelation\(req\.GetCaller\(\),\s*relation\)/u.test(source)) {
    pushViolation(
      violations,
      'runtime/internal/services/account/service.go',
      source,
      source.indexOf('IssueScopedAppBinding') >= 0 ? source.indexOf('IssueScopedAppBinding') : 0,
      'Runtime binding relation admission',
      'IssueScopedAppBinding must reject caller/relation app or instance mismatches',
    );
  }
  const revokeMethod = findGoServiceMethod(source, 'RevokeScopedAppBinding');
  const revokeSource = revokeMethod ? revokeMethod.text : '';
  if (!/validateBindingCallerRelation\(req\.GetCaller\(\),\s*record\.relation\)/u.test(revokeSource)) {
    pushViolation(
      violations,
      'runtime/internal/services/account/service.go',
      source,
      revokeMethod ? revokeMethod.start : source.indexOf('RevokeScopedAppBinding'),
      'Runtime binding revoke relation admission',
      'RevokeScopedAppBinding must reject caller/relation app or instance mismatches',
    );
  }
  if (!/AdmitLocalFirstPartyInstance\(/u.test(accountServiceSource)) {
    pushViolation(
      violations,
      'runtime/internal/services/account/service.go',
      source,
      source.indexOf('validateRuntimeAdmittedCaller') >= 0 ? source.indexOf('validateRuntimeAdmittedCaller') : 0,
      'Runtime registry admission source',
      'account service must consult the Runtime app registry admission source',
    );
  }
}

function scanRuntimeBindingAuthenticatedState(files, violations) {
  const file = files.find((item) => item.relPath === 'runtime/internal/services/account/service.go');
  const source = requireSource(file, violations, 'runtime/internal/services/account/service.go');
  if (!source) {
    return;
  }
  const accountFiles = runtimeAccountServiceSources(files);
  if (!/ValidateScopedBinding[\s\S]*s\.state\s*!=\s*runtimev1\.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED/u.test(source)) {
    pushViolation(
      violations,
      'runtime/internal/services/account/service.go',
      source,
      source.indexOf('ValidateScopedBinding') >= 0 ? source.indexOf('ValidateScopedBinding') : 0,
      'Runtime binding authenticated-state validation',
      'ValidateScopedBinding must fail closed unless current account state is authenticated',
    );
  }
  for (const marker of ['markCustodyUnavailable', 'transitionToReauthRequired', 'ObserveRefreshToken']) {
    const defPattern = new RegExp(`func \\(s \\*Service\\) ${marker}\\b`);
    const markerFile = accountFiles.find((item) => defPattern.test(item.source));
    const markerSource = markerFile ? markerFile.source : source;
    const defMatch = markerFile ? defPattern.exec(markerSource) : null;
    const markerIndex = defMatch ? defMatch.index : -1;
    const block = markerIndex >= 0 ? markerSource.slice(markerIndex, markerIndex + 1200) : '';
    if (!block.includes('revokeBindingsLocked')) {
      pushViolation(
        violations,
        markerFile ? markerFile.relPath : 'runtime/internal/services/account/service.go',
        markerSource,
        markerIndex >= 0 ? markerIndex : 0,
        'Runtime binding non-auth revocation',
        `${marker} must revoke or suspend active scoped bindings when account state leaves authenticated`,
      );
    }
  }
}

function scanDesktopAvatarLaunchAuthority(files, violations) {
  const desktopLauncher = files.find((item) => item.relPath === 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts');
  if (desktopLauncher) {
    for (const field of DESKTOP_AVATAR_LAUNCH_FORBIDDEN_FIELDS) {
      const pattern = new RegExp(`\\b(?:payload|launchPayload|handoffPayload)\\b\\s*(?::[^=]+)?=\\s*\\{[^}]*\\b${field}\\b(?:\\s*:|\\s*[,}])`, 'su');
      const match = pattern.exec(desktopLauncher.source);
      if (match) {
        pushViolation(
          violations,
          desktopLauncher.relPath,
          desktopLauncher.source,
          match.index,
          'Desktop Avatar launch authority field',
          `Desktop-launched Avatar handoff must not carry ${field}`,
        );
      }
    }
    for (const pattern of [/\bissueScopedAppBinding\s*\(/u, /\bruntime\.account\.issueScopedAppBinding\b/u, /\bruntime\.agent\.anchors\.open\b/u]) {
      const match = pattern.exec(desktopLauncher.source);
      if (match) {
        pushViolation(
          violations,
          desktopLauncher.relPath,
          desktopLauncher.source,
          match.index,
          'Desktop Avatar launch precondition authority',
          'Desktop must not issue scoped bindings or reserve Runtime anchors before launching default Avatar',
        );
      }
    }
  }

  const desktopTauriHandoff = files.find((item) => item.relPath === 'apps/desktop/src-tauri/src/main_parts/defaults_and_commands/window_and_logs.rs');
  if (desktopTauriHandoff) {
    for (const parameter of AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS) {
      const pattern = new RegExp(`append_pair\\(\\s*["']${parameter}["']`, 'u');
      const match = pattern.exec(desktopTauriHandoff.source);
      if (match) {
        pushViolation(
          violations,
          desktopTauriHandoff.relPath,
          desktopTauriHandoff.source,
          match.index,
          'Desktop Avatar handoff URI authority field',
          `Desktop Avatar handoff URI must not serialize ${parameter}`,
        );
      }
    }
  }
}

function scanAvatarLaunchParserGuardrail(files, violations) {
  for (const relPath of [
    'apps/avatar/src/shell/renderer/bridge/launch-context.ts',
    'apps/avatar/src-tauri/src/avatar_launch_context.rs',
  ]) {
    const file = files.find((item) => item.relPath === relPath);
    const source = requireSource(file, violations, relPath);
    if (!source) {
      continue;
    }
    for (const parameter of AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS) {
      if (!source.includes(parameter)) {
        pushViolation(
          violations,
          relPath,
          source,
          0,
          'Avatar launch parser missing forbidden field',
          `Avatar launch parser must reject ${parameter}`,
        );
      }
    }
  }
}

function scanDesktopLocalAvatarCarrierDecommission(files, violations) {
  const store = files.find((item) => item.relPath === 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.ts');
  const source = requireSource(store, violations, 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.ts');
  if (!source) {
    return;
  }
  if (!source.includes('DESKTOP_AVATAR_STORE_DECOMMISSIONED_MESSAGE')) {
    pushViolation(
      violations,
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.ts',
      source,
      0,
      'Desktop local avatar carrier decommission guard',
      'decommissioned Desktop avatar store must retain an explicit hard-block message',
    );
  }
  const invokeMatch = /\binvokeChecked\s*\(/u.exec(source);
  if (invokeMatch) {
    pushViolation(
      violations,
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.ts',
      source,
      invokeMatch.index,
      'Desktop local avatar carrier IPC revival',
      'decommissioned Desktop avatar store must not call Tauri IPC resource or binding commands',
    );
  }
}

function scanWebCloudFence(files, violations) {
  const webBootstrap = files.find((file) => file.relPath === 'apps/web/src/desktop-adapter/runtime-bootstrap.web.ts');
  if (webBootstrap && !webBootstrap.source.includes('WEB_CLOUD_ADAPTER_AUTH_MODE')) {
    violations.push('apps/web/src/desktop-adapter/runtime-bootstrap.web.ts:1 Web/cloud fence: missing WEB_CLOUD_ADAPTER_AUTH_MODE classification');
  }

  for (const file of files) {
    if (!file.relPath.startsWith('apps/web/src/') || !/\.[cm]?[jt]sx?$/.test(file.relPath)) {
      continue;
    }
    for (const block of findCallBlocks(file.source, 'createPlatformClient')) {
      if (block.text.includes('accessTokenProvider') || block.text.includes('refreshTokenProvider') || block.text.includes('subjectUserIdProvider')) {
        if (!hasAuthMode(block.text, 'web-cloud') && !hasAuthMode(block.text, 'external-principal')) {
          pushViolation(
            violations,
            file.relPath,
            file.source,
            block.start,
            'Web/cloud auth seam fence',
            'Web app-owned auth inputs must declare web-cloud or external-principal mode',
          );
        }
      }
    }
  }
}

export function scanAccountSessionHardcut(files) {
  const violations = [];
  scanPlatformClientConstruction(files, violations);
  scanJwtSubjectAuthority(files, violations);
  scanDesktopSharedAuthOwner(files, violations);
  scanAvatarBoundary(files, violations);
  scanAvatarAssetScope(files, violations);
  scanRuntimeAccountBroker(files, violations);
  scanRuntimeCallerAdmission(files, violations);
  scanRuntimeBindingAuthenticatedState(files, violations);
  scanDesktopAvatarLaunchAuthority(files, violations);
  scanAvatarLaunchParserGuardrail(files, violations);
  scanDesktopLocalAvatarCarrierDecommission(files, violations);
  scanWebCloudFence(files, violations);
  scanNonAdmittedLocalAppSliceFence(files, violations);
  return violations.sort();
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const { runAccountSessionHardcutSelfTest } = await import('./lib/check-account-session-hardcut-self-test.mjs');
    runAccountSessionHardcutSelfTest({
      AVATAR_LAUNCH_FORBIDDEN_QUERY_PARAMETERS,
      NON_ADMITTED_LOCAL_APP_SLICE_FENCE_MARKER,
      NON_ADMITTED_LOCAL_APP_SLICE_FENCE_SPECS,
      NON_ADMITTED_LOCAL_APP_SLICE_ROOTS,
      scanAccountSessionHardcut,
    });
    return;
  }

  const violations = scanAccountSessionHardcut(collectRepoFiles());
  if (violations.length > 0) {
    process.stderr.write('account-session hardcut check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write('account-session hardcut check passed\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
