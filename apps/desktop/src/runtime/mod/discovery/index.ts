import {
  buildRuntimeModsFromFactories as buildRuntimeModsFromFactoriesImpl,
  discoverInjectedRuntimeModFactories as discoverInjectedRuntimeModFactoriesImpl,
  discoverInjectedRuntimeMods as discoverInjectedRuntimeModsImpl,
} from './external/injected';
import {
  discoverSideloadRuntimeMods as discoverSideloadRuntimeModsImpl,
} from './external/sideload';
import type {
  RuntimeLocalManifestSummaryLike,
  RuntimeModFactory,
  RuntimeModRegistration,
} from '../types';

export function buildRuntimeModsFromFactories(factories: RuntimeModFactory[]): RuntimeModRegistration[] {
  return buildRuntimeModsFromFactoriesImpl(factories);
}

export function discoverInjectedRuntimeModFactories(): RuntimeModFactory[] {
  return discoverInjectedRuntimeModFactoriesImpl();
}

export function discoverInjectedRuntimeMods(): RuntimeModRegistration[] {
  return discoverInjectedRuntimeModsImpl();
}

export function discoverSideloadRuntimeMods(input: {
  manifests: RuntimeLocalManifestSummaryLike[];
  readEntry: (entryPath: string) => Promise<string>;
  onError?: (detail: { manifestId: string; entryPath?: string; error: unknown }) => void;
}) {
  return discoverSideloadRuntimeModsImpl(input);
}
