import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import {
  WORKBENCH_CORE_SOURCE_ROOT,
  readAppSourceFile,
  resolveAppSource,
} from '../scripts/sync-app-source.mjs';
import { loadDefaultStarterSource, readDefaultStarterSourceFile } from './app-scaffold-default-source.mjs';
import { normalizeAppAccessItems } from './app-access-declaration.mjs';
import {
  resolveAppScaffoldCandidateFeatures,
  resolveAppScaffoldFeatures,
  resolveAppScaffoldIntentFeatures,
  validateAppScaffoldCargoDependencyValue,
  validateAppScaffoldNpmRegistryVersion,
} from './app-scaffold-capabilities.mjs';
import {
  SUPPORTED_APP_SCAFFOLD_PROFILES,
  buildDefaultStarterFiles,
} from './app-scaffold-profiles.mjs';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-009b
export { SUPPORTED_APP_SCAFFOLD_PROFILES };
const DEFAULT_APP_ID = 'my.nimi-app';
const DEFAULT_APP_TITLE = 'My Nimi App';
const DEFAULT_APP_VERSION = '0.1.0';
const SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
export const SCAFFOLD_INTENT_VERSION = 4;
export const SCAFFOLD_LOCK_VERSION = 4;
export const SCAFFOLD_VERSION = '2026-08-31.app-lifecycle-v1';
export const SCAFFOLD_STATE_DIR = '.nimi/app-scaffold';
export const SCAFFOLD_INTENT_PATH = `${SCAFFOLD_STATE_DIR}/intent.json`;
export const SCAFFOLD_LOCK_PATH = `${SCAFFOLD_STATE_DIR}/lock.json`;
const LOCKFILE_POLICY = 'author-install-generates-lockfile';
const GENERATED_GITIGNORE = [
  'node_modules/',
  'dist/',
  'dist-electron/',
  'dist-electron-package/',
  'src-tauri/target/',
  '.env.local',
  '.env.*.local',
  '.nimi/local/',
  '.turbo/',
  '.vite/',
  '.DS_Store',
  '',
].join('\n');
const MINIMAL_TAURI_ICON_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
const MINIMAL_TAURI_ICON_ICO = Buffer.from('AAABAAEAAQEAAAEAIABEAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAABAAAAAQgGAAAAHxXEiQAAAAtJREFUeJxjYAACAAAFAAF6Xqs/AAAAAElFTkSuQmCC', 'base64');

