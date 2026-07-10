import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { openShellFileDialog } from './files.js';
import { BridgeError, invokeChecked } from './invoke.js';
import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
  type JsonObject,
} from './types.js';

export type AgentCenterShellHostScope = 'account' | 'local-agent';
export type AgentCenterShellAvatarBackendKind = 'live2d' | 'vrm';
export type AgentCenterShellValidationStatus = 'valid' | 'invalid' | 'checking' | 'not_checked';

export interface AgentCenterShellScopePayload {
  readonly hostScope: 'local-agent';
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}

export interface AgentCenterShellAccountScopePayload {
  readonly hostScope: 'account';
  readonly accountId: string;
}

export interface AgentCenterAvatarAssetImportPayload extends AgentCenterShellScopePayload {
  readonly sourcePath: string;
  readonly backendKind: AgentCenterShellAvatarBackendKind;
}

export interface AgentCenterAvatarAssetImportResult {
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterShellAvatarBackendKind;
  readonly validationStatus?: AgentCenterShellValidationStatus;
  readonly validationMessage?: string;
  readonly backendCapabilityProfileRef?: string;
}

export interface AgentCenterAvatarAssetValidatePayload extends AgentCenterShellScopePayload {
  readonly avatarAssetRef: string;
}

export interface AgentCenterAvatarAssetValidateResult {
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterShellAvatarBackendKind;
  readonly validationStatus: AgentCenterShellValidationStatus;
  readonly validationMessage?: string;
  readonly backendCapabilityProfileRef?: string;
  readonly validationIssueRows?: readonly string[];
}

export interface AgentCenterAvatarPreviewResolvePayload extends AgentCenterShellScopePayload {
  readonly avatarAssetRef: string;
  readonly backendKind?: AgentCenterShellAvatarBackendKind;
}

export interface AgentCenterAvatarPreviewResolveResult {
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterShellAvatarBackendKind;
  readonly previewArtifactRef: string;
  readonly previewImageRef?: string;
  readonly validationStatus?: AgentCenterShellValidationStatus;
  readonly validationMessage?: string;
  readonly warnings?: readonly string[];
}

export interface AgentCenterLive2dAdapterImportPayload extends AgentCenterShellScopePayload {
  readonly avatarAssetRef: string;
  readonly sourcePath: string;
}

export interface AgentCenterLive2dAdapterImportResult {
  readonly avatarAssetRef: string;
  readonly live2dAdapterManifestRef: string;
  readonly live2dAdapterManifestSource: 'embedded_creator_manifest' | 'external_sidecar_manifest';
}

export interface AgentCenterBackgroundImportPayload extends AgentCenterShellScopePayload {
  readonly sourcePath: string;
}

export interface AgentCenterBackgroundImportResult {
  readonly backgroundAssetRef: string;
  readonly validationStatus?: AgentCenterShellValidationStatus;
  readonly validationMessage?: string;
}

export interface AgentCenterBackgroundGetPayload extends AgentCenterShellScopePayload {
  readonly backgroundAssetRef: string;
}

export interface AgentCenterBackgroundGetResult {
  readonly backgroundAssetRef: string;
  readonly url: string;
  readonly mimeType?: string;
}

export interface AgentCenterBackgroundValidatePayload extends AgentCenterShellScopePayload {
  readonly backgroundAssetRef: string;
}

export interface AgentCenterBackgroundValidateResult {
  readonly backgroundAssetRef: string;
  readonly validationStatus: AgentCenterShellValidationStatus;
  readonly validationMessage?: string;
}

export interface AgentCenterBackgroundRemovePayload extends AgentCenterShellScopePayload {
  readonly backgroundAssetRef: string;
}

export type AgentCenterResourceRemovalPayload = AgentCenterShellScopePayload | AgentCenterShellAccountScopePayload;

export interface AgentCenterResourceRemovalResult {
  readonly removed: boolean;
  readonly avatarAssetRef?: string;
  readonly backgroundAssetRef?: string;
  readonly live2dAdapterManifestRef?: string;
}

