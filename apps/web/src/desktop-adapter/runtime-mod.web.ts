import {
  CODEGEN_T0_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T0_CAPABILITY_PATTERNS,
  CODEGEN_T1_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T1_CAPABILITY_PATTERNS,
  CODEGEN_T2_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T2_CAPABILITY_PATTERNS,
} from '@runtime/mod/codegen/capability-catalog';

const emptyArray = Object.freeze([]) as [];

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type RuntimeModDiscoveryError = {
  message: string;
  code?: string;
};
type RuntimeUiExtension = {
  modId: string;
  slot: string;
  priority: number;
  extension: JsonObject;
};
type RuntimeQueryInput = {
  modId: string;
  capability: string;
  query: JsonObject;
};
type RuntimeQueryResult = {
  items: JsonObject[];
};
type RuntimeDataProviderRegistration = {
  modId: string;
  capability: string;
  handler: (query: JsonObject) => Promise<JsonValue> | JsonValue;
};
type RuntimeHttpContextProvider = () => {
  realmBaseUrl: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
};
type RuntimeLocalManifestSummaryLike = {
  path: string;
  id: string;
  sourceId?: string;
  sourceType?: 'installed' | 'dev';
  sourceDir?: string;
  entry?: string;
  entryPath?: string;
  iconAsset?: string;
  iconAssetPath?: string;
  styles?: string[];
  stylePaths?: string[];
  manifest?: JsonObject;
};
type RuntimeModRegistration = {
  modId: string;
  capabilities: string[];
  grantCapabilities?: string[];
  denialCapabilities?: string[];
  sourceType?: string;
  manifestCapabilities?: string[];
  styleEntryPaths?: string[];
  isDefaultPrivateExecution?: boolean;
  setup: () => Promise<void> | void;
  teardown?: () => Promise<void> | void;
};
type RuntimeModRegisterFailure = {
  modId: string;
  sourceType: string;
  stage: 'discover' | 'setup';
  error: string;
};
type RegisterRuntimeModsResult = {
  registeredModIds: string[];
  failedMods: RuntimeModRegisterFailure[];
};

const runtimeHookRuntimeStub = {
  listUISlots: (): string[] => [],
  resolveUIExtensions: (_slot: string): RuntimeUiExtension[] => [],
  queryData: async (_input: RuntimeQueryInput): Promise<RuntimeQueryResult> => ({ items: [] }),
  registerDataProvider: async (_input: RuntimeDataProviderRegistration): Promise<void> => {},
  listDataCapabilities: (): string[] => [],
  setSpeechFetchImpl: (_fetchImpl: typeof fetch | null): void => {},
  setSpeechRouteResolver: (_resolver: (() => string | null) | null): void => {},
  setMissingDataCapabilityResolver: (_resolver: ((capability: string) => string | null) | null): void => {},
  storage: {
    files: {
      readText: async () => ({ path: '', text: '', sizeBytes: 0 }),
      writeText: async () => ({ path: '', sizeBytes: 0 }),
      readBytes: async () => ({ path: '', bytes: new Uint8Array(), sizeBytes: 0 }),
      writeBytes: async () => ({ path: '', sizeBytes: 0 }),
      delete: async () => false,
      list: async () => [],
      stat: async () => null,
    },
    sqlite: {
      query: async () => [],
      execute: async () => ({ rowsAffected: 0, lastInsertRowid: 0 }),
      transaction: async () => ({ rowsAffected: 0, lastInsertRowid: 0 }),
    },
  },
};

export const CODEGEN_T0_CAPABILITY_PATTERNS = DESKTOP_CODEGEN_T0_CAPABILITY_PATTERNS;

export const CODEGEN_T1_CAPABILITY_PATTERNS = DESKTOP_CODEGEN_T1_CAPABILITY_PATTERNS;

export const CODEGEN_T2_CAPABILITY_PATTERNS = DESKTOP_CODEGEN_T2_CAPABILITY_PATTERNS;

export function getRuntimeHookRuntime() {
  return runtimeHookRuntimeStub;
}

export function listRegisteredRuntimeModIds(): string[] {
  return [];
}

export function getDefaultPrivateExecutionModId(): string {
  return '';
}

export function getRuntimeHttpContext(): {
  realmBaseUrl: string;
  accessToken: string;
  fetchImpl: typeof fetch | null;
} {
  return {
    realmBaseUrl: '',
    accessToken: '',
    fetchImpl: null,
  };
}

export function setRuntimeHttpContextProvider(_provider: RuntimeHttpContextProvider | null): void {}

export async function discoverSideloadRuntimeMods(_input: {
  manifests: RuntimeLocalManifestSummaryLike[];
  readEntry: (entryPath: string) => Promise<string>;
  onError?: (detail: { manifestId: string; entryPath?: string; error: RuntimeModDiscoveryError }) => void;
}): Promise<RuntimeModRegistration[]> {
  return [];
}

export async function registerRuntimeMods(
  _registrations: RuntimeModRegistration[],
  _options: { replaceExisting?: boolean } = {},
): Promise<RegisterRuntimeModsResult> {
  return {
    registeredModIds: [],
    failedMods: [],
  };
}

export function unregisterRuntimeMods(_modIds: string[]): string[] {
  return [];
}

export async function registerInjectedRuntimeMods(): Promise<RegisterRuntimeModsResult> {
  return {
    registeredModIds: [],
    failedMods: [],
  };
}

export const __runtimeModWebStubInternals = {
  emptyArray,
};
