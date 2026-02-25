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
};

export const CODEGEN_T0_CAPABILITY_PATTERNS = [
  'llm.text.generate',
  'llm.text.stream',
  'ui.register.ui-extension.app.*',
  'data.register.data-api.user-*.*.*',
  'data.query.data-api.user-*.*.*',
  'audit.read.self',
  'meta.read.self',
] as const;

export const CODEGEN_T1_CAPABILITY_PATTERNS = [
  'llm.image.generate',
  'llm.video.generate',
  'llm.embedding.generate',
  'llm.speech.*',
  'data.query.data-api.core.*',
] as const;

export const CODEGEN_T2_CAPABILITY_PATTERNS = [
  'turn.register.*',
  'inter-mod.*',
  'action.*',
  'network*',
  'filesystem*',
  'process*',
  'economy-write*',
  'identity-write*',
  'platform-cloud-write*',
  'audit.read.all',
  'meta.read.all',
] as const;

export function getRuntimeHookRuntime() {
  return runtimeHookRuntimeStub;
}

export function listRegisteredRuntimeModIds(): string[] {
  return [];
}

export function getRuntimeHttpContext(): {
  apiBaseUrl: string;
  accessToken: string;
  fetchImpl: typeof fetch | null;
} {
  return {
    apiBaseUrl: '',
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