export interface AgentCenterShellBridge {
  readonly importLive2dAvatarAsset: (
    scope: AgentCenterShellScopePayload,
  ) => Promise<AgentCenterAvatarAssetImportResult | null>;
  readonly importVrmAvatarAsset: (
    scope: AgentCenterShellScopePayload,
  ) => Promise<AgentCenterAvatarAssetImportResult | null>;
  readonly validateAvatarAsset: (
    payload: AgentCenterAvatarAssetValidatePayload,
  ) => Promise<AgentCenterAvatarAssetValidateResult>;
  readonly resolveAvatarAssetPreview: (
    payload: AgentCenterAvatarPreviewResolvePayload,
  ) => Promise<AgentCenterAvatarPreviewResolveResult>;
  readonly importLive2dAdapterManifest: (
    payload: Omit<AgentCenterLive2dAdapterImportPayload, 'sourcePath'>,
  ) => Promise<AgentCenterLive2dAdapterImportResult | null>;
  readonly importBackground: (
    scope: AgentCenterShellScopePayload,
  ) => Promise<AgentCenterBackgroundImportResult | null>;
  readonly getBackground: (
    payload: AgentCenterBackgroundGetPayload,
  ) => Promise<AgentCenterBackgroundGetResult>;
  readonly validateBackground: (
    payload: AgentCenterBackgroundValidatePayload,
  ) => Promise<AgentCenterBackgroundValidateResult>;
  readonly removeBackground: (
    payload: AgentCenterBackgroundRemovePayload,
  ) => Promise<AgentCenterResourceRemovalResult>;
  readonly removeAgentResources: (
    payload: AgentCenterShellScopePayload,
  ) => Promise<AgentCenterResourceRemovalResult>;
  readonly removeAccountResources: (
    payload: AgentCenterShellAccountScopePayload,
  ) => Promise<AgentCenterResourceRemovalResult>;
}

const dialogSelectedPaths = new Set<string>();

export function clearAgentCenterRegisteredDialogPathsForTest(): void {
  dialogSelectedPaths.clear();
}

function rememberDialogPath(path: string): string {
  const normalized = path.trim();
  if (normalized) {
    dialogSelectedPaths.add(normalized);
  }
  return normalized;
}

function assertRegisteredDialogPath(sourcePath: unknown, command: string): string {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw invalidRendererPayload(command, 'sourcePath must be a non-empty string');
  }
  const normalized = sourcePath.trim();
  if (!dialogSelectedPaths.has(normalized)) {
    throw new BridgeError('Agent Center import sourcePath must come from standard file-dialog.open.', command, {
      code: 'forbidden-renderer-access',
      reasonCode: 'renderer-agent-center-source-not-from-file-dialog',
      actionHint: 'select_agent_center_import_source_with_standard_file_dialog',
      source: 'renderer',
      details: { command },
    });
  }
  return normalized;
}

async function pickSinglePath(payload: Parameters<typeof openShellFileDialog>[0]): Promise<string | null> {
  const result = await openShellFileDialog({ ...payload, multiple: false });
  if (result.canceled || result.paths.length === 0) {
    return null;
  }
  return rememberDialogPath(result.paths[0] || '');
}

export async function pickAgentCenterLive2dFolder(): Promise<string | null> {
  return pickSinglePath({
    kind: 'directory',
    title: 'Select Live2D folder',
  });
}

export async function pickAgentCenterVrmFile(): Promise<string | null> {
  return pickSinglePath({
    kind: 'file',
    title: 'Select VRM file',
    filters: [{ name: 'VRM', extensions: ['vrm'] }],
  });
}

export async function pickAgentCenterLive2dAdapterJson(): Promise<string | null> {
  return pickSinglePath({
    kind: 'file',
    title: 'Select Live2D adapter JSON',
    filters: [{ name: 'Live2D adapter JSON', extensions: ['json'] }],
  });
}

export async function pickAgentCenterBackgroundImage(): Promise<string | null> {
  return pickSinglePath({
    kind: 'file',
    title: 'Select background image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
}

export async function importAgentCenterAvatarAsset(
  payload: AgentCenterAvatarAssetImportPayload,
): Promise<AgentCenterAvatarAssetImportResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'];
  const scope = requireLocalAgentScope(payload, command);
  const sourcePath = requireSourcePath(payload.sourcePath, command);
  const canonical = exactPayload(payload, {
    ...scope,
    sourcePath,
    backendKind: requireAvatarBackendKind(payload.backendKind, command),
  }, command);
  canonical.sourcePath = assertRegisteredDialogPath(sourcePath, command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseAvatarAssetImportResult(value, command),
  );
}

export async function validateAgentCenterAvatarAsset(
  payload: AgentCenterAvatarAssetValidatePayload,
): Promise<AgentCenterAvatarAssetValidateResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'];
  const canonical = exactPayload(payload, {
    ...requireLocalAgentScope(payload, command),
    avatarAssetRef: requireAvatarAssetRef(payload.avatarAssetRef, command),
  }, command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseAvatarAssetValidateResult(value, command),
  );
}

