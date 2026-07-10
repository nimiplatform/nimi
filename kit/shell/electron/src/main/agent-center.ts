import crypto from 'node:crypto';
import path from 'node:path';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { createElectronCapabilityUnavailableError, errorMessage } from './errors.js';
import { resolveElectronStandardDataRoot } from './data-root-binding.js';
import { asRecord, canonicalElectronPathCandidate, isSameOrChildPath, normalizeRequiredToken, normalizeText } from './paths.js';
import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';

type AvatarBackendKind = 'live2d' | 'vrm';
type ValidationStatus = 'valid' | 'invalid' | 'not_checked';

const MAX_AVATAR_ASSET_BYTES = 524_288_000;
const MAX_AVATAR_ASSET_FILE_BYTES = 104_857_600;
const MAX_AVATAR_ASSET_FILE_COUNT = 2_048;
const MAX_BACKGROUND_BYTES = 20_971_520;

type Scope = {
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

type SourceFile = {
  readonly sourcePath: string;
  readonly packagePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mime: string;
};

type AgentCenterDispatchHandler = (
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) => Promise<unknown>;

const AGENT_CENTER_DISPATCH = {
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']]: importAvatarAsset,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate']]: validateAvatarAsset,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview']]: resolveAvatarAssetPreview,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport']]: importLive2dAdapterManifest,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']]: importBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet']]: getBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate']]: validateBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove']]: removeBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove']]: removeAgentResources,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove']]: removeAccountResources,
} as const satisfies Readonly<Record<string, AgentCenterDispatchHandler>>;

type AgentCenterDispatchCommand = Extract<keyof typeof AGENT_CENTER_DISPATCH, string>;

export async function dispatchElectronAgentCenterCommand(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
}): Promise<unknown> {
  const { command, host, payload } = input;
  if (isElectronAgentCenterCommand(command)) {
    const handler = AGENT_CENTER_DISPATCH[command];
    return handler(host, parseElectronAgentCenterPayload(command, payload), command);
  }
  throw createElectronCapabilityUnavailableError(command);
}

export function isElectronAgentCenterCommand(command: string): command is AgentCenterDispatchCommand {
  return Object.hasOwn(AGENT_CENTER_DISPATCH, command);
}

function parseElectronAgentCenterPayload(
  command: AgentCenterDispatchCommand,
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidPayload(command, 'payload must be an object');
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove']) {
    return exactPayload(payload, {
      hostScope: 'account',
      accountId: parseAccountScope(payload, command),
    }, command);
  }

  const scope = parseLocalAgentScope(payload, command);
  const common = { hostScope: 'local-agent', ...scope } as const;
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']) {
    return exactPayload(payload, {
      ...common,
      sourcePath: parseSourcePath(payload.sourcePath, command),
      backendKind: parseBackendKind(payload.backendKind, command),
    }, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate']) {
    return exactPayload(payload, {
      ...common,
      avatarAssetRef: parseAvatarAssetRef(payload.avatarAssetRef, command),
    }, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview']) {
    const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
    const canonical: Record<string, unknown> = {
      ...common,
      avatarAssetRef,
    };
    if (payload.backendKind !== undefined) {
      const backendKind = parseBackendKind(payload.backendKind, command);
      if (!avatarAssetRef.startsWith(`${backendKind}_`)) {
        throw invalidPayload(command, 'backendKind must match avatarAssetRef');
      }
      canonical.backendKind = backendKind;
    }
    return exactPayload(payload, canonical, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport']) {
    const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
    if (!avatarAssetRef.startsWith('live2d_')) {
      throw invalidPayload(command, 'avatarAssetRef must reference a Live2D avatar asset');
    }
    return exactPayload(payload, {
      ...common,
      avatarAssetRef,
      sourcePath: parseSourcePath(payload.sourcePath, command),
    }, command);
  }
  if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']) {
    return exactPayload(payload, {
      ...common,
      sourcePath: parseSourcePath(payload.sourcePath, command),
    }, command);
  }
  if (
    command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet']
    || command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate']
    || command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove']
  ) {
    return exactPayload(payload, {
      ...common,
      backgroundAssetRef: parseBackgroundAssetRef(payload.backgroundAssetRef, command),
    }, command);
  }
  return exactPayload(payload, common, command);
}

