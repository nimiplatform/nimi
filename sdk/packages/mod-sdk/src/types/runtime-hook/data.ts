import type { HookSourceType } from './shared';

export type RuntimeHookDataFacade = {
  queryData: (input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    query: Record<string, unknown>;
  }) => Promise<unknown>;
  registerDataProvider: (input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    handler: (query: Record<string, unknown>) => Promise<unknown> | unknown;
  }) => Promise<void>;
  unregisterDataProvider: (input: {
    modId: string;
    capability: string;
  }) => boolean;
  listDataCapabilities: () => string[];
};

export type HookDataClient = {
  query: (input: {
    capability: string;
    query: Record<string, unknown>;
  }) => Promise<unknown>;
  register: (input: {
    capability: string;
    handler: (query: Record<string, unknown>) => Promise<unknown> | unknown;
  }) => Promise<void>;
  unregister: (input: {
    capability: string;
  }) => boolean;
  listCapabilities: () => string[];
};