export async function resolveAgentCenterAvatarAssetPreview(
  payload: AgentCenterAvatarPreviewResolvePayload,
): Promise<AgentCenterAvatarPreviewResolveResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview'];
  const avatarAssetRef = requireAvatarAssetRef(payload.avatarAssetRef, command);
  const backendKind = payload.backendKind == null
    ? undefined
    : requireAvatarBackendKind(payload.backendKind, command);
  if (backendKind && !avatarAssetRef.startsWith(`${backendKind}_`)) {
    throw invalidRendererPayload(command, 'backendKind must match avatarAssetRef');
  }
  const canonical = exactPayload(payload, compactPayload({
    ...requireLocalAgentScope(payload, command),
    avatarAssetRef,
    backendKind,
  }), command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseAvatarPreviewResolveResult(value, command),
  );
}

export async function importAgentCenterLive2dAdapter(
  payload: AgentCenterLive2dAdapterImportPayload,
): Promise<AgentCenterLive2dAdapterImportResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'];
  const scope = requireLocalAgentScope(payload, command);
  const sourcePath = requireSourcePath(payload.sourcePath, command);
  const canonical = exactPayload(payload, {
    ...scope,
    avatarAssetRef: requireAvatarAssetRef(payload.avatarAssetRef, command, 'live2d'),
    sourcePath,
  }, command);
  canonical.sourcePath = assertRegisteredDialogPath(sourcePath, command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseLive2dAdapterImportResult(value, command),
  );
}

export async function importAgentCenterBackground(
  payload: AgentCenterBackgroundImportPayload,
): Promise<AgentCenterBackgroundImportResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'];
  const scope = requireLocalAgentScope(payload, command);
  const sourcePath = requireSourcePath(payload.sourcePath, command);
  const canonical = exactPayload(payload, { ...scope, sourcePath }, command);
  canonical.sourcePath = assertRegisteredDialogPath(sourcePath, command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseBackgroundImportResult(value, command),
  );
}

export async function getAgentCenterBackground(
  payload: AgentCenterBackgroundGetPayload,
): Promise<AgentCenterBackgroundGetResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'];
  const canonical = exactPayload(payload, {
    ...requireLocalAgentScope(payload, command),
    backgroundAssetRef: requireBackgroundAssetRef(payload.backgroundAssetRef, command),
  }, command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseBackgroundGetResult(value, command),
  );
}

export async function validateAgentCenterBackground(
  payload: AgentCenterBackgroundValidatePayload,
): Promise<AgentCenterBackgroundValidateResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'];
  const canonical = exactPayload(payload, {
    ...requireLocalAgentScope(payload, command),
    backgroundAssetRef: requireBackgroundAssetRef(payload.backgroundAssetRef, command),
  }, command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseBackgroundValidateResult(value, command),
  );
}

export async function removeAgentCenterBackground(
  payload: AgentCenterBackgroundRemovePayload,
): Promise<AgentCenterResourceRemovalResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove'];
  const canonical = exactPayload(payload, {
    ...requireLocalAgentScope(payload, command),
    backgroundAssetRef: requireBackgroundAssetRef(payload.backgroundAssetRef, command),
  }, command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseResourceRemovalResult(value, command),
  );
}

export async function removeAgentCenterAgentResources(
  payload: AgentCenterShellScopePayload,
): Promise<AgentCenterResourceRemovalResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove'];
  const canonical = exactPayload(payload, requireLocalAgentScope(payload, command), command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseResourceRemovalResult(value, command),
  );
}

export async function removeAgentCenterAccountResources(
  payload: AgentCenterShellAccountScopePayload,
): Promise<AgentCenterResourceRemovalResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove'];
  const canonical = exactPayload(payload, requireAccountScope(payload, command), command);
  return invokeChecked(
    command,
    { payload: canonical },
    (value) => parseResourceRemovalResult(value, command),
  );
}