function exactPayload(
  raw: Readonly<Record<string, unknown>>,
  canonical: Readonly<Record<string, unknown>>,
  command: string,
): Readonly<Record<string, unknown>> {
  const actualKeys = Object.keys(raw).sort();
  const expectedKeys = Object.keys(canonical).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidPayload(command, `payload keys must be exactly: ${expectedKeys.join(', ')}`);
  }
  return canonical;
}

async function importAvatarAsset(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await standardDataRoot(host, command);
  const scope = parseLocalAgentScope(payload, command);
  const kind = parseBackendKind(payload.backendKind, command);
  const source = await userSelectedSource(host, payload.sourcePath, command);
  const files = await readAvatarSourceFiles(kind, source, command);
  const contentDigest = avatarContentDigest(files.records);
  const avatarAssetRef = `${kind}_${contentDigest.slice(0, 12)}`;
  const finalDir = avatarAssetDir(dataRoot, scope, kind, avatarAssetRef);
  if (await exists(finalDir)) {
    const validation = await validateAvatarAssetAt(finalDir, avatarAssetRef, kind);
    return avatarImportResult(avatarAssetRef, kind, validation);
  }
  const stagingDir = path.join(agentCenterDir(dataRoot, scope), 'modules', 'avatar_asset', 'staging', `${avatarAssetRef}_${Date.now()}`);
  await rm(stagingDir, { recursive: true, force: true });
  try {
    for (const file of files.records) {
      const target = path.join(stagingDir, file.packagePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.sourcePath, target);
    }
    await writeJson(path.join(stagingDir, 'manifest.json'), {
      manifest_version: 1,
      local_asset_id: avatarAssetRef,
      kind,
      entry_file: files.entryFile,
      required_files: [files.entryFile],
      content_digest: `sha256:${contentDigest}`,
      files: files.records.map((file) => ({
        path: file.packagePath,
        sha256: file.sha256,
        bytes: file.bytes,
        mime: file.mime,
      })),
      import: {
        imported_at: new Date().toISOString(),
        source_label: path.basename(source),
      },
    });
    const validation = await validateAvatarAssetAt(stagingDir, avatarAssetRef, kind);
    if (validation.validationStatus !== 'valid') {
      throw invalidAsset(command, validation.validationMessage ?? 'Avatar asset validation failed');
    }
    await mkdir(path.dirname(finalDir), { recursive: true });
    await rename(stagingDir, finalDir);
    return avatarImportResult(avatarAssetRef, kind, await validateAvatarAssetAt(finalDir, avatarAssetRef, kind));
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function validateAvatarAsset(host: NimiElectronStandardShellHost | undefined, payload: Readonly<Record<string, unknown>>, command: string) {
  const dataRoot = await standardDataRoot(host, command);
  parseLocalAgentScope(payload, command);
  const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
  const kind = kindFromAvatarRef(avatarAssetRef);
  const dir = await findAvatarAssetDir(dataRoot, avatarAssetRef, kind);
  const validation = dir
    ? await validateAvatarAssetAt(dir, avatarAssetRef, kind)
    : { validationStatus: 'invalid' as const, validationMessage: 'Avatar asset was not found.' };
  return {
    avatarAssetRef,
    backendKind: kind,
    backendCapabilityProfileRef: backendCapabilityProfileRefFor(kind, avatarAssetRef),
    validationIssueRows: validation.validationMessage ? [validation.validationMessage] : [],
    ...validation,
  };
}

async function resolveAvatarAssetPreview(host: NimiElectronStandardShellHost | undefined, payload: Readonly<Record<string, unknown>>, command: string) {
  const result = await validateAvatarAsset(host, payload, command) as {
    avatarAssetRef: string;
    backendKind: AvatarBackendKind;
    validationStatus: ValidationStatus;
    validationMessage?: string;
  };
  return {
    avatarAssetRef: result.avatarAssetRef,
    backendKind: result.backendKind,
    previewArtifactRef: `agent-center-preview:${result.backendKind}:${result.avatarAssetRef}`,
    validationStatus: result.validationStatus,
    validationMessage: result.validationMessage,
    warnings: [],
  };
}

async function importLive2dAdapterManifest(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await standardDataRoot(host, command);
  parseLocalAgentScope(payload, command);
  const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
  if (!avatarAssetRef.startsWith('live2d_')) {
    throw invalidPayload(command, 'avatarAssetRef must reference a Live2D avatar asset');
  }
  const source = await userSelectedSource(host, payload.sourcePath, command);
  if (path.extname(source).toLowerCase() !== '.json') {
    throw invalidPayload(command, 'Live2D adapter manifest source must be JSON');
  }
  const raw = await readFile(source);
  const parsed = asRecord(JSON.parse(raw.toString('utf8')), 'Live2D adapter manifest must be an object');
  if (parsed.manifest_kind !== 'nimi.avatar.live2d.adapter' || parsed.schema_version !== 1) {
    throw invalidPayload(command, 'Live2D adapter manifest_kind/schema_version is not admitted');
  }
  const manifestRef = `live2d_adapter_${sha256(raw).slice(0, 12)}`;
  const avatarDir = await findAvatarAssetDir(dataRoot, avatarAssetRef, 'live2d');
  if (!avatarDir) {
    throw notFound(command, `Avatar asset was not found: ${avatarAssetRef}`);
  }
  const agentRoot = findAgentCenterRootFromAssetDir(avatarDir);
  const finalDir = path.join(agentRoot, 'modules', 'avatar_asset', 'adapter_manifests', manifestRef);
  await mkdir(finalDir, { recursive: true });
  await writeFile(path.join(finalDir, 'live2d-adapter.json'), raw);
  await writeJson(path.join(finalDir, 'custody.json'), {
    custody_version: 1,
    manifest_ref: manifestRef,
    local_asset_id: avatarAssetRef,
    manifest_kind: 'nimi.avatar.live2d.adapter',
    schema_version: 1,
    sha256: sha256(raw),
    bytes: raw.byteLength,
    imported_at: new Date().toISOString(),
    source_label: path.basename(source),
  });
  return {
    avatarAssetRef,
    live2dAdapterManifestRef: manifestRef,
    live2dAdapterManifestSource: 'external_sidecar_manifest',
  };
}

async function importBackground(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await standardDataRoot(host, command);
  const scope = parseLocalAgentScope(payload, command);
  const source = await userSelectedSource(host, payload.sourcePath, command);
  const mimeType = backgroundMime(source, command);
  const bytes = await readFile(source);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BACKGROUND_BYTES) {
    throw invalidPayload(command, 'Background image is outside the fixed byte cap');
  }
  const backgroundAssetRef = `bg_${sha256(bytes).slice(0, 12)}`;
  const finalDir = backgroundDir(dataRoot, scope, backgroundAssetRef);
  if (!await exists(finalDir)) {
    await mkdir(finalDir, { recursive: true });
    const imageFile = `image${path.extname(source).toLowerCase()}`;
    await writeFile(path.join(finalDir, imageFile), bytes);
    await writeJson(path.join(finalDir, 'manifest.json'), {
      manifest_version: 1,
      background_asset_id: backgroundAssetRef,
      image_file: imageFile,
      mime: mimeType,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      imported_at: new Date().toISOString(),
      source_label: path.basename(source),
    });
  }
  return {
    backgroundAssetRef,
    validationStatus: 'valid',
  };
}

async function getBackground(host: NimiElectronStandardShellHost | undefined, payload: Readonly<Record<string, unknown>>, command: string) {
  const dataRoot = await standardDataRoot(host, command);
  parseLocalAgentScope(payload, command);
  const backgroundAssetRef = parseBackgroundAssetRef(payload.backgroundAssetRef, command);
  const found = await findBackground(dataRoot, backgroundAssetRef);
  if (!found) {
    throw notFound(command, `Background asset was not found: ${backgroundAssetRef}`);
  }
  const manifest = await readManifest(found.dir);
  const imageFile = normalizeText(manifest.image_file);
  const filePath = path.join(found.dir, imageFile);
  const canonical = await canonicalElectronPathCandidate(filePath);
  await host?.localAssetProtocolHost?.registerReadableFile(canonical);
  return {
    backgroundAssetRef,
    url: host?.localAssetProtocolHost?.resolveLocalAssetUrl(canonical) ?? canonical,
    mimeType: normalizeText(manifest.mime) || backgroundMime(canonical, command),
  };
}

async function validateBackground(host: NimiElectronStandardShellHost | undefined, payload: Readonly<Record<string, unknown>>, command: string) {
  const dataRoot = await standardDataRoot(host, command);
  parseLocalAgentScope(payload, command);
  const backgroundAssetRef = parseBackgroundAssetRef(payload.backgroundAssetRef, command);
  const found = await findBackground(dataRoot, backgroundAssetRef);
  return {
    backgroundAssetRef,
    validationStatus: found ? 'valid' : 'invalid',
    validationMessage: found ? undefined : 'Background asset was not found.',
  };
}

async function removeBackground(host: NimiElectronStandardShellHost | undefined, payload: Readonly<Record<string, unknown>>, command: string) {
  const dataRoot = await standardDataRoot(host, command);
  parseLocalAgentScope(payload, command);
  const backgroundAssetRef = parseBackgroundAssetRef(payload.backgroundAssetRef, command);
  const found = await findBackground(dataRoot, backgroundAssetRef);
  if (!found) {
    return { removed: false, backgroundAssetRef };
  }
  await quarantine(found.agentRoot, found.dir, 'background', backgroundAssetRef);
  return { removed: true, backgroundAssetRef };
}

async function removeAgentResources(host: NimiElectronStandardShellHost | undefined, payload: Readonly<Record<string, unknown>>, command: string) {
  const dataRoot = await standardDataRoot(host, command);
  const scope = parseLocalAgentScope(payload, command);
  const root = agentCenterDir(dataRoot, scope);
  if (!await exists(root)) {
    return { removed: false };
  }
  await quarantine(path.dirname(root), root, 'agent_local_resources', scope.localAgentRef);
  return { removed: true };
}

async function removeAccountResources(host: NimiElectronStandardShellHost | undefined, payload: Readonly<Record<string, unknown>>, command: string) {
  const dataRoot = await standardDataRoot(host, command);
  const accountId = parseAccountScope(payload, command);
  const root = accountDir(dataRoot, accountId);
  if (!await exists(root)) {
    return { removed: false };
  }
  await quarantine(path.dirname(root), root, 'account_local_resources', accountId);
  return { removed: true };
}

async function standardDataRoot(host: NimiElectronStandardShellHost | undefined, command: string): Promise<string> {
  return resolveElectronStandardDataRoot(host, command);
}

function parseLocalAgentScope(payload: Readonly<Record<string, unknown>>, command: string): Scope {
  const hostScope = typeof payload.hostScope === 'string' ? payload.hostScope.trim() : '';
  if (hostScope !== 'local-agent') {
    throw invalidPayload(command, 'Agent Center asset custody requires hostScope=local-agent');
  }
  const scope = {
    accountId: validateId(payload.accountId, 'accountId', command),
    ownerUserId: validateId(payload.ownerUserId, 'ownerUserId', command),
    runtimeSourceRef: validateId(payload.runtimeSourceRef, 'runtimeSourceRef', command),
    localAgentRef: validateId(payload.localAgentRef, 'localAgentRef', command),
  };
  if (!scope.localAgentRef.startsWith('local-agent:')) {
    throw invalidPayload(command, 'localAgentRef must start with local-agent:');
  }
  if (scope.localAgentRef === scope.runtimeSourceRef) {
    throw invalidPayload(command, 'localAgentRef must differ from runtimeSourceRef');
  }
  return scope;
}

function parseAccountScope(payload: Readonly<Record<string, unknown>>, command: string): string {
  const hostScope = typeof payload.hostScope === 'string' ? payload.hostScope.trim() : '';
  if (hostScope !== 'account') {
    throw invalidPayload(command, 'Account resource cleanup requires hostScope=account');
  }
  return validateId(payload.accountId, 'accountId', command);
}

function validateId(value: unknown, field: string, command: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidPayload(command, `${field} is required`);
  }
  const normalized = value.trim();
  if (
    normalized.length > 256
    || normalized === '.'
    || normalized === '..'
    || normalized.includes('://')
    || !/[A-Za-z0-9]/u.test(normalized)
    || !/^[A-Za-z0-9_.~:@+-]+$/u.test(normalized)
  ) {
    throw invalidPayload(command, `${field} is not an admitted opaque identifier`);
  }
  return normalized;
}

