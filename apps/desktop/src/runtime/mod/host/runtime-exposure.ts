import type { RuntimeHttpContext, RuntimeHttpContextProvider } from '../types';

let runtimeHttpContextProvider: RuntimeHttpContextProvider = () => ({
  apiBaseUrl: '',
});

export function setRuntimeHttpContextProviderState(provider: RuntimeHttpContextProvider): void {
  runtimeHttpContextProvider = provider;
}

export function getRuntimeHttpContextState(): RuntimeHttpContext {
  return runtimeHttpContextProvider();
}