export function createAgentCenterShellBridge(): AgentCenterShellBridge {
  return {
    async importLive2dAvatarAsset(scope) {
      const sourcePath = await pickAgentCenterLive2dFolder();
      return sourcePath ? importAgentCenterAvatarAsset({ ...scope, sourcePath, backendKind: 'live2d' }) : null;
    },
    async importVrmAvatarAsset(scope) {
      const sourcePath = await pickAgentCenterVrmFile();
      return sourcePath ? importAgentCenterAvatarAsset({ ...scope, sourcePath, backendKind: 'vrm' }) : null;
    },
    validateAvatarAsset: validateAgentCenterAvatarAsset,
    resolveAvatarAssetPreview: resolveAgentCenterAvatarAssetPreview,
    async importLive2dAdapterManifest(payload) {
      const sourcePath = await pickAgentCenterLive2dAdapterJson();
      return sourcePath ? importAgentCenterLive2dAdapter({ ...payload, sourcePath }) : null;
    },
    async importBackground(scope) {
      const sourcePath = await pickAgentCenterBackgroundImage();
      return sourcePath ? importAgentCenterBackground({ ...scope, sourcePath }) : null;
    },
    getBackground: getAgentCenterBackground,
    validateBackground: validateAgentCenterBackground,
    removeBackground: removeAgentCenterBackground,
    removeAgentResources: removeAgentCenterAgentResources,
    removeAccountResources: removeAgentCenterAccountResources,
  };
}

function compactPayload<T extends object>(payload: T): JsonObject {
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as JsonObject;
}

function exactPayload<T extends object>(raw: unknown, canonical: T, command: string): JsonObject {
  const record = requirePayloadRecord(raw, command);
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = Object.keys(canonical).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidRendererPayload(command, `payload keys must be exactly: ${expectedKeys.join(', ')}`);
  }
  return { ...canonical } as JsonObject;
}

function requireLocalAgentScope(payload: unknown, command: string): AgentCenterShellScopePayload {
  const record = requirePayloadRecord(payload, command);
  if (record.hostScope !== 'local-agent') {
    throw invalidRendererScope(command, 'hostScope must be local-agent');
  }
  const scope = {
    hostScope: 'local-agent' as const,
    accountId: requireScopeText(record.accountId, 'accountId', command),
    ownerUserId: requireScopeText(record.ownerUserId, 'ownerUserId', command),
    runtimeSourceRef: requireScopeText(record.runtimeSourceRef, 'runtimeSourceRef', command),
    localAgentRef: requireScopeText(record.localAgentRef, 'localAgentRef', command),
  };
  if (!scope.localAgentRef.startsWith('local-agent:')) {
    throw invalidRendererScope(command, 'localAgentRef must start with local-agent:');
  }
  if (scope.localAgentRef === scope.runtimeSourceRef) {
    throw invalidRendererScope(command, 'localAgentRef must differ from runtimeSourceRef');
  }
  return scope;
}

function requireAccountScope(payload: unknown, command: string): AgentCenterShellAccountScopePayload {
  const record = requirePayloadRecord(payload, command);
  if (record.hostScope !== 'account') {
    throw invalidRendererScope(command, 'hostScope must be account');
  }
  return {
    hostScope: 'account',
    accountId: requireScopeText(record.accountId, 'accountId', command),
  };
}

function requirePayloadRecord(payload: unknown, command: string): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidRendererPayload(command, 'payload must be an object');
  }
  return payload as Record<string, unknown>;
}

function requireScopeText(value: unknown, fieldName: string, command: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw invalidRendererScope(command, `${fieldName} is required`);
  }
  if (
    normalized.length > 256
    || normalized === '.'
    || normalized === '..'
    || normalized.includes('://')
    || !/[A-Za-z0-9]/u.test(normalized)
    || !/^[A-Za-z0-9_.~:@+-]+$/u.test(normalized)
  ) {
    throw invalidRendererScope(command, `${fieldName} is not an admitted opaque identifier`);
  }
  return normalized;
}

function requireSourcePath(value: unknown, command: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidRendererPayload(command, 'sourcePath must be a non-empty string');
  }
  return value.trim();
}

function requireAvatarBackendKind(value: unknown, command: string): AgentCenterShellAvatarBackendKind {
  if (value !== 'live2d' && value !== 'vrm') {
    throw invalidRendererPayload(command, 'backendKind must be live2d or vrm');
  }
  return value;
}