function parseBackendKind(value: unknown, command: string): AvatarBackendKind {
  const kind = parseRequiredPayloadText(value, 'backendKind', command);
  if (kind !== 'live2d' && kind !== 'vrm') {
    throw invalidPayload(command, 'backendKind must be live2d or vrm');
  }
  return kind;
}

function parseAvatarAssetRef(value: unknown, command: string): string {
  const ref = parseRequiredPayloadText(value, 'avatarAssetRef', command);
  if (!/^(live2d|vrm)_[a-f0-9]{12}$/u.test(ref)) {
    throw invalidPayload(command, 'avatarAssetRef is invalid');
  }
  return ref;
}

function parseBackgroundAssetRef(value: unknown, command: string): string {
  const ref = parseRequiredPayloadText(value, 'backgroundAssetRef', command);
  if (!/^bg_[a-f0-9]{12}$/u.test(ref)) {
    throw invalidPayload(command, 'backgroundAssetRef is invalid');
  }
  return ref;
}

function parseSourcePath(value: unknown, command: string): string {
  return parseRequiredPayloadText(value, 'sourcePath', command);
}

function parseRequiredPayloadText(value: unknown, field: string, command: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidPayload(command, `${field} is required`);
  }
  return value.trim();
}

function kindFromAvatarRef(ref: string): AvatarBackendKind {
  return ref.startsWith('live2d_') ? 'live2d' : 'vrm';
}

