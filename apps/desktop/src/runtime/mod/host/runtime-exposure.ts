import type {
  RuntimeHttpContext,
  RuntimeHttpContextProvider,
  RuntimeModSdkContextProvider,
} from '../types';
import type { ModRuntimeContext } from '@nimiplatform/sdk/mod/types';

let runtimeHttpContextProvider: RuntimeHttpContextProvider = () => ({
  realmBaseUrl: '',
});
let runtimeModSdkContextProvider: RuntimeModSdkContextProvider | null = null;

export function setRuntimeHttpContextProviderState(provider: RuntimeHttpContextProvider): void {
  runtimeHttpContextProvider = provider;
}

export function getRuntimeHttpContextState(): RuntimeHttpContext {
  return runtimeHttpContextProvider();
}

export function setRuntimeModSdkContextProviderState(provider: RuntimeModSdkContextProvider): void {
  runtimeModSdkContextProvider = provider;
}

export function clearRuntimeModSdkContextProviderState(): void {
  runtimeModSdkContextProvider = null;
}

export function getRuntimeModSdkContextState(): ModRuntimeContext | null {
  if (!runtimeModSdkContextProvider) {
    return null;
  }
  return runtimeModSdkContextProvider();
}
