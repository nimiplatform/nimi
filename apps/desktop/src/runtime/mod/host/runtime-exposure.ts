import type { RuntimeHttpContext, RuntimeHttpContextProvider, RuntimeModSdkContextProvider, } from '../types';
import { type ModRuntimeContext } from "@nimiplatform/sdk/mod";
const DEFAULT_RUNTIME_HTTP_CONTEXT_PROVIDER: RuntimeHttpContextProvider = () => ({
    realmBaseUrl: '',
});
let runtimeHttpContextProvider: RuntimeHttpContextProvider = DEFAULT_RUNTIME_HTTP_CONTEXT_PROVIDER;
let runtimeModSdkContextProvider: RuntimeModSdkContextProvider | null = null;
export function setRuntimeHttpContextProviderState(provider: RuntimeHttpContextProvider): void {
    runtimeHttpContextProvider = provider;
}
export function clearRuntimeHttpContextProviderState(): void {
    runtimeHttpContextProvider = DEFAULT_RUNTIME_HTTP_CONTEXT_PROVIDER;
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