const APP_RELEASE_WORKFLOW = [
  'name: nimi-app-release',
  'on:',
  '  pull_request:',
  '  push:',
  '    tags:',
  "      - 'v*'",
  '  workflow_dispatch: {}',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  prepare:',
  '    runs-on: ubuntu-latest',
  '    outputs:',
  '      matrix: ${{ steps.matrix.outputs.matrix }}',
  '    steps:',
  '      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2',
  '        with:',
  '          fetch-depth: 0',
  '          persist-credentials: false',
  '      - uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0',
  '        with:',
  '          node-version: 24',
  '          package-manager-cache: false',
  '      - run: corepack enable',
  '      - run: pnpm install --frozen-lockfile',
  '      - run: pnpm exec nimi-app sync',
  '      - run: test -z "$(git status --porcelain)"',
  '      - run: pnpm exec nimi-app check --json > .nimi-targets.json',
  '      - run: pnpm exec nimi-app test',
  '      - name: Require tag/version lockstep',
  "        if: github.event_name == 'push' && github.ref_type == 'tag'",
  '        run: node -e "const p=require(\'./package.json\'); if (process.env.GITHUB_REF_NAME !== `v${p.version}`) throw new Error(\'tag_version_mismatch\')"',
  '      - name: Require annotated tag bound to this commit',
  "        if: github.event_name == 'push' && github.ref_type == 'tag'",
  '        shell: bash',
  '        run: |',
  '          test "$(git cat-file -t "refs/tags/$GITHUB_REF_NAME")" = tag',
  '          test "$(git rev-parse "refs/tags/$GITHUB_REF_NAME^{}")" = "$GITHUB_SHA"',
  '      - name: Require tagged commit on canonical default branch',
  "        if: github.event_name == 'push' && github.ref_type == 'tag'",
  '        env:',
  '          NIMI_APP_CANONICAL_BRANCH: ${{ github.event.repository.default_branch }}',
  '        shell: bash',
  '        run: |',
  '          test -n "$NIMI_APP_CANONICAL_BRANCH"',
  '          git fetch --no-tags origin "refs/heads/$NIMI_APP_CANONICAL_BRANCH:refs/remotes/origin/$NIMI_APP_CANONICAL_BRANCH"',
  '          git merge-base --is-ancestor "$GITHUB_SHA" "refs/remotes/origin/$NIMI_APP_CANONICAL_BRANCH"',
  '      - name: Run production release preflight',
  "        if: github.event_name == 'push' && github.ref_type == 'tag'",
  '        run: pnpm exec nimi-app check --production',
  '      - name: Require protected tags and immutable releases',
  "        if: github.event_name == 'push' && github.ref_type == 'tag'",
  '        env:',
  '          GH_TOKEN: ${{ secrets.NIMI_REPOSITORY_ADMIN_TOKEN }}',
  '        shell: bash',
  '        run: |',
  '          test -n "$GH_TOKEN"',
  '          test "$(gh api "repos/$GITHUB_REPOSITORY/immutable-releases" --jq .enabled)" = true',
  '          protected=false',
  '          while read -r ruleset_id; do',
  '            ruleset=$(gh api "repos/$GITHUB_REPOSITORY/rulesets/$ruleset_id")',
  '            excluded=false',
  '            while read -r pattern; do',
  '              if [[ "refs/tags/$GITHUB_REF_NAME" == $pattern ]]; then excluded=true; break; fi',
  '            done < <(jq -r \'.conditions.ref_name.exclude[]?\' <<<"$ruleset")',
  '            if test "$excluded" = true; then continue; fi',
  "            if jq -e '(.conditions.ref_name.include | index(\"refs/tags/v*\")) != null and ([.rules[].type] | index(\"update\") != null and index(\"deletion\") != null)' <<<\"$ruleset\" >/dev/null; then",
  '              protected=true',
  '              break',
  '            fi',
  '          done < <(gh api "repos/$GITHUB_REPOSITORY/rulesets" --jq \'.[] | select(.target == "tag" and .enforcement == "active") | .id\')',
  '          test "$protected" = true',
  '      - name: Resolve declared target matrix',
  '        id: matrix',
  '        shell: bash',
  '        run: |',
  "          matrix=$(jq -c '{include: [.targets[] | {target: ., runner: (if . == \"windows-x86_64\" then \"windows-latest\" else error(\"unsupported target\") end)}]}' .nimi-targets.json)",
  '          test "$(jq \'.include | length\' <<<"$matrix")" -gt 0',
  '          echo "matrix=$matrix" >> "$GITHUB_OUTPUT"',
  '  build-target:',
  '    needs: prepare',
  '    runs-on: ${{ matrix.runner }}',
  '    permissions:',
  '      contents: read',
  '    strategy:',
  '      fail-fast: false',
  '      matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}',
  '    steps:',
  '      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2',
  '        with:',
  '          persist-credentials: false',
  '      - uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0',
  '        with:',
  '          node-version: 24',
  '          package-manager-cache: false',
  '      - run: corepack enable',
  '      - run: pnpm install --frozen-lockfile',
  '      - name: Build development target',
  "        if: github.event_name != 'push' || github.ref_type != 'tag'",
  '        env:',
  '          NIMI_APP_TARGET: ${{ matrix.target }}',
  '        shell: pwsh',
  '        run: pnpm exec nimi-app build --target $env:NIMI_APP_TARGET',
  '      - name: Build production target',
  "        if: github.event_name == 'push' && github.ref_type == 'tag'",
  '        env:',
  '          NIMI_APP_TARGET: ${{ matrix.target }}',
  '          NIMI_APP_PRODUCTION: true',
  '        shell: pwsh',
  '        run: pnpm exec nimi-app build --target $env:NIMI_APP_TARGET --production',
  '      - name: Require build to preserve the tracked source tree',
  '        shell: bash',
  '        run: test -z "$(git status --porcelain)"',
  '      - name: Pack development target',
  "        if: github.event_name != 'push' || github.ref_type != 'tag'",
  '        env:',
  '          NIMI_APP_TARGET: ${{ matrix.target }}',
  '        shell: pwsh',
  '        run: pnpm exec nimi-app pack --target $env:NIMI_APP_TARGET',
  '      - name: Verify native trust and pack production target',
  "        if: github.event_name == 'push' && github.ref_type == 'tag'",
  '        env:',
  '          NIMI_APP_TARGET: ${{ matrix.target }}',
  '        shell: pwsh',
  '        run: pnpm exec nimi-app pack --target $env:NIMI_APP_TARGET --production',
  '      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
  '        with:',
  '          name: nimi-app-${{ matrix.target }}',
  '          path: |',
  '            dist/nimi-app/*.nimiapp',
  '            dist/nimi-app/*.target.json',
  '          if-no-files-found: error',
  '  attest-target:',
  "    if: github.event_name == 'push' && github.ref_type == 'tag'",
  '    needs: [prepare, build-target]',
  '    runs-on: ubuntu-latest',
  '    permissions:',
  '      contents: read',
  '      id-token: write',
  '      attestations: write',
  '      artifact-metadata: write',
  '    strategy:',
  '      fail-fast: false',
  '      matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}',
  '    steps:',
  '      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1',
  '        with:',
  '          name: nimi-app-${{ matrix.target }}',
  '          path: attest-assets',
  '      - uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2',
  '        with:',
  '          subject-path: attest-assets/*.nimiapp',
  '  aggregate:',
  '    needs: build-target',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2',
  '        with:',
  '          persist-credentials: false',
  '      - uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0',
  '        with:',
  '          node-version: 24',
  '          package-manager-cache: false',
  '      - run: corepack enable',
  '      - run: pnpm install --frozen-lockfile',
  '      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1',
  '        with:',
  '          pattern: nimi-app-*',
  '          path: dist/nimi-app',
  '          merge-multiple: true',
  '      - run: pnpm exec nimi-app pack --aggregate',
  '      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
  '        with:',
  '          name: nimi-app-release-candidate',
  '          path: |',
  '            dist/nimi-app/*.nimiapp',
  '            dist/nimi-app/*.target.json',
  '            dist/nimi-app/*.candidate.json',
  '          if-no-files-found: error',
  '  release:',
  "    if: github.event_name == 'push' && github.ref_type == 'tag'",
  '    needs: [aggregate, attest-target]',
  '    runs-on: ubuntu-latest',
  '    permissions:',
  '      contents: write',
  '    steps:',
  '      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1',
  '        with:',
  '          name: nimi-app-release-candidate',
  '          path: release-assets',
  '      - name: Publish the immutable GitHub Release set',
  '        env:',
  '          GH_TOKEN: ${{ github.token }}',
  '        shell: bash',
  '        run: |',
  '          set -euo pipefail',
  '          shopt -s nullglob',
  '          assets=(release-assets/*.nimiapp release-assets/*.candidate.json)',
  '          test "${#assets[@]}" -gt 0',
  "          expected=$(printf '%s\\n' \"${assets[@]##*/}\" | jq -R -s -c 'split(\"\\n\")[:-1] | sort')",
  '          if release_json=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$GITHUB_REF_NAME" 2>/dev/null); then',
  '            existing=$(jq -c \'.assets | map(.name) | sort\' <<<"$release_json")',
  "            unexpected=$(jq -n --argjson existing \"$existing\" --argjson expected \"$expected\" '$existing - $expected | length')",
  '            test "$unexpected" -eq 0',
  '            if test "$(jq -r .draft <<<"$release_json")" = false; then',
  '              test "$existing" = "$expected"',
  '              gh release verify "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY"',
  '              for asset in "${assets[@]}"; do gh release verify-asset "$GITHUB_REF_NAME" "$asset" --repo "$GITHUB_REPOSITORY"; done',
  '              exit 0',
  '            fi',
  '          else',
  '            gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --draft --verify-tag --title "$GITHUB_REF_NAME" --notes-from-tag',
  '            release_json=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$GITHUB_REF_NAME")',
  '          fi',
  '          verify_dir=$(mktemp -d)',
  '          for asset in "${assets[@]}"; do',
  '            name=$(basename "$asset")',
  '            if jq -e --arg name "$name" \'.assets[] | select(.name == $name)\' <<<"$release_json" >/dev/null; then',
  '              gh release download "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --pattern "$name" --dir "$verify_dir"',
  '              cmp "$asset" "$verify_dir/$name"',
  '            else',
  '              gh release upload "$GITHUB_REF_NAME" "$asset" --repo "$GITHUB_REPOSITORY"',
  '            fi',
  '          done',
  '          gh release edit "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --draft=false',
  '          gh release verify "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY"',
  '          for asset in "${assets[@]}"; do gh release verify-asset "$GITHUB_REF_NAME" "$asset" --repo "$GITHUB_REPOSITORY"; done',
  '',
].join('\n');

const appSourceCache = new Map();

function loadAppSource(resolvedModuleIds = []) {
  const cacheKey = resolvedModuleIds.join('\0');
  if (!appSourceCache.has(cacheKey)) {
    appSourceCache.set(cacheKey, resolveAppSource({ resolvedModuleIds }));
  }
  return appSourceCache.get(cacheKey);
}

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(sortedJsonValue(value));
}

