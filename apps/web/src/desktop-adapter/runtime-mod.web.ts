import {
  CODEGEN_T0_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T0_CAPABILITY_PATTERNS,
  CODEGEN_T1_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T1_CAPABILITY_PATTERNS,
  CODEGEN_T2_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T2_CAPABILITY_PATTERNS,
} from '@runtime/mod/codegen/capability-catalog';

const emptyArray = Object.freeze([]) as [];

const runtimeHookRuntimeStub = {
  listUISlots: (): string[] => [],
  resolveUIExtensions: (_slot: string): Array<Record<string, unknown>> => [],
  queryData: async (_input: {
    modId: string;
    capability: string;
    query: Record<string, unknown>;
  }): Promise<unknown> => ({ items: [] }),
  registerDataProvider: async (_input: unknown): Promise<void> => {},
  listDataCapabilities: (): string[] => [],
  setSpeechFetchImpl: (_fetchImpl: unknown): void => {},
  setSpeechRouteResolver: (_resolver: unknown): void => {},
  setMissingDataCapabilityResolver: (_resolver: unknown): void => {},
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

export function setRuntimeHttpContextProvider(_provider: unknown): void {}

export async function discoverSideloadRuntimeMods(_input: {
  manifests: Array<Record<string, unknown>>;
  readEntry: (entryPath: string) => Promise<string>;
  onError?: (detail: { manifestId: string; entryPath?: string; error: unknown }) => void;
}): Promise<Array<Record<string, unknown>>> {
  return [];
}

export async function registerRuntimeMods(
  _registrations: Array<Record<string, unknown>>,
  _options: { replaceExisting?: boolean } = {},
): Promise<{
  registeredModIds: string[];
  failedMods: Array<Record<string, unknown>>;
}> {
  return {
    registeredModIds: [],
    failedMods: [],
  };
}

export function unregisterRuntimeMods(_modIds: string[]): string[] {
  return [];
}

export async function registerInjectedRuntimeMods(): Promise<{
  registeredModIds: string[];
  failedMods: Array<Record<string, unknown>>;
}> {
  return {
    registeredModIds: [],
    failedMods: [],
  };
}

export const __runtimeModWebStubInternals = {
  emptyArray,
};