async function userSelectedSource(host: NimiElectronStandardShellHost | undefined, value: unknown, command: string): Promise<string> {
  const raw = path.resolve(normalizeRequiredToken(value, 'sourcePath'));
  const source = await canonicalElectronPathCandidate(raw);
  const protocolHost = host?.localAssetProtocolHost;
  if (!protocolHost) {
    throw createElectronCapabilityUnavailableError(command);
  }
  if (!await protocolHost.hasReadableFile(source)) {
    throw new NimiElectronShellHostError({
      code: 'forbidden-renderer-access',
      message: `Agent Center source path was not selected through the standard file dialog: ${source}`,
      reasonCode: 'electron-agent-center-source-not-from-file-dialog',
      actionHint: 'select_agent_center_import_source_with_standard_file_dialog',
      details: { command, source },
    });
  }
  return source;
}

async function readAvatarSourceFiles(kind: AvatarBackendKind, source: string, command: string): Promise<{
  readonly records: readonly SourceFile[];
  readonly entryFile: string;
}> {
  const sourceStat = await stat(source);
  if (kind === 'vrm') {
    if (!sourceStat.isFile() || path.extname(source).toLowerCase() !== '.vrm') {
      throw invalidPayload(command, 'VRM source must be a .vrm file');
    }
    const record = await sourceFileRecord(source, `files/${path.basename(source)}`, 'model/vrm', command);
    return { records: [record], entryFile: record.packagePath };
  }
  if (!sourceStat.isDirectory()) {
    throw invalidPayload(command, 'Live2D source must be a directory');
  }
  const allFiles = await collectFiles(source, source, command);
  const modelEntries = allFiles.filter((file) => file.endsWith('.model3.json')).sort();
  if (modelEntries.length !== 1) {
    throw invalidPayload(command, 'Live2D source folder must contain exactly one .model3.json file');
  }
  const records = await Promise.all(allFiles.map(async (file) => {
    const relative = path.relative(source, file).split(path.sep).join('/');
    return sourceFileRecord(file, `files/${relative}`, avatarMime(file, kind), command);
  }));
  if (records.length > MAX_AVATAR_ASSET_FILE_COUNT) {
    throw invalidPayload(command, 'Avatar source contains too many files');
  }
  const total = records.reduce((sum, file) => sum + file.bytes, 0);
  if (total === 0 || total > MAX_AVATAR_ASSET_BYTES) {
    throw invalidPayload(command, 'Avatar source package is outside the fixed byte cap');
  }
  const entryFile = `files/${path.relative(source, modelEntries[0] ?? '').split(path.sep).join('/')}`;
  return { records: records.sort((a, b) => a.packagePath.localeCompare(b.packagePath)), entryFile };
}