function slugify(input) {
  const normalized = String(input || DEFAULT_APP_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_APP_ID;
}

function normalizeExplicitAppId(input) {
  const raw = String(input || '');
  if (raw !== raw.trim() || raw !== raw.toLowerCase()) {
    throw new Error(`Invalid app id: ${input}`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(raw)) {
    throw new Error(`Invalid app id: ${input}`);
  }
  return raw;
}

function normalizeAppVersion(input) {
  const value = String(input || DEFAULT_APP_VERSION);
  if (value !== value.trim() || !SEMVER_PATTERN.test(value)) {
    throw new Error(`Invalid initial App version: ${input}`);
  }
  return value;
}

function resolveAppId(options) {
  if (String(options.appId || '').trim()) {
    return normalizeExplicitAppId(options.appId);
  }
  return DEFAULT_APP_ID;
}

function packageSafeName(input) {
  const normalized = String(input || DEFAULT_APP_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_APP_ID;
}

function validateNpmPackageSegment(segment) {
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(segment);
}

function normalizeExplicitPackageName(input) {
  const raw = String(input || '');
  const normalized = raw.trim();
  if (raw !== normalized) {
    throw new Error(`Invalid npm package name: ${input}`);
  }
  if (!normalized || normalized.length > 214 || /\s/.test(normalized)) {
    throw new Error(`Invalid npm package name: ${input}`);
  }
  if (normalized.startsWith('@')) {
    const scopedMatch = normalized.match(/^@([^/]+)\/(.+)$/);
    if (!scopedMatch || !validateNpmPackageSegment(scopedMatch[1]) || !validateNpmPackageSegment(scopedMatch[2])) {
      throw new Error(`Invalid npm package name: ${input}`);
    }
    return normalized;
  }
  if (!validateNpmPackageSegment(normalized)) {
    throw new Error(`Invalid npm package name: ${input}`);
  }
  return normalized;
}

function resolvePackageName(options, appId) {
  if (String(options.packageName || '').trim()) {
    return normalizeExplicitPackageName(options.packageName);
  }
  return packageSafeName(appId);
}

function cargoSafeNameFromPackageName(input) {
  const normalized = String(input || DEFAULT_APP_ID)
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_APP_ID;
}

function appSlugFromAppId(appId) {
  return packageSafeName(appId);
}

function tauriIdentifierFromAppId(appId) {
  const suffix = String(appId || DEFAULT_APP_ID)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');
  return `ai.nimi.apps.${suffix || DEFAULT_APP_ID}`;
}

function normalizeDisplayName(input) {
  const value = String(input ?? '');
  if (!value.trim() || value.length > 160 || /[\0\r\n]/.test(value)) {
    throw new Error('Display Name must be non-empty, at most 160 characters, and one line');
  }
  return value;
}

function normalizeAuthor(input) {
  const value = String(input ?? '');
  if (!value) return '';
  if (!value.trim() || value.length > 214 || /[\0\r\n]/.test(value)) {
    throw new Error('Author must be at most 214 characters and one line');
  }
  return value;
}

function assertNonLabIdentity(identity) {
  const normalizedTitle = identity.appTitle.trim().toLowerCase();
  const reserved = [
    identity.appId === 'nimi.lab',
    normalizedTitle === 'nimi lab',
    identity.packageName === '@nimiplatform/lab',
    identity.tauriIdentifier === 'ai.nimi.apps.nimi.lab',
    identity.cargoPackageName === 'nimiapp-lab-shell',
    identity.appSlug === 'nimi-lab',
  ];
  if (reserved.some(Boolean)) {
    throw new Error('Nimi Lab canonical identity is reserved and cannot be scaffolded');
  }
}

function deriveScaffoldDevPort(appId) {
  let hash = 0;
  for (const char of String(appId || DEFAULT_APP_ID)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100;
  }
  return 1430 + hash;
}

function buildAppIdentity(
  profile,
  appId,
  appTitle,
  version,
  packageName,
  author = '',
  accentPack = 'nimi-accent',
  features = undefined,
  featureResolver = resolveAppScaffoldFeatures,
) {
  const resolvedPackageName = packageName || packageSafeName(appId);
  const capabilityResolution = featureResolver(features);
  const identity = {
    appId,
    appTitle,
    version: normalizeAppVersion(version),
    profile,
    packageName: resolvedPackageName,
    cargoPackageName: `${cargoSafeNameFromPackageName(resolvedPackageName)}-shell`,
    tauriIdentifier: tauriIdentifierFromAppId(appId),
    nativeBundleIdentifier: tauriIdentifierFromAppId(appId),
    appSlug: appSlugFromAppId(appId),
    rendererEntryId: `${appSlugFromAppId(appId)}-app`,
    accentPack: String(accentPack || '').trim() || 'nimi-accent',
    features: capabilityResolution.resolvedFeatureIds,
    appAccessItems: normalizeAppAccessItems(capabilityResolution.appAccessItems),
    capabilityResolution,
    devPort: deriveScaffoldDevPort(appId),
    appOwnedNamespace: appId,
    author: normalizeAuthor(author),
  };
  assertNonLabIdentity(identity);
  return identity;
}

function resolveProfile(options) {
  const profile = String(options.profile || '').trim() || 'standalone';
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(profile)) {
    throw new Error(`Unsupported app scaffold profile: ${profile}`);
  }
  return profile;
}

function resolveAppScaffoldCreateInputWithResolver(
  { cwd, options = {} },
  featureResolver,
) {
  const profile = resolveProfile(options);
  const appId = resolveAppId(options);
  const appTitle = normalizeDisplayName(options.title || options.name || DEFAULT_APP_TITLE);
  const version = normalizeAppVersion(options.version);
  const packageName = resolvePackageName(options, appId);
  const author = normalizeAuthor(options.author || '');
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || appId);
  const identity = buildAppIdentity(
    profile,
    appId,
    appTitle,
    version,
    packageName,
    author,
    options.accentPack,
    options.features,
    featureResolver,
  );
  return Object.freeze({
    profile,
    appId,
    appTitle,
    version,
    packageName,
    author,
    accentPack: identity.accentPack,
    directFeatures: identity.capabilityResolution.directFeatureIds,
    resolvedModules: identity.capabilityResolution.resolvedModuleIds,
    features: identity.features,
    targetDir,
  });
}

export function resolveAppScaffoldCreateInput(input) {
  return resolveAppScaffoldCreateInputWithResolver(input, resolveAppScaffoldFeatures);
}

export function resolveAppScaffoldCandidateCreateInput(input) {
  return resolveAppScaffoldCreateInputWithResolver(input, resolveAppScaffoldCandidateFeatures);
}

function buildPackageJson(profile, versions, identity) {
  const dependencies = buildRuntimeDependencies(profile, versions, identity.capabilityResolution);
  const devDependencies = {
    '@electron/packager': versions.electronPackagerVersion,
    '@nimiplatform/app-tools': versions.appToolsVersion,
    '@nimiplatform/nimi-coding': versions.nimicodingVersion,
    '@tailwindcss/vite': versions.tailwindcssViteVersion,
    '@tauri-apps/cli': versions.tauriCliVersion,
    '@types/node': versions.nodeTypesVersion,
    '@types/react': versions.reactTypesVersion,
    '@types/react-dom': versions.reactDomTypesVersion,
    '@vitejs/plugin-react': versions.viteReactPluginVersion,
    electron: versions.electronVersion,
    esbuild: versions.esbuildVersion,
    tailwindcss: versions.tailwindcssVersion,
    typescript: versions.typescriptVersion,
    vite: versions.viteVersion,
    yaml: versions.yamlVersion,
  };
  for (const [name, version] of Object.entries(devDependencies)) {
    validateAppScaffoldNpmRegistryVersion(version, name);
  }
  const packageJson = {
    name: identity.packageName,
    version: identity.version,
    private: true,
    type: 'module',
    main: 'dist-electron/main.js',
    packageManager: versions.packageManager,
    pnpm: {
      onlyBuiltDependencies: ['electron', 'esbuild', 'protobufjs'],
    },
    scripts: {
      dev: 'nimi-app dev --shell electron',
      'dev:renderer': `vite --host 127.0.0.1 --port ${identity.devPort} --strictPort`,
      'dev:shell': 'nimi-app dev',
      'dev:electron': 'nimi-app dev --shell electron',
      init: 'nimi-app init',
      sync: 'nimi-app sync',
      check: 'nimi-app check',
      test: 'nimi-app test',
      'test:app': 'node --test test/*.test.mjs',
      'app:build': 'nimi-app build',
      pack: 'nimi-app pack',
      typecheck: 'tsc --noEmit',
      build: 'tsc --noEmit && vite build',
      'build:electron': 'tsc -p tsconfig.electron.json && node scripts/bundle-electron-preload.mjs',
      'build:electron:production': 'node scripts/clean-electron-production.mjs && pnpm run build && pnpm run build:electron && node scripts/package-electron-production.mjs',
      'build:tauri:production': 'tauri build',
      postinstall: 'install-electron --no',
      validate: 'node scripts/validate.mjs',
    },
    dependencies,
    devDependencies,
  };
  if (identity.author) {
    packageJson.author = identity.author;
  }
  return packageJson;
}

function buildRuntimeDependencies(profile, versions, capabilityResolution) {
  const dependencies = {
    '@nimiplatform/sdk': versions.sdkVersion,
    '@nimiplatform/kit': versions.kitVersion,
    react: versions.reactVersion,
    'react-dom': versions.reactDomVersion,
  };
  for (const [name, version] of Object.entries(dependencies)) {
    validateAppScaffoldNpmRegistryVersion(version, name);
  }
  for (const [name, version] of Object.entries(capabilityResolution.npmDependencies)) {
    const resolvedVersion = resolveScaffoldVersionReference(version, versions, name);
    if (Object.hasOwn(dependencies, name) && dependencies[name] !== resolvedVersion) {
      throw new Error(`App scaffold base/module dependency version collision for ${name}`);
    }
    dependencies[name] = resolvedVersion;
  }
  return dependencies;
}

function resolveScaffoldVersionReference(value, versions, dependencyName) {
  if (typeof value !== 'string') throw new Error(`Invalid npm dependency version for ${dependencyName}`);
  const match = value.match(/^\$versions\.([A-Za-z][A-Za-z0-9]*)$/u);
  const resolved = match ? versions[match[1]] : value;
  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new Error(`Missing scaffold version source for ${dependencyName}: ${match?.[1] ?? 'inline'}`);
  }
  validateAppScaffoldNpmRegistryVersion(resolved, dependencyName);
  return resolved;
}

