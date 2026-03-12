import type { DesktopExecutionKernelService } from '@runtime/execution-kernel';
import type { DesktopHookRuntimeService, HookSourceType } from '@runtime/hook';
import { type ModRuntimeContext } from "@nimiplatform/sdk/mod";
export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RuntimeHttpContext = {
    realmBaseUrl: string;
    accessToken?: string;
    fetchImpl?: FetchImpl;
};
export type RuntimeHttpContextProvider = () => RuntimeHttpContext;
export type RegisterRuntimeModOptions = {
    replaceExisting?: boolean;
};
export type RuntimeModRegisterFailureStage = 'discover' | 'setup';
export type RuntimeModRegisterFailure = {
    modId: string;
    sourceType: HookSourceType;
    stage: RuntimeModRegisterFailureStage;
    error: string;
};
export type RegisterRuntimeModsResult = {
    registeredModIds: string[];
    failedMods: RuntimeModRegisterFailure[];
};
export type RuntimeModLifecycleContext = {
    kernel: DesktopExecutionKernelService;
    hookRuntime: DesktopHookRuntimeService;
    getHttpContext: () => RuntimeHttpContext;
    sdkRuntimeContext: ModRuntimeContext;
};
export type RuntimeModSdkContextProvider = () => ModRuntimeContext;
export type RuntimeModRegistration = {
    modId: string;
    capabilities: string[];
    grantCapabilities?: string[];
    denialCapabilities?: string[];
    sourceType?: HookSourceType;
    manifestCapabilities?: string[];
    styleEntryPaths?: string[];
    isDefaultPrivateExecution?: boolean;
    setup: (ctx: RuntimeModLifecycleContext) => Promise<void> | void;
    teardown?: (ctx: RuntimeModLifecycleContext) => Promise<void> | void;
};
export type RuntimeModFactory = () => RuntimeModRegistration;
export type RuntimeLocalManifestSummaryLike = {
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
    manifest?: Record<string, unknown>;
};
declare global {
    interface Window {
        __NIMI_RUNTIME_MOD_FACTORIES__?: RuntimeModFactory[];
    }
}