async function collectFiles(root: string, current: string, command: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw invalidPayload(command, 'Agent Center import sources must not contain symlinks');
    }
    if (entry.isDirectory()) {
      out.push(...await collectFiles(root, target, command));
    } else if (entry.isFile()) {
      const canonical = await canonicalElectronPathCandidate(target);
      if (!isSameOrChildPath(root, canonical)) {
        throw invalidPayload(command, 'Agent Center import source escaped its root');
      }
      out.push(canonical);
    }
  }
  return out;
}

async function sourceFileRecord(sourcePath: string, packagePath: string, mime: string, command: string): Promise<SourceFile> {
  const bytes = await readFile(sourcePath);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_ASSET_FILE_BYTES) {
    throw invalidPayload(command, 'Avatar source file is outside the fixed byte cap');
  }
  return { sourcePath, packagePath, bytes: bytes.byteLength, sha256: sha256(bytes), mime };
}

async function validateAvatarAssetAt(dir: string, avatarAssetRef: string, kind: AvatarBackendKind) {
  try {
    const manifest = await readManifest(dir);
    const entry = normalizeText(manifest.entry_file);
    if (manifest.local_asset_id !== avatarAssetRef || manifest.kind !== kind || !entry) {
      return { validationStatus: 'invalid' as const, validationMessage: 'Avatar manifest does not match the requested asset.' };
    }
    if (!await exists(path.join(dir, entry))) {
      return { validationStatus: 'invalid' as const, validationMessage: 'Avatar entry file is missing.' };
    }
    return { validationStatus: 'valid' as const };
  } catch (error) {
    return { validationStatus: 'invalid' as const, validationMessage: errorMessage(error) };
  }
}