function requireAvatarAssetRef(
  value: unknown,
  command: string,
  requiredKind?: AgentCenterShellAvatarBackendKind,
): string {
  if (typeof value !== 'string' || !/^(?:live2d|vrm)_[a-f0-9]{12}$/u.test(value)) {
    throw invalidRendererPayload(command, 'avatarAssetRef is invalid');
  }
  if (requiredKind && !value.startsWith(`${requiredKind}_`)) {
    throw invalidRendererPayload(command, `avatarAssetRef must reference a ${requiredKind} asset`);
  }
  return value;
}

function requireBackgroundAssetRef(value: unknown, command: string): string {
  if (typeof value !== 'string' || !/^bg_[a-f0-9]{12}$/u.test(value)) {
    throw invalidRendererPayload(command, 'backgroundAssetRef is invalid');
  }
  return value;
}

function invalidRendererScope(command: string, cause: string): BridgeError {
  return invalidRendererPayload(command, cause);
}

function invalidRendererPayload(command: string, cause: string): BridgeError {
  return new BridgeError(`${command}: ${cause}`, command, {
    code: 'invalid-payload',
    reasonCode: 'renderer-agent-center-payload-invalid',
    actionHint: 'provide_valid_agent_center_payload',
    source: 'renderer',
    details: { command, cause },
  });
}

function parseOpaqueRef(value: unknown, fieldName: string, command: string): string {
  const ref = parseRequiredString(value, fieldName, command);
  if (/^(?:file:|data:)/u.test(ref) || /^[A-Za-z]:[\\/]/u.test(ref) || ref.startsWith('/') || ref.startsWith('\\\\')) {
    throw new Error(`${command}: ${fieldName} must be an opaque managed ref`);
  }
  return ref;
}

function parseBackendKind(value: unknown, command: string): AgentCenterShellAvatarBackendKind {
  const kind = parseRequiredString(value, 'backendKind', command) as AgentCenterShellAvatarBackendKind;
  if (!['live2d', 'vrm'].includes(kind)) {
    throw new Error(`${command}: backendKind is not admitted`);
  }
  return kind;
}

function parseValidationStatus(value: unknown, command: string): AgentCenterShellValidationStatus {
  const status = parseRequiredString(value, 'validationStatus', command) as AgentCenterShellValidationStatus;
  if (!['valid', 'invalid', 'checking', 'not_checked'].includes(status)) {
    throw new Error(`${command}: validationStatus is not admitted`);
  }
  return status;
}

function parseOptionalValidationStatus(value: unknown, command: string): AgentCenterShellValidationStatus | undefined {
  return value == null ? undefined : parseValidationStatus(value, command);
}

