#!/usr/bin/env node

import assert from 'node:assert/strict';
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

const LOCAL_APP_SLICE_ROOTS = [
  'apps/shiji/',
  'apps/moment/',
  'apps/polyinfo/',
  'apps/parentos/',
];

const LOCAL_APP_SLICE_FENCE_MARKER = 'ACCOUNT_HARDCUT_NON_ADMITTED_APP_SLICE_FENCE';

const LOCAL_APP_SLICE_FENCE_SPECS = new Map([
  ['apps/shiji/', 'apps/shiji/spec/kernel/app-shell-contract.md'],
  ['apps/moment/', 'apps/moment/spec/kernel/app-shell-contract.md'],
  ['apps/polyinfo/', 'apps/polyinfo/spec/kernel/app-shell-contract.md'],
  ['apps/parentos/', 'apps/parentos/spec/kernel/app-shell-contract.md'],
]);

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
  { label: 'Runtime account access token', pattern: /\bGetAccessToken\b|\bgetAccessToken\s*\(/g },
  { label: 'Runtime scoped binding issue', pattern: /\bIssueScopedAppBinding\b|\bissueScopedAppBinding\s*\(/g },
  { label: 'Runtime login begin', pattern: /\bBeginLogin\b|\bbeginLogin\s*\(/g },
  { label: 'Runtime login complete', pattern: /\bCompleteLogin\b|\bcompleteLogin\s*\(/g },
  { label: 'Runtime auth register app', pattern: /\bRegisterApp\b|\bregisterApp\s*\(/g },
  { label: 'Runtime auth open session', pattern: /\bOpenSession\b|\bopenSession\s*\(/g },
  { label: 'Realm current user authority', pattern: /\bMeService\.getMe\b|\bgetMe\s*\(/g },
  { label: 'Realm auth/client authority', pattern: /\bRealmAuthService\b|\bnew\s+Realm\s*\(|\bcreateRealmClient\s*\(/g },
  { label: 'Avatar anchor owner', pattern: /\bruntime\.agent\.anchors\.open\b|\banchors\.open\s*\(/g },
  { label: 'caller subject truth', pattern: /\bsubject_user_id\b|\bsubjectUserId\b/g },
  { label: 'account projection', pattern: /\bAccountProjection\b|\baccountProjection\b/g },
  { label: 'raw account token', pattern: /\baccount_access_token\b|\baccessToken\b|\brefreshToken\b|\brawJwt\b/g },
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

const LOCAL_APP_SLICE_AUTH_DRIFT_PATTERNS = [
  { label: 'shared auth IPC', pattern: /\bauth_session_(?:load|save|clear)\b|\bauth_session_commands\b/g },
  { label: 'app-owned token store', pattern: /\baccessToken\b|\brefreshToken\b|\brawJwt\b/g },
  { label: 'app-owned provider seam', pattern: /\baccessTokenProvider\b|\brefreshTokenProvider\b|\bsubjectUserIdProvider\b|\bsessionStore\b/g },
  { label: 'subject/user account truth', pattern: /\bsubject_user_id\b|\bsubjectUserId\b|\bauthUserId\b/g },
];

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
    'runtime/internal/services/account',
    'runtime/internal/grpcserver',
    'nimi-mods',
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

function localAppSliceRoot(relPath) {
  return LOCAL_APP_SLICE_ROOTS.find((root) => relPath.startsWith(root)) || null;
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
    if (file.relPath.startsWith('apps/avatar/spec/')) {
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
          'Desktop-launched Avatar must consume only scoped Runtime binding projection',
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
    if (value.includes('$HOME/.nimi/') && !value.includes('/agent-center/modules/avatar_package/packages/') && !value.includes('/files/')) {
      pushViolation(
        violations,
        file.relPath,
        source,
        source.indexOf(value) >= 0 ? source.indexOf(value) : 0,
        'Avatar non-visual .nimi asset scope',
        'Any .nimi asset scope must be narrowed to Agent Center avatar package files',
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

function scanLocalAppSliceAuthDrift(files, violations) {
  const authorityByRoot = new Map();
  for (const root of LOCAL_APP_SLICE_ROOTS) {
    const specPath = LOCAL_APP_SLICE_FENCE_SPECS.get(root);
    const spec = files.find((item) => item.relPath === specPath);
    authorityByRoot.set(root, Boolean(spec && spec.source.includes(LOCAL_APP_SLICE_FENCE_MARKER)));
    if (!authorityByRoot.get(root)) {
      violations.push(`${specPath}:1 Local app slice auth fence: missing ${LOCAL_APP_SLICE_FENCE_MARKER} authority classification`);
    }
  }

  for (const file of files) {
    const root = localAppSliceRoot(file.relPath);
    if (!root || isTestPath(file.relPath) || file.relPath.includes('/spec/')) {
      continue;
    }
    if (!/\.(?:[cm]?[jt]sx?|rs)$/u.test(file.relPath)) {
      continue;
    }
    if (authorityByRoot.get(root)) {
      continue;
    }
    for (const check of LOCAL_APP_SLICE_AUTH_DRIFT_PATTERNS) {
      check.pattern.lastIndex = 0;
      for (const match of file.source.matchAll(check.pattern)) {
        pushViolation(
          violations,
          file.relPath,
          file.source,
          match.index || 0,
          `Local app slice ${check.label}`,
          'local app slices must migrate auth to Runtime account projection or carry an authority-backed non-admitted fence',
        );
      }
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

function scanRuntimeCallerAdmission(files, violations) {
  const file = files.find((item) => item.relPath === 'runtime/internal/services/account/service.go');
  const source = requireSource(file, violations, 'runtime/internal/services/account/service.go');
  if (!source) {
    return;
  }
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
  if (!/AdmitLocalFirstPartyInstance\(/u.test(source)) {
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
    const defMatch = defPattern.exec(source);
    const markerIndex = defMatch ? defMatch.index : -1;
    const block = markerIndex >= 0 ? source.slice(markerIndex, markerIndex + 1200) : '';
    if (!block.includes('revokeBindingsLocked')) {
      pushViolation(
        violations,
        'runtime/internal/services/account/service.go',
        source,
        markerIndex >= 0 ? markerIndex : 0,
        'Runtime binding non-auth revocation',
        `${marker} must revoke or suspend active scoped bindings when account state leaves authenticated`,
      );
    }
  }
}

function scanAvatarLaunchIdentityLeak(files, violations) {
  const desktopLauncher = files.find((item) => item.relPath === 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts');
  if (desktopLauncher) {
    for (const pattern of [/\bagentCenterAccountId\b/u, /\bagent_center_account_id\b/u, /\baccountId\s*:/u, /\bsubjectUserId\b/u, /\buserId\s*:/u]) {
      const match = pattern.exec(desktopLauncher.source);
      if (match) {
        pushViolation(
          violations,
          desktopLauncher.relPath,
          desktopLauncher.source,
          match.index,
          'Desktop Avatar launch account identity leak',
          'Desktop-launched Avatar handoff must not carry account/user identity',
        );
      }
    }
  }

  const avatarPackageResolver = files.find((item) => item.relPath === 'apps/avatar/src-tauri/src/agent_center_avatar_package.rs');
  if (avatarPackageResolver) {
    for (const pattern of [/\bagent_center_account_id\b/u, /\baccount_id\b/u, /\bsubject_user_id\b/u, /\buser_id\b/u]) {
      const match = pattern.exec(avatarPackageResolver.source);
      if (match) {
        pushViolation(
          violations,
          avatarPackageResolver.relPath,
          avatarPackageResolver.source,
          match.index,
          'Avatar package resolver account identity dependency',
          'Avatar visual package resolution must consume only a non-account descriptor/capability',
        );
      }
    }
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

function scanModsBoundary(files, violations) {
  for (const file of files) {
    if (!file.relPath.startsWith('nimi-mods/') || isTestPath(file.relPath)) {
      continue;
    }
    const pattern = /\bRuntimeAccountService\b|\bruntime\.account\b|\bGetAccessToken\b|\bIssueScopedAppBinding\b|\bBeginLogin\b|\bCompleteLogin\b/g;
    for (const match of file.source.matchAll(pattern)) {
      pushViolation(
        violations,
        file.relPath,
        file.source,
        match.index || 0,
        'Mod account authority bypass',
        'mods must use host-scoped capabilities, not direct Runtime account authority',
      );
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
  scanAvatarLaunchIdentityLeak(files, violations);
  scanWebCloudFence(files, violations);
  scanModsBoundary(files, violations);
  scanLocalAppSliceAuthDrift(files, violations);
  return violations.sort();
}

function runSelfTest() {
  const files = [
    {
      relPath: 'apps/desktop/test/local-negative.test.ts',
      source: "createPlatformClient({ realmBaseUrl: 'https://realm', accessTokenProvider: () => token });",
    },
    {
      relPath: 'apps/desktop/test/external-positive.test.ts',
      source: "createPlatformClient({ authMode: 'external-principal', realmBaseUrl: 'https://realm', subjectUserIdProvider: () => subject });",
    },
    {
      relPath: 'sdk/test/local-negative.test.ts',
      source: "createPlatformClient({ authMode: 'local-first-party-runtime', realmBaseUrl: 'https://realm', refreshTokenProvider: () => refresh });",
    },
    {
      relPath: 'sdk/test/web-positive.test.ts',
      source: "createPlatformClient({ authMode: 'web-cloud', realmBaseUrl: 'https://realm', refreshTokenProvider: () => refresh });",
    },
    {
      relPath: 'apps/avatar/src/shell/renderer/bad.ts',
      source: "runtime.account.getAccessToken({}); RuntimeAuthService.RegisterApp({}); runtime.agent.anchors.open({});",
    },
    {
      relPath: 'apps/avatar/src/shell/renderer/good.ts',
      source: "runtime.agent.turns.request({ scopedBinding });",
    },
    {
      relPath: 'apps/avatar/src-tauri/capabilities/default.json',
      source: JSON.stringify({ permissions: ['core:default'] }),
    },
    {
      relPath: 'apps/avatar/src-tauri/capabilities/bad.json',
      source: JSON.stringify({ permissions: ['runtime.account.GetAccessToken'] }),
    },
    {
      relPath: 'apps/avatar/src-tauri/tauri.conf.json',
      source: JSON.stringify({
        app: {
          security: {
            assetProtocol: {
              scope: [
                '$HOME/.nimi/data/accounts/*/agents/*/agent-center/modules/avatar_package/packages/*/*/files/**',
                '$HOME/ai/**',
              ],
            },
          },
        },
      }),
    },
    ...LOCAL_APP_SLICE_ROOTS.map((root) => ({
      relPath: LOCAL_APP_SLICE_FENCE_SPECS.get(root),
      source: `${LOCAL_APP_SLICE_FENCE_MARKER}: non-admitted local app slice; legacy auth seams are fenced until Runtime admission migration.`,
    })),
    {
      relPath: 'apps/shiji/src/shell/renderer/app-shell/bootstrap.ts',
      source: 'createPlatformClient({ accessTokenProvider: () => token, refreshTokenProvider: () => refresh });',
    },
    {
      relPath: 'runtime/internal/services/account/bad.go',
      source: 'func read() { _ = "auth_session_load"; _ = "subject_user_id" }',
    },
		    {
		      relPath: 'runtime/internal/services/account/service.go',
		      source: `
	func (s *Service) GetAccountSessionStatus(req *Request) {
	  s.validateRuntimeAdmittedCaller(req.GetCaller(), false)
	  s.mu.RLock()
	}
	func (s *Service) GetAccessToken() { s.validateRuntimeAdmittedCaller(req.GetCaller(), true) }
	func (s *Service) SubscribeAccountSessionEvents(req *Request) {
	  s.validateRuntimeAdmittedCaller(req.GetCaller(), false)
	  s.subscribe(req)
	}
	func (s *Service) RefreshAccountSession(req *Request) {
	  s.validateRuntimeAdmittedCaller(req.GetCaller(), false)
	  s.mu.Lock()
	}
	func (s *Service) Logout(req *Request) {
	  s.validateRuntimeAdmittedCaller(req.GetCaller(), false)
	  s.logout(ctx, reason)
	}
	func (s *Service) SwitchAccount(req *Request) {
	  s.validateRuntimeAdmittedCaller(req.GetCaller(), false)
	  s.mu.Lock()
	}
	func (s *Service) IssueScopedAppBinding() {
	  s.validateRuntimeAdmittedCaller(req.GetCaller(), false)
	  validateBindingCallerRelation(req.GetCaller(), relation)
}
func (s *Service) RevokeScopedAppBinding() {
  s.validateRuntimeAdmittedCaller(req.GetCaller(), false)
  validateBindingCallerRelation(req.GetCaller(), record.relation)
  s.mu.Lock()
}
func (s *Service) validateRuntimeAdmittedCaller() { s.registry.AdmitLocalFirstPartyInstance("", "") }
func (s *Service) ValidateScopedBinding() {
  if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {}
}
func (s *Service) markCustodyUnavailable() { s.revokeBindingsLocked(reason) }
func (s *Service) transitionToReauthRequired() { s.revokeBindingsLocked(reason) }
func (s *Service) ObserveRefreshToken() { s.revokeBindingsLocked(reason) }
`,
	    },
	    {
	      relPath: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts',
	      source: 'export const payload = { agentId, avatarPackageId };',
	    },
	    {
	      relPath: 'apps/avatar/src-tauri/src/agent_center_avatar_package.rs',
	      source: 'struct Payload { agent_id: String, avatar_package_id: String }',
	    },
    {
      relPath: 'apps/web/src/desktop-adapter/runtime-bootstrap.web.ts',
      source: "export const WEB_CLOUD_ADAPTER_AUTH_MODE = 'web-cloud-adapter' as const;",
    },
    {
      relPath: 'apps/web/src/positive.ts',
      source: "createPlatformClient({ authMode: 'web-cloud', accessTokenProvider: () => token });",
    },
    {
      relPath: 'apps/web/src/negative.ts',
      source: "createPlatformClient({ accessTokenProvider: () => token });",
    },
    {
      relPath: 'nimi-mods/example/src/bad.ts',
      source: 'runtime.account.getAccessToken({});',
    },
    {
      relPath: 'nimi-mods/example/src/good.ts',
      source: 'host.capabilities.invoke("runtime.agent.turn.write");',
    },
  ];

  const violations = scanAccountSessionHardcut(files);
  assert.equal(violations.some((item) => item.includes('local-negative.test.ts') && item.includes('accessTokenProvider')), true);
  assert.equal(violations.some((item) => item.includes('external-positive.test.ts')), false);
  assert.equal(violations.some((item) => item.includes('local-negative.test.ts') && item.includes('refreshTokenProvider')), true);
  assert.equal(violations.some((item) => item.includes('web-positive.test.ts')), false);
  assert.equal(violations.some((item) => item.includes('bad.ts') && item.includes('Avatar forbidden')), true);
  assert.equal(violations.some((item) => item.includes('good.ts') && item.includes('Avatar forbidden')), false);
  assert.equal(violations.some((item) => item.includes('bad.json') && item.includes('Avatar forbidden Tauri permission')), true);
  assert.equal(violations.some((item) => item.includes('default.json') && item.includes('Avatar forbidden Tauri permission')), false);
  assert.equal(violations.some((item) => item.includes('tauri.conf.json') && item.includes('Avatar broad .nimi asset scope')), false);
  assert.equal(violations.some((item) => item.includes('apps/shiji/src') && item.includes('Local app slice')), false);
	  assert.equal(violations.some((item) => item.includes('bad.go') && item.includes('Runtime account broker')), true);
	  assert.equal(violations.some((item) => item.includes('chat-agent-avatar-launcher.ts') && item.includes('Desktop Avatar launch account identity leak')), false);
	  assert.equal(violations.some((item) => item.includes('agent_center_avatar_package.rs') && item.includes('Avatar package resolver account identity dependency')), false);
	  assert.equal(violations.some((item) => item.includes('runtime-bootstrap.web.ts')), false);
  assert.equal(violations.some((item) => item.includes('apps/web/src/negative.ts')), true);
  assert.equal(violations.some((item) => item.includes('apps/web/src/positive.ts')), false);
	  assert.equal(violations.some((item) => item.includes('nimi-mods/example/src/bad.ts')), true);
		  assert.equal(violations.some((item) => item.includes('nimi-mods/example/src/good.ts')), false);

		  const p1NegativeViolations = scanAccountSessionHardcut([
		    {
		      relPath: 'runtime/internal/services/account/service.go',
		      source: `
	func (s *Service) GetAccountSessionStatus(req *Request) {
	  validateProductionCaller(req.GetCaller(), false)
	  s.mu.RLock()
	}
	func (s *Service) GetAccessToken() { validateProductionCaller(req.GetCaller(), true) }
	func (s *Service) SubscribeAccountSessionEvents(req *Request) {
	  s.subscribe(req)
	}
	func (s *Service) RefreshAccountSession(req *Request) {
	  s.mu.Lock()
	  s.refresher.Refresh(ctx, current)
	}
	func (s *Service) Logout(req *Request) {
	  return s.logout(ctx, reason)
	}
	func (s *Service) SwitchAccount(req *Request) {
	  s.mu.Lock()
	}
	func (s *Service) IssueScopedAppBinding() { validateProductionCaller(req.GetCaller(), false) }
	func (s *Service) RevokeScopedAppBinding() {
	  s.mu.Lock()
	  record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
	}
	func (s *Service) ValidateScopedBinding() { record := s.bindings[id]; _ = record }
	func (s *Service) markCustodyUnavailable() {}
func (s *Service) transitionToReauthRequired() {}
func (s *Service) ObserveRefreshToken() {}
`,
	    },
	    {
	      relPath: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts',
	      source: 'export const payload = { agentCenterAccountId: accountId, agentId };',
	    },
	    {
	      relPath: 'apps/avatar/src-tauri/src/agent_center_avatar_package.rs',
	      source: 'struct Payload { agent_center_account_id: String, subject_user_id: String }',
	    },
	    {
	      relPath: 'apps/avatar/src-tauri/tauri.conf.json',
	      source: JSON.stringify({ app: { security: { assetProtocol: { scope: ['$HOME/.nimi/**'] } } } }),
	    },
	    {
	      relPath: 'apps/shiji/spec/kernel/app-shell-contract.md',
	      source: 'missing app slice fence',
	    },
	    {
	      relPath: 'apps/moment/spec/kernel/app-shell-contract.md',
	      source: `${LOCAL_APP_SLICE_FENCE_MARKER}: non-admitted`,
	    },
	    {
	      relPath: 'apps/polyinfo/spec/kernel/app-shell-contract.md',
	      source: `${LOCAL_APP_SLICE_FENCE_MARKER}: non-admitted`,
	    },
	    {
	      relPath: 'apps/parentos/spec/kernel/app-shell-contract.md',
	      source: `${LOCAL_APP_SLICE_FENCE_MARKER}: non-admitted`,
	    },
	    {
	      relPath: 'apps/shiji/src/shell/renderer/app-shell/bootstrap.ts',
	      source: 'createPlatformClient({ accessTokenProvider: () => token });',
	    },
		  ]);
		  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime status caller admission')), true);
		  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime GetAccessToken caller admission')), true);
		  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime account event subscription caller admission')), true);
		  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime refresh caller admission')), true);
		  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime logout caller admission')), true);
		  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime switch caller admission')), true);
		  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding caller admission')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding relation admission')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding revoke caller admission')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding revoke relation admission')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding authenticated-state validation')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Runtime binding non-auth revocation')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Desktop Avatar launch account identity leak')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Avatar package resolver account identity dependency')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Avatar broad .nimi asset scope')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Local app slice auth fence')), true);
	  assert.equal(p1NegativeViolations.some((item) => item.includes('Local app slice app-owned provider seam')), true);
  process.stdout.write('account-session hardcut self-test passed\n');
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
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
  main();
}