function avatarImportResult(avatarAssetRef: string, backendKind: AvatarBackendKind, validation: { readonly validationStatus: ValidationStatus; readonly validationMessage?: string }) {
  return {
    avatarAssetRef,
    backendKind,
    backendCapabilityProfileRef: backendCapabilityProfileRefFor(backendKind, avatarAssetRef),
    ...validation,
  };
}

async function findAvatarAssetDir(dataRoot: string, avatarAssetRef: string, kind: AvatarBackendKind): Promise<string | undefined> {
  for (const agentRoot of await listAgentCenterRoots(dataRoot)) {
    const candidate = path.join(agentRoot, 'modules', 'avatar_asset', 'packages', kind, avatarAssetRef);
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function findBackground(dataRoot: string, backgroundAssetRef: string): Promise<{ readonly dir: string; readonly agentRoot: string } | undefined> {
  for (const agentRoot of await listAgentCenterRoots(dataRoot)) {
    const candidate = path.join(agentRoot, 'modules', 'appearance', 'backgrounds', backgroundAssetRef);
    if (await exists(candidate)) {
      return { dir: candidate, agentRoot };
    }
  }
  return undefined;
}

async function listAgentCenterRoots(dataRoot: string): Promise<string[]> {
  const accountsRoot = path.join(dataRoot, 'agent-center', 'accounts');
  if (!await exists(accountsRoot)) {
    return [];
  }
  const roots: string[] = [];
  for (const account of await readdir(accountsRoot, { withFileTypes: true })) {
    if (!account.isDirectory()) continue;
    const agentsRoot = path.join(accountsRoot, account.name, 'agents');
    if (!await exists(agentsRoot)) continue;
    for (const agent of await readdir(agentsRoot, { withFileTypes: true })) {
      if (agent.isDirectory()) {
        roots.push(path.join(agentsRoot, agent.name, 'agent-center'));
      }
    }
  }
  return roots;
}

function agentCenterDir(dataRoot: string, scope: Scope): string {
  return path.join(accountDir(dataRoot, scope.accountId), 'agents', segment(scope.localAgentRef), 'agent-center');
}

function accountDir(dataRoot: string, accountId: string): string {
  return path.join(dataRoot, 'agent-center', 'accounts', segment(accountId));
}

function avatarAssetDir(dataRoot: string, scope: Scope, kind: AvatarBackendKind, avatarAssetRef: string): string {
  return path.join(agentCenterDir(dataRoot, scope), 'modules', 'avatar_asset', 'packages', kind, avatarAssetRef);
}

function backgroundDir(dataRoot: string, scope: Scope, backgroundAssetRef: string): string {
  return path.join(agentCenterDir(dataRoot, scope), 'modules', 'appearance', 'backgrounds', backgroundAssetRef);
}

function findAgentCenterRootFromAssetDir(assetDir: string): string {
  return path.resolve(assetDir, '..', '..', '..', '..', '..');
}

async function quarantine(agentRoot: string, source: string, kind: string, resourceId: string): Promise<void> {
  const destination = path.join(agentRoot, 'quarantine', kind, `${segment(resourceId)}_${Date.now()}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
}

async function readManifest(dir: string): Promise<Readonly<Record<string, unknown>>> {
  return asRecord(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')), 'Agent Center manifest must be an object');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => true, () => false);
}

function avatarContentDigest(files: readonly SourceFile[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.packagePath);
    hash.update('\0');
    hash.update(String(file.bytes));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function sha256(bytes: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function segment(value: string): string {
  const body = value.startsWith('~') ? value.slice(1) : value;
  if (/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(body)) {
    return value;
  }
  return `id_${sha256(value).slice(0, 24)}`;
}

function backendCapabilityProfileRefFor(kind: AvatarBackendKind, avatarAssetRef: string): string {
  return `avatar.backend_profile:${kind}:${avatarAssetRef}:import_validated`;
}

function avatarMime(filePath: string, kind: AvatarBackendKind): string {
  const ext = path.extname(filePath).toLowerCase();
  if (kind === 'vrm' && ext === '.vrm') return 'model/vrm';
  if (ext === '.json') return 'application/json';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function backgroundMime(filePath: string, command: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  throw invalidPayload(command, 'Background source must be png, jpeg, or webp');
}

function invalidPayload(command: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message,
    reasonCode: 'electron-agent-center-payload-invalid',
    actionHint: 'send_standard_agent_center_payload',
    details: { command },
  });
}

function invalidAsset(command: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message,
    reasonCode: 'electron-agent-center-asset-invalid',
    actionHint: 'inspect_agent_center_asset_manifest',
    details: { command },
  });
}

function notFound(command: string, message: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'not-found',
    message,
    reasonCode: 'electron-agent-center-resource-not-found',
    actionHint: 'import_or_repair_agent_center_resource',
    details: { command },
  });
}