function parseStringArray(value: unknown, fieldName: string, command: string): readonly string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${command}: ${fieldName} must be a string array`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function parseAvatarAssetImportResult(value: unknown, command: string): AgentCenterAvatarAssetImportResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return compactPayload({
    avatarAssetRef: parseOpaqueRef(record.avatarAssetRef, 'avatarAssetRef', command),
    backendKind: parseBackendKind(record.backendKind, command),
    validationStatus: parseOptionalValidationStatus(record.validationStatus, command),
    validationMessage: parseOptionalString(record.validationMessage),
    backendCapabilityProfileRef: record.backendCapabilityProfileRef == null
      ? undefined
      : parseOpaqueRef(record.backendCapabilityProfileRef, 'backendCapabilityProfileRef', command),
  }) as unknown as AgentCenterAvatarAssetImportResult;
}

function parseAvatarAssetValidateResult(value: unknown, command: string): AgentCenterAvatarAssetValidateResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return compactPayload({
    avatarAssetRef: parseOpaqueRef(record.avatarAssetRef, 'avatarAssetRef', command),
    backendKind: parseBackendKind(record.backendKind, command),
    validationStatus: parseValidationStatus(record.validationStatus, command),
    validationMessage: parseOptionalString(record.validationMessage),
    backendCapabilityProfileRef: record.backendCapabilityProfileRef == null
      ? undefined
      : parseOpaqueRef(record.backendCapabilityProfileRef, 'backendCapabilityProfileRef', command),
    validationIssueRows: parseStringArray(record.validationIssueRows, 'validationIssueRows', command),
  }) as unknown as AgentCenterAvatarAssetValidateResult;
}

function parseAvatarPreviewResolveResult(value: unknown, command: string): AgentCenterAvatarPreviewResolveResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  if ('backendCompatibilityTier' in record || 'carrierProofRef' in record || 'launchPayload' in record) {
    throw new Error(`${command}: preview result contains forbidden Avatar/Runtime execution fields`);
  }
  return compactPayload({
    avatarAssetRef: parseOpaqueRef(record.avatarAssetRef, 'avatarAssetRef', command),
    backendKind: parseBackendKind(record.backendKind, command),
    previewArtifactRef: parseOpaqueRef(record.previewArtifactRef, 'previewArtifactRef', command),
    previewImageRef: record.previewImageRef == null ? undefined : parseOpaqueRef(record.previewImageRef, 'previewImageRef', command),
    validationStatus: parseOptionalValidationStatus(record.validationStatus, command),
    validationMessage: parseOptionalString(record.validationMessage),
    warnings: parseStringArray(record.warnings, 'warnings', command),
  }) as unknown as AgentCenterAvatarPreviewResolveResult;
}

function parseLive2dAdapterImportResult(value: unknown, command: string): AgentCenterLive2dAdapterImportResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  const source = parseRequiredString(record.live2dAdapterManifestSource, 'live2dAdapterManifestSource', command);
  if (source !== 'embedded_creator_manifest' && source !== 'external_sidecar_manifest') {
    throw new Error(`${command}: live2dAdapterManifestSource is not admitted`);
  }
  return {
    avatarAssetRef: parseOpaqueRef(record.avatarAssetRef, 'avatarAssetRef', command),
    live2dAdapterManifestRef: parseOpaqueRef(record.live2dAdapterManifestRef, 'live2dAdapterManifestRef', command),
    live2dAdapterManifestSource: source,
  };
}

function parseBackgroundImportResult(value: unknown, command: string): AgentCenterBackgroundImportResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return compactPayload({
    backgroundAssetRef: parseOpaqueRef(record.backgroundAssetRef, 'backgroundAssetRef', command),
    validationStatus: parseOptionalValidationStatus(record.validationStatus, command),
    validationMessage: parseOptionalString(record.validationMessage),
  }) as unknown as AgentCenterBackgroundImportResult;
}

function parseBackgroundGetResult(value: unknown, command: string): AgentCenterBackgroundGetResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return compactPayload({
    backgroundAssetRef: parseOpaqueRef(record.backgroundAssetRef, 'backgroundAssetRef', command),
    url: parseBackgroundUrl(record.url, command),
    mimeType: parseOptionalString(record.mimeType),
  }) as unknown as AgentCenterBackgroundGetResult;
}

function parseBackgroundUrl(value: unknown, command: string): string {
  const url = parseRequiredString(value, 'url', command);
  if (
    url.startsWith('nimi-shell-file://local/')
    || url.startsWith('asset://localhost/')
    || url.startsWith('http://asset.localhost/')
  ) {
    return url;
  }
  throw new Error(`${command}: url must use an admitted standard local asset host`);
}

function parseBackgroundValidateResult(value: unknown, command: string): AgentCenterBackgroundValidateResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return compactPayload({
    backgroundAssetRef: parseOpaqueRef(record.backgroundAssetRef, 'backgroundAssetRef', command),
    validationStatus: parseValidationStatus(record.validationStatus, command),
    validationMessage: parseOptionalString(record.validationMessage),
  }) as unknown as AgentCenterBackgroundValidateResult;
}

function parseResourceRemovalResult(value: unknown, command: string): AgentCenterResourceRemovalResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  if (typeof record.removed !== 'boolean') {
    throw new Error(`${command}: removed must be boolean`);
  }
  return compactPayload({
    removed: record.removed,
    avatarAssetRef: record.avatarAssetRef == null ? undefined : parseOpaqueRef(record.avatarAssetRef, 'avatarAssetRef', command),
    backgroundAssetRef: record.backgroundAssetRef == null ? undefined : parseOpaqueRef(record.backgroundAssetRef, 'backgroundAssetRef', command),
    live2dAdapterManifestRef: record.live2dAdapterManifestRef == null
      ? undefined
      : parseOpaqueRef(record.live2dAdapterManifestRef, 'live2dAdapterManifestRef', command),
  }) as unknown as AgentCenterResourceRemovalResult;
}