function buildCargoDependencies(profile, versions, capabilityResolution) {
  const dependencies = {
    'nimi-shell-tauri': versions.nimiShellTauriVersion,
    tauri: { version: '2', features: [] },
    serde: { version: '1', features: ['derive'] },
    serde_json: '1',
    url: '2',
    base64: '0.22',
    dirs: '6',
    time: '=0.3.47',
    'tauri-build': { version: '2', features: [] },
  };
  for (const [name, value] of Object.entries(capabilityResolution.cargoDependencies || {})) {
    if (Object.hasOwn(dependencies, name) && canonicalJson(dependencies[name]) !== canonicalJson(value)) {
      throw new Error(`App scaffold base/module Cargo dependency collision for ${name}`);
    }
    dependencies[name] = value;
  }
  for (const [name, value] of Object.entries(dependencies)) {
    validateAppScaffoldCargoDependencyValue(value, name);
  }
  return dependencies;
}

function cargoShellDependencyLine(profile, versions) {
  return `nimi-shell-tauri = ${renderCargoDependencyValue(versions.nimiShellTauriVersion, 'nimi-shell-tauri')}`;
}

export function renderCargoDependencyValue(value, label) {
  validateAppScaffoldCargoDependencyValue(value, label);
  if (typeof value === 'string' && value.trim() === value && value) {
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Cargo dependency descriptor: ${label}`);
  }
  const fields = [];
  for (const key of Object.keys(value).sort()) {
    const field = value[key];
    if (typeof field === 'string' && field.trim() === field && field) {
      fields.push(`${key} = ${JSON.stringify(field)}`);
      continue;
    }
    if (typeof field === 'boolean') {
      fields.push(`${key} = ${field ? 'true' : 'false'}`);
      continue;
    }
    if (Array.isArray(field) && field.every((item) => typeof item === 'string' && item.trim() === item && item)) {
      fields.push(`${key} = [${field.map((item) => JSON.stringify(item)).join(', ')}]`);
      continue;
    }
    throw new Error(`Invalid Cargo dependency value: ${label}.${key}`);
  }
  if (fields.length === 0) throw new Error(`Invalid empty Cargo dependency descriptor: ${label}`);
  return `{ ${fields.join(', ')} }`;
}

function renderCargoManifest(content, profile, versions, identity) {
  let rendered = content.replace(
    /^nimi-shell-tauri\s*=.*$/m,
    cargoShellDependencyLine(profile, versions),
  );
  rendered = rendered.replace(
    /^(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
    `$1${JSON.stringify(identity.version)}`,
  );
  const baseNames = new Set([
    'tauri',
    'nimi-shell-tauri',
    'serde',
    'serde_json',
    'url',
    'base64',
    'dirs',
    'time',
    'tauri-build',
  ]);
  const additions = [];
  for (const [name, value] of Object.entries(identity.capabilityResolution.cargoDependencies || {})) {
    if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new Error(`Invalid Cargo dependency name: ${name}`);
    if (baseNames.has(name)) continue;
    additions.push(`${name} = ${renderCargoDependencyValue(value, name)}`);
  }
  if (additions.length === 0) return rendered;
  const marker = '\n[build-dependencies]';
  if (!rendered.includes(marker)) throw new Error('Generated Cargo manifest is missing [build-dependencies]');
  rendered = rendered.replace(marker, `\n${additions.join('\n')}\n${marker}`);
  return rendered;
}

function targetIdentityMap(identity) {
  return {
    tauriIdentifier: identity.tauriIdentifier,
    packageName: identity.packageName,
    cargoPackageName: identity.cargoPackageName,
    appId: identity.appId,
    appTitle: identity.appTitle,
    appVersion: identity.version,
    appSlug: identity.appSlug,
    rendererEntryId: identity.rendererEntryId,
    accentPack: identity.accentPack,
    devPort: String(identity.devPort),
  };
}

function applyIdentityReplacement(content, manifest, target) {
  const replacements = new Map();
  for (const field of manifest.identityReplacementOrder) {
    if (field === 'rendererEntryId') {
      continue;
    }
    const from = manifest.sourceIdentity[field];
    const to = target[field];
    if (from === undefined || to === undefined) {
      throw new Error(`Identity replacement field missing: ${field}`);
    }
    // The starter intentionally shares some literals (for example packageName
    // and appSlug). The manifest order owns that ambiguity; replacement stays
    // single-pass so the selected target value is never processed again.
    if (replacements.has(from)) continue;
    replacements.set(from, to);
  }
  const sourceEntryId = manifest.sourceIdentity.rendererEntryId;
  const targetEntryId = target.rendererEntryId;
  if (sourceEntryId && targetEntryId) {
    replacements.set(`entry:${sourceEntryId}`, `entry:${targetEntryId}`);
  }
  const pattern = [...replacements.keys()]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|');
  if (!pattern) return content;
  return content.replace(new RegExp(pattern, 'gu'), (value) => replacements.get(value));
}

export function assertIdentityNeutralProductSource(relativePath, content, manifest) {
  const forbidden = [
    'tauriIdentifier',
    'packageName',
    'cargoPackageName',
    'appId',
    'appTitle',
    'appSlug',
    'rendererEntryId',
  ];
  for (const field of forbidden) {
    const value = manifest.sourceIdentity?.[field];
    if (typeof value === 'string' && value && content.includes(value)) {
      throw new Error(`Scaffold product source contains reserved Lab identity: ${relativePath}: ${field}`);
    }
  }
  if (/\bLab-only\b/u.test(content)) {
    throw new Error(`Scaffold product source contains a Lab-only marker: ${relativePath}`);
  }
}

function relativeModuleSpecifier(fromFile, toFile) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function rewriteMappedModuleSpecifiers(content, sourcePath, outputPath, mappings) {
  if (!/\.[cm]?[jt]sx?$/u.test(sourcePath)) return content;
  const pattern = /(\b(?:from|import)\s*(?:\(\s*)?)(['"])(\.\.?\/[^'"]+)\2(\s*\)?)/gu;
  return content.replace(pattern, (whole, prefix, quote, specifier, suffix) => {
    const resolvedSource = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
    const owner = mappings.find((mapping) => (
      resolvedSource === mapping.sourceRoot
      || resolvedSource.startsWith(`${mapping.sourceRoot}/`)
    ));
    if (!owner) {
      throw new Error(`Scaffold product import escapes resolved source ownership: ${sourcePath}: ${specifier}`);
    }
    const sourceSuffix = resolvedSource === owner.sourceRoot
      ? ''
      : resolvedSource.slice(owner.sourceRoot.length + 1);
    const resolvedTarget = sourceSuffix
      ? `${owner.targetRoot}/${sourceSuffix}`
      : owner.targetRoot;
    const rewritten = relativeModuleSpecifier(outputPath, resolvedTarget);
    return `${prefix}${quote}${rewritten}${quote}${suffix}`;
  });
}

function buildNimiAppManifest(identity) {
  return YAML.stringify({
    app_id: identity.appId,
    display_name: identity.appTitle,
    version: identity.version,
    profile: identity.profile,
    manifest_role: 'submitted-input',
    app_access: identity.appAccessItems,
    local_development: {
      electron: {
        renderer_origin: `http://127.0.0.1:${identity.devPort}`,
      },
    },
  }, { lineWidth: 0 });
}

function renderTauriConfig(raw, identity) {
  const config = JSON.parse(raw);
  config.productName = identity.appTitle;
  config.version = identity.version;
  config.identifier = identity.nativeBundleIdentifier;
  config.build = { ...config.build, devUrl: `http://127.0.0.1:${identity.devPort}` };
  config.app = {
    ...config.app,
    windows: Array.isArray(config.app?.windows)
      ? config.app.windows.map((window) => ({ ...window, title: identity.appTitle }))
      : [],
  };
  return jsonFile(config);
}

function renderAppIdentityModule(identity) {
  return [
    `export const appId = ${JSON.stringify(identity.appId)};`,
    `export const appTitle = ${JSON.stringify(identity.appTitle)};`,
    `export const scaffoldProfile = ${JSON.stringify(identity.profile)} as const;`,
    `export const nativeBundleIdentifier = ${JSON.stringify(identity.nativeBundleIdentifier)};`,
    '',
  ].join('\n');
}

function escapeHtmlText(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderIdentitySensitiveStarterFile(relativePath, raw, manifest, identity) {
  if (relativePath === 'src-tauri/tauri.conf.json') {
    return renderTauriConfig(raw, identity);
  }
  if (relativePath === 'src/shell/auth/app-identity.ts') {
    return renderAppIdentityModule(identity);
  }
  if (relativePath === 'index.html') {
    return raw.split(manifest.sourceIdentity.appTitle).join(escapeHtmlText(identity.appTitle));
  }
  return applyIdentityReplacement(raw, manifest, targetIdentityMap(identity));
}

function applyProfileSeam(relativePath, content, profile, versions, manifest, identity) {
  if (relativePath === 'nimi.app.yaml') {
    return buildNimiAppManifest(identity);
  }
  if (relativePath === 'src-tauri/Cargo.toml') {
    return renderCargoManifest(content, profile, versions, identity);
  }
  if (relativePath === 'README.md') {
    return content.replace(/Profile: `standalone`/, `Profile: \`${profile}\``);
  }
  return content;
}

function buildDefaultStarterTemplateFiles(identity, profile, versions) {
  const { baseDir, manifest } = loadDefaultStarterSource();
  const target = targetIdentityMap(identity);
  return manifest.files.map((entry) => {
    const raw = readDefaultStarterSourceFile(baseDir, entry.path);
    const identityApplied = renderIdentitySensitiveStarterFile(entry.path, raw, manifest, identity);
    return {
      path: entry.path,
      content: applyProfileSeam(entry.path, identityApplied, profile, versions, manifest, identity),
      mutationClass: entry.class,
    };
  });
}

function buildCapabilitySliceFiles(identity, profile, versions) {
  if (identity.capabilityResolution.modules.length === 0) return [];
  const { baseDir, manifest } = loadAppSource(identity.capabilityResolution.resolvedModuleIds);
  const mappings = identity.capabilityResolution.modules.flatMap((module) => (
    module.sourceMappings.map((mapping) => ({ ...mapping, ownerId: module.id }))
  ));
  const outputPaths = new Set();
  const files = [];
  for (const module of identity.capabilityResolution.modules) {
    for (const mapping of module.sourceMappings) {
      const sourcePrefix = `${mapping.sourceRoot}/`;
      const selected = manifest.files.filter((entry) => entry.path.startsWith(sourcePrefix));
      if (selected.length === 0) {
        throw new Error(`App scaffold module source is empty: ${module.id}: ${mapping.sourceRoot}`);
      }
      for (const entry of selected) {
        const suffix = entry.path.slice(sourcePrefix.length);
        const outputPath = `${mapping.targetRoot}/${suffix}`;
        if (outputPaths.has(outputPath)) {
          throw new Error(`App scaffold module output collision: ${outputPath}`);
        }
        outputPaths.add(outputPath);
        const raw = readAppSourceFile(baseDir, entry.path);
        assertIdentityNeutralProductSource(entry.path, raw, manifest);
        const rendered = rewriteMappedModuleSpecifiers(raw, entry.path, outputPath, mappings);
        files.push({
          path: outputPath,
          content: applyProfileSeam(outputPath, rendered, profile, versions, manifest, identity),
          mutationClass: 'app-owned product code',
          ownerKind: 'module',
          ownerId: module.id,
        });
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function buildWorkbenchCoreFiles(identity, profile, versions) {
  const { baseDir, manifest } = loadAppSource(identity.capabilityResolution.resolvedModuleIds);
  const sourcePrefix = `${WORKBENCH_CORE_SOURCE_ROOT}/`;
  const selected = manifest.files.filter((entry) => entry.path.startsWith(sourcePrefix));
  if (selected.length === 0) {
    throw new Error('Workbench core source is empty');
  }
  return selected.map((entry) => {
    const raw = readAppSourceFile(baseDir, entry.path);
    assertIdentityNeutralProductSource(entry.path, raw, manifest);
    return {
      path: entry.path,
      content: applyProfileSeam(entry.path, raw, profile, versions, manifest, identity),
      mutationClass: 'app-owned product code',
      ownerKind: 'skeleton',
      ownerId: 'workbench-core',
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export function renderAppIdentityInput(identity) {
  return YAML.stringify({
    app_id: identity.appId,
    display_name: identity.appTitle,
    version: identity.version,
    npm_package_name: identity.packageName,
    cargo_package_name: identity.cargoPackageName,
    tauri_identifier: identity.tauriIdentifier,
    package_author: identity.author || null,
    identity_role: 'scaffold-generated-authoring-input',
  }, { lineWidth: 0 });
}

export function renderAppBuildProfile(options = {}) {
  const identity = options.identity || null;
  const targets = options.targets || (identity ? {
    'windows-x86_64': {
      os: 'windows',
      arch: 'x86_64',
      build_command: 'pnpm run build:electron:production',
      payload_path: `dist-electron-package/${identity.cargoPackageName}-win32-x64`,
      runtime_entry: `payload/${identity.cargoPackageName}.exe`,
    },
  } : undefined);
  return YAML.stringify({
    build_profile_ref: 'electron-packager-pnpm-vite',
    test_command: options.testCommand || 'pnpm run test:app',
    build_command: options.buildCommand || 'pnpm run build:electron:production',
    output_path: 'dist-electron-package',
    lockfile_path: 'pnpm-lock.yaml',
    lockfile_policy: LOCKFILE_POLICY,
    ci_install_command: 'pnpm install --frozen-lockfile',
    ...(targets ? { targets } : {}),
    profile_role: 'developer-workflow-input',
  }, { lineWidth: 0 });
}

export function managedAppReleaseWorkflowSource() {
  return APP_RELEASE_WORKFLOW;
}

export function renderAppSubmissionInput(identity, options = {}) {
  const supportManifest = options.supportManifest || {
    diagnostics_bundle_fields: ['app_version', 'runtime_status'],
    redaction_rules: ['credentials'],
    user_visible_issue_categories: ['startup', 'runtime'],
    escalation_path: 'README.md#support',
    kill_switch_visibility: 'visible',
    recovery_instructions: 'Restart the App from Nimi. If the problem persists, reinstall the current admitted release.',
  };
  return YAML.stringify({
    app_id: identity.appId,
    display_name: identity.appTitle,
    version: identity.version,
    profile: identity.profile,
    npm_package_name: identity.packageName,
    cargo_package_name: identity.cargoPackageName,
    tauri_identifier: identity.tauriIdentifier,
    package_author: identity.author || null,
    submission_role: 'developer-submitted-input',
    capability_contract_refs: options.capabilityContractRefs || [],
    required_standardized_feature_refs: options.requiredStandardizedFeatureRefs || [],
    ...(options.aiProfileRecommendationRef ? { ai_profile_recommendation_ref: options.aiProfileRecommendationRef } : {}),
    storage_policy: options.storagePolicy || { kind: 'nimi-mediated-default' },
    support_manifest: supportManifest,
    review_inputs: {
      manifest: 'nimi.app.yaml',
      build_profile: '.nimi/config/build-profile.yaml',
      scaffold_boundary: '.nimi/contracts/scaffold-boundary.yaml',
    },
    admission_truth: 'platform-owned-after-review',
  }, { lineWidth: 0 });
}

function buildScaffoldBoundary() {
  return YAML.stringify({
    scaffold_contract: 'P-SCAF',
    profile: 'standalone',
    public_admission_truth: 'not-generated',
    developer_release_input: 'candidate-only',
  }, { lineWidth: 0 });
}

function buildStructuredFiles(identity, profile, versions) {
  const files = [
    {
      path: '.gitignore',
      content: GENERATED_GITIGNORE,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'package.json',
      content: jsonFile(buildPackageJson(profile, versions, identity)),
      mutationClass: 'app-owned product code',
    },
    {
      path: '.github/workflows/nimi-app-release.yml',
      content: APP_RELEASE_WORKFLOW,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'nimi.app.yaml',
      content: buildNimiAppManifest(identity),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: '.nimi/config/app-identity.yaml',
      content: renderAppIdentityInput(identity),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: '.nimi/config/build-profile.yaml',
      content: renderAppBuildProfile({ identity }),
      mutationClass: 'app-owned product code',
    },
    {
      path: '.nimi/admission/submission.yaml',
      content: renderAppSubmissionInput(identity, {
        capabilityContractRefs: identity.capabilityResolution.capabilityContractRefs,
        requiredStandardizedFeatureRefs: identity.capabilityResolution.requiredStandardizedFeatureRefs,
      }),
      mutationClass: 'app-owned product code',
    },
    {
      path: '.nimi/contracts/scaffold-boundary.yaml',
      content: buildScaffoldBoundary(),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src-tauri/icons/icon.png',
      content: MINIMAL_TAURI_ICON_PNG,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src-tauri/icons/icon.ico',
      content: MINIMAL_TAURI_ICON_ICO,
      mutationClass: 'scaffold-managed glue',
    },
  ];
  return files;
}

function buildIdentityMapping(identity, targetDir = '') {
  return {
    appId: identity.appId,
    displayName: identity.appTitle,
    version: identity.version,
    npmPackageName: identity.packageName,
    author: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    nativeBundleIdentifier: identity.nativeBundleIdentifier,
    tauriIdentifier: identity.tauriIdentifier,
    appSlug: identity.appSlug,
    rendererEntryId: identity.rendererEntryId,
    devPort: identity.devPort,
    devRendererOrigin: `http://127.0.0.1:${identity.devPort}`,
    appOwnedNamespace: identity.appOwnedNamespace,
    targetDir: targetDir || null,
  };
}

function buildScaffoldIntent(identity, versions, targetDir = '') {
  return {
    intentVersion: SCAFFOLD_INTENT_VERSION,
    scaffoldVersion: SCAFFOLD_VERSION,
    initRequired: true,
    initCommand: 'pnpm exec nimi-app init',
    initOrder: ['nimi-app create', 'pnpm install', 'pnpm exec nimi-app init'],
    profile: identity.profile,
    appId: identity.appId,
    appTitle: identity.appTitle,
    version: identity.version,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    accentPack: identity.accentPack,
    features: identity.features,
    directFeatures: identity.capabilityResolution.directFeatureIds,
    resolvedModules: identity.capabilityResolution.resolvedModuleIds,
    resolvedViews: identity.capabilityResolution.views,
    resolvedNavigation: identity.capabilityResolution.navigation,
    resolvedStyles: identity.capabilityResolution.styles,
    resolvedAssets: identity.capabilityResolution.assets,
    hostAdapterContracts: identity.capabilityResolution.hostAdapterContracts,
    appAccessItems: identity.appAccessItems,
    capabilityContractRefs: identity.capabilityResolution.capabilityContractRefs,
    requiredStandardizedFeatureRefs: identity.capabilityResolution.requiredStandardizedFeatureRefs,
    devPort: identity.devPort,
    appIdentity: buildIdentityMapping(identity, targetDir),
    dependencyMatrix: buildDependencyMatrix(identity.profile, versions, identity.capabilityResolution),
    semantics: {
      role: 'app-scaffold-init-input',
      authority: 'app-tools-orchestration-input-not-platform-admission',
      nimicodingProjectionOwner: '@nimiplatform/nimi-coding',
    },
  };
}

function buildScaffoldIntentFile(identity, versions, targetDir = '') {
  return {
    path: SCAFFOLD_INTENT_PATH,
    content: jsonFile(buildScaffoldIntent(identity, versions, targetDir)),
    mutationClass: 'scaffold-managed glue',
    ownerKind: 'scaffold-state',
    ownerId: 'intent',
  };
}

function withFileOwner(files, ownerKind, ownerId) {
  return files.map((file) => ({
    ...file,
    ownerKind: file.ownerKind ?? ownerKind,
    ownerId: file.ownerId ?? ownerId,
  }));
}

function buildScaffoldFiles(identity, versions) {
  return [
    ...withFileOwner(
      buildStructuredFiles(identity, identity.profile, versions),
      'carrier',
      'structured',
    ),
    ...withFileOwner(
      buildDefaultStarterTemplateFiles(identity, identity.profile, versions),
      'carrier',
      'default-starter',
    ),
    ...withFileOwner(buildDefaultStarterFiles(identity), 'generated-glue', 'composition'),
    ...buildWorkbenchCoreFiles(identity, identity.profile, versions),
    ...buildCapabilitySliceFiles(identity, identity.profile, versions),
  ];
}

export function validateScaffoldFileOwnership(files) {
  const filesByPath = new Map();
  const filesByCollisionKey = new Map();
  for (const file of files) {
    const relativePath = String(file?.path || '');
    if (
      !relativePath
      || relativePath.startsWith('/')
      || relativePath.endsWith('/')
      || relativePath.includes('\\')
      || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      || path.posix.normalize(relativePath) !== relativePath
    ) {
      throw new Error(`Scaffold file path is invalid: ${relativePath || 'missing'}`);
    }
    if (!file.ownerKind || !file.ownerId) {
      throw new Error(`Scaffold file ownership is missing: ${relativePath}`);
    }
    const collisionKey = relativePath.toLowerCase();
    const existing = filesByCollisionKey.get(collisionKey);
    if (existing) {
      throw new Error(
        `Scaffold file ownership collision: ${existing.path} and ${relativePath}: ${existing.ownerKind}/${existing.ownerId} and ${file.ownerKind}/${file.ownerId}`,
      );
    }
    filesByCollisionKey.set(collisionKey, file);
    filesByPath.set(relativePath, file);
  }
  for (const [relativePath, file] of filesByPath) {
    const segments = relativePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index).join('/');
      const prefixFile = filesByCollisionKey.get(prefix.toLowerCase());
      if (prefixFile) {
        throw new Error(
          `Scaffold file/directory prefix collision: ${prefix}: ${prefixFile.ownerKind}/${prefixFile.ownerId} and ${file.ownerKind}/${file.ownerId}`,
        );
      }
    }
  }
  return filesByPath;
}

function normalizePathList(paths) {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function hashScaffoldContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function buildDependencyMatrix(profile, versions, capabilityResolution) {
  return {
    npm: {
      '@nimiplatform/app-tools': versions.appToolsVersion,
      '@nimiplatform/nimi-coding': versions.nimicodingVersion,
      ...buildRuntimeDependencies(profile, versions, capabilityResolution),
      typescript: versions.typescriptVersion,
      vite: versions.viteVersion,
      tailwindcss: versions.tailwindcssVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@tailwindcss/vite': versions.tailwindcssViteVersion,
      '@vitejs/plugin-react': versions.viteReactPluginVersion,
      '@electron/packager': versions.electronPackagerVersion,
      electron: versions.electronVersion,
      esbuild: versions.esbuildVersion,
      yaml: versions.yamlVersion,
    },
    cargo: buildCargoDependencies(profile, versions, capabilityResolution),
    toolchain: {
      node: '>=24',
      pnpm: versions.packageManager.replace(/^pnpm@/u, ''),
      rust: '>=1.80',
      tauri: '2',
    },
  };
}

function buildScaffoldLock(identity, versions, files, targetDir = '') {
  const taxonomy = {
    'package-owned projection': [],
    'scaffold-managed glue': [],
    'app-owned product code': [],
  };
  const managedFileHashes = {};
  const appOwnedInitialHashes = {};

  for (const file of files) {
    const mutationClass = file.mutationClass;
    taxonomy[mutationClass].push(file.path);
    const digest = hashScaffoldContent(file.content);
    if (mutationClass === 'app-owned product code') {
      appOwnedInitialHashes[file.path] = {
        class: mutationClass,
        sha256: digest,
      };
      continue;
    }
    managedFileHashes[file.path] = {
      class: mutationClass,
      sha256: digest,
    };
  }

  return {
    lockVersion: SCAFFOLD_LOCK_VERSION,
    scaffoldVersion: SCAFFOLD_VERSION,
    profile: identity.profile,
    appId: identity.appId,
    appTitle: identity.appTitle,
    version: identity.version,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    accentPack: identity.accentPack,
    appAccessItems: identity.appAccessItems,
    capabilityContractRefs: identity.capabilityResolution.capabilityContractRefs,
    requiredStandardizedFeatureRefs: identity.capabilityResolution.requiredStandardizedFeatureRefs,
    features: identity.features,
    directFeatures: identity.capabilityResolution.directFeatureIds,
    resolvedModules: identity.capabilityResolution.resolvedModuleIds,
    resolvedViews: identity.capabilityResolution.views,
    resolvedNavigation: identity.capabilityResolution.navigation,
    resolvedStyles: identity.capabilityResolution.styles,
    resolvedAssets: identity.capabilityResolution.assets,
    hostAdapterContracts: identity.capabilityResolution.hostAdapterContracts,
    appIdentity: buildIdentityMapping(identity, targetDir),
    managedFileTaxonomy: {
      packageOwnedProjection: normalizePathList(taxonomy['package-owned projection']),
      scaffoldManagedGlue: normalizePathList(taxonomy['scaffold-managed glue']),
      appOwnedProductCode: normalizePathList(taxonomy['app-owned product code']),
    },
    managedFileHashes,
    appOwnedInitialHashes,
    dependencyMatrix: buildDependencyMatrix(identity.profile, versions, identity.capabilityResolution),
    semantics: {
      initRole: 'developer-scaffold-initialization-after-install',
      nimicodingProjectionOwner: '@nimiplatform/nimi-coding',
      nimicodingApplyCommand: 'pnpm exec nimicoding sync --apply --json',
      nimicodingCheckCommand: 'pnpm exec nimicoding sync --check --json',
      syncAndCheckRole: 'developer-scaffold-maintenance-only',
      lockfilePolicy: LOCKFILE_POLICY,
      ignoredVerificationArtifacts: ['dist/'],
      capabilityComposition: 'base-plus-selected-dependency-closure',
    },
  };
}

function buildAppScaffoldSnapshotWithResolver(
  { profile, versions, appId, appTitle, version = DEFAULT_APP_VERSION, packageName, author, accentPack, features, targetDir = '' },
  featureResolver,
) {
  const identity = buildAppIdentity(
    profile,
    appId,
    appTitle,
    version,
    packageName,
    author,
    accentPack,
    features,
    featureResolver,
  );
  const createFiles = [
    ...buildScaffoldFiles(identity, versions),
    buildScaffoldIntentFile(identity, versions, targetDir),
  ];
  validateScaffoldFileOwnership(createFiles);
  const filesWithoutLock = [...createFiles];
  const lock = buildScaffoldLock(identity, versions, filesWithoutLock, targetDir);
  const initFiles = [
    {
      path: SCAFFOLD_LOCK_PATH,
      content: jsonFile(lock),
      mutationClass: 'scaffold-managed glue',
      ownerKind: 'scaffold-state',
      ownerId: 'lock',
    },
  ];
  const allFiles = [
    ...createFiles,
    ...initFiles,
  ];
  const filesByPath = validateScaffoldFileOwnership(allFiles);
  return {
    appId: identity.appId,
    appTitle: identity.appTitle,
    version: identity.version,
    profile: identity.profile,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    features: identity.features,
    files: allFiles,
    createFiles,
    initFiles,
    filesWithoutLock,
    lock,
    filesByPath,
  };
}

export function buildAppScaffoldSnapshot(input) {
  return buildAppScaffoldSnapshotWithResolver(input, resolveAppScaffoldFeatures);
}

export function buildAppScaffoldCandidateSnapshot(input) {
  return buildAppScaffoldSnapshotWithResolver(input, resolveAppScaffoldCandidateFeatures);
}

export function buildAppScaffoldSnapshotFromIntent({ intent, versions, targetDir = '', allowDerivedAppAccessDrift = false }) {
  if (intent?.intentVersion !== SCAFFOLD_INTENT_VERSION) {
    throw new Error(`Unsupported scaffold intent version: ${String(intent?.intentVersion || 'missing')}`);
  }
  if (intent?.scaffoldVersion !== SCAFFOLD_VERSION) {
    throw new Error(`Unsupported scaffold intent version source: ${String(intent?.scaffoldVersion || 'missing')}`);
  }
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(intent?.profile)) {
    throw new Error(`Unsupported scaffold profile: ${String(intent?.profile || 'missing')}`);
  }
  const canonicalTargetDir = targetDir || intent?.appIdentity?.targetDir || '';
  const snapshot = buildAppScaffoldSnapshotWithResolver({
    profile: intent.profile,
    versions,
    appId: intent.appId,
    appTitle: intent.appTitle,
    version: intent.version,
    packageName: intent.packageName,
    author: intent.packageAuthor || '',
    accentPack: intent.accentPack || 'nimi-accent',
    features: intent.directFeatures,
    targetDir: canonicalTargetDir,
  }, resolveAppScaffoldIntentFeatures);
  const expectedIntent = JSON.parse(snapshot.filesByPath.get(SCAFFOLD_INTENT_PATH).content);
  const comparableIntent = allowDerivedAppAccessDrift
    ? { ...intent, appAccessItems: expectedIntent.appAccessItems }
    : intent;
  if (canonicalJson(comparableIntent) !== canonicalJson(expectedIntent)) {
    throw new Error('Scaffold intent does not match the current canonical resolved intent');
  }
  return snapshot;
}

function buildAppScaffoldCreatePlanWithResolver(
  { cwd, options = {}, versions, topology = null },
  featureResolver,
) {
  const resolvedInput = resolveAppScaffoldCreateInputWithResolver({ cwd, options }, featureResolver);
  const snapshot = buildAppScaffoldSnapshotWithResolver({
    profile: resolvedInput.profile,
    versions,
    appId: resolvedInput.appId,
    appTitle: resolvedInput.appTitle,
    version: resolvedInput.version,
    packageName: resolvedInput.packageName,
    author: resolvedInput.author,
    accentPack: resolvedInput.accentPack,
    features: resolvedInput.directFeatures,
    targetDir: resolvedInput.targetDir,
  }, featureResolver);
  return Object.freeze({
    resolvedInput,
    snapshot,
    preview: Object.freeze({
      targetDir: resolvedInput.targetDir,
      profile: resolvedInput.profile,
      identity: snapshot.lock.appIdentity,
      directFeatures: snapshot.lock.directFeatures,
      resolvedModules: snapshot.lock.resolvedModules,
      resolvedViews: snapshot.lock.resolvedViews,
      resolvedNavigation: snapshot.lock.resolvedNavigation,
      resolvedStyles: snapshot.lock.resolvedStyles,
      resolvedAssets: snapshot.lock.resolvedAssets,
      hostAdapterContracts: snapshot.lock.hostAdapterContracts,
      npmDependencies: snapshot.lock.dependencyMatrix.npm,
      cargoDependencies: snapshot.lock.dependencyMatrix.cargo,
      appAccessItems: snapshot.lock.appAccessItems,
      topology,
    }),
  });
}

export function buildAppScaffoldCreatePlan(input) {
  return buildAppScaffoldCreatePlanWithResolver(input, resolveAppScaffoldFeatures);
}

export function buildAppScaffoldCandidateCreatePlan(input) {
  return buildAppScaffoldCreatePlanWithResolver(input, resolveAppScaffoldCandidateFeatures);
}

export function createAppScaffold(input) {
  const { cwd, options, versions, createFileTree, ensureDirEmptyOrMissing } = input;
  const plan = input.plan || buildAppScaffoldCreatePlan({ cwd, options, versions });
  const { targetDir, profile } = plan.resolvedInput;
  const { snapshot } = plan;
  ensureDirEmptyOrMissing(targetDir);
  // Resolution, source collection and every structured serialization complete
  // before a missing target directory is materialized.
  try {
    input.mkdirSync(targetDir, { recursive: true });
    createFileTree(targetDir, snapshot.createFiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown filesystem failure');
    throw new Error(`Scaffold materialization failed; inspect the exact residual target ${targetDir}: ${message}`);
  }
  const payload = {
    ok: true,
    command: 'create',
    dir: targetDir,
    profile,
    preview: plan.preview,
  };
  if (!options.silent) {
    process.stdout.write(`[nimi-app] created ${profile} app scaffold at ${targetDir}\n`);
    process.stdout.write('[nimi-app] next: pnpm install && pnpm run init\n');
  }
  return payload;
}

export function createAppScaffoldCandidate(input) {
  const plan = input.plan || buildAppScaffoldCandidateCreatePlan(input);
  return createAppScaffold({ ...input, plan });
}
