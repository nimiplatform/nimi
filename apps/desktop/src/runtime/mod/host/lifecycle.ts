import type { DesktopExecutionKernelService } from '@runtime/execution-kernel';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import type { RegisterRuntimeModOptions, RuntimeModRegistration, } from '../types';
import { type RuntimeModCapabilityResolution, resolveRegistrationCapabilities } from './capability-bindings';
import { assertRuntimeModCapabilitiesDeclared } from './lifecycle-validate';
import { resolveDefaultPrivateExecutionModId, unregisterRuntimeModState, } from './lifecycle-unregister';
import { registerRuntimeModState } from './lifecycle-register';
import { createRuntimeModRegisterFlowId, createRuntimeModUnregisterFlowId, emitRuntimeModRegisterDone, emitRuntimeModRegisterFailed, emitRuntimeModRegisterSkipped, emitRuntimeModRegisterStart, emitRuntimeModUnregisterDone, emitRuntimeModUnregisterSkipped, } from './lifecycle-telemetry';
import { type ModRuntimeContext } from "@nimiplatform/sdk/mod";
export { resolveDefaultPrivateExecutionModId };
async function restoreReplacedRuntimeMod(input: {
    previousRegistration: RuntimeModRegistration;
    previousSourceType: RuntimeModRegistration['sourceType'];
    previousCapabilityResolution: RuntimeModCapabilityResolution;
    registeredMods: Map<string, RuntimeModRegistration>;
    hookRuntime: DesktopHookRuntimeService;
    kernel: DesktopExecutionKernelService;
    getHttpContext: () => {
        realmBaseUrl: string;
        accessToken?: string;
        fetchImpl?: typeof fetch;
    };
    sdkRuntimeContext: ModRuntimeContext;
    defaultPrivateExecutionModId: string;
}): Promise<{
    defaultPrivateExecutionModId: string;
}> {
    assertRuntimeModCapabilitiesDeclared({
        baselineCapabilities: input.previousCapabilityResolution.baselineCapabilities,
        manifestCapabilities: input.previousCapabilityResolution.manifestCapabilities,
    });
    return registerRuntimeModState({
        mod: input.previousRegistration,
        sourceType: input.previousSourceType || 'sideload',
        capabilityResolution: {
            baselineCapabilities: input.previousCapabilityResolution.baselineCapabilities,
            manifestCapabilities: input.previousCapabilityResolution.manifestCapabilities,
        },
        registeredMods: input.registeredMods,
        hookRuntime: input.hookRuntime,
        kernel: input.kernel,
        getHttpContext: input.getHttpContext,
        sdkRuntimeContext: input.sdkRuntimeContext,
        defaultPrivateExecutionModId: input.defaultPrivateExecutionModId,
    });
}
export function unregisterRuntimeModLifecycle(input: {
    modId: string;
    registeredMods: Map<string, RuntimeModRegistration>;
    hookRuntime: DesktopHookRuntimeService;
    kernel: DesktopExecutionKernelService;
    getHttpContext: () => {
        realmBaseUrl: string;
        accessToken?: string;
        fetchImpl?: typeof fetch;
    };
    sdkRuntimeContext: ModRuntimeContext;
    defaultPrivateExecutionModId: string;
}): {
    removed: boolean;
    defaultPrivateExecutionModId: string;
} {
    const flowId = createRuntimeModUnregisterFlowId();
    const startedAt = Date.now();
    const targetModId = String(input.modId || '').trim();
    if (!targetModId) {
        emitRuntimeModUnregisterSkipped({
            flowId,
            modId: '',
            reason: 'empty-mod-id',
        });
        return {
            removed: false,
            defaultPrivateExecutionModId: input.defaultPrivateExecutionModId,
        };
    }
    if (!input.registeredMods.has(targetModId)) {
        emitRuntimeModUnregisterSkipped({
            flowId,
            modId: targetModId,
            reason: 'mod-not-registered',
        });
        return {
            removed: false,
            defaultPrivateExecutionModId: input.defaultPrivateExecutionModId,
        };
    }
    const result = unregisterRuntimeModState(input);
    emitRuntimeModUnregisterDone({
        flowId,
        startedAt,
        modId: targetModId,
        remainingCount: input.registeredMods.size,
        defaultPrivateExecutionModId: result.defaultPrivateExecutionModId,
    });
    return result;
}
export async function registerRuntimeModLifecycle(input: {
    mod: RuntimeModRegistration;
    options: RegisterRuntimeModOptions;
    registeredMods: Map<string, RuntimeModRegistration>;
    hookRuntime: DesktopHookRuntimeService;
    kernel: DesktopExecutionKernelService;
    getHttpContext: () => {
        realmBaseUrl: string;
        accessToken?: string;
        fetchImpl?: typeof fetch;
    };
    sdkRuntimeContext: ModRuntimeContext;
    defaultPrivateExecutionModId: string;
    unregisterRuntimeMod: (modId: string) => boolean;
}): Promise<{
    registered: boolean;
    defaultPrivateExecutionModId: string;
}> {
    const flowId = createRuntimeModRegisterFlowId();
    const startedAt = Date.now();
    const replaceExisting = Boolean(input.options.replaceExisting);
    const alreadyRegistered = input.registeredMods.has(input.mod.modId);
    const sourceType = input.mod.sourceType || 'sideload';
    const capabilityResolution = resolveRegistrationCapabilities(input.mod);
    const previousRegistration = alreadyRegistered && replaceExisting
        ? input.registeredMods.get(input.mod.modId) || null
        : null;
    const previousSourceType = previousRegistration?.sourceType || 'sideload';
    const previousCapabilityResolution = previousRegistration
        ? resolveRegistrationCapabilities(previousRegistration)
        : null;
    let currentDefaultPrivateExecutionModId = input.defaultPrivateExecutionModId;
    emitRuntimeModRegisterStart({
        flowId,
        modId: input.mod.modId,
        replaceExisting,
        alreadyRegistered,
        capabilitiesCount: capabilityResolution.baselineCapabilities.length,
        isDefaultPrivateExecution: Boolean(input.mod.isDefaultPrivateExecution),
        sourceType,
        baselineCapabilityCount: capabilityResolution.baselineCapabilities.length,
        manifestCapabilityCount: capabilityResolution.manifestCapabilities.length,
    });
    if (alreadyRegistered && !replaceExisting) {
        emitRuntimeModRegisterSkipped({
            flowId,
            modId: input.mod.modId,
            reason: 'already-registered-without-replace',
        });
        return {
            registered: false,
            defaultPrivateExecutionModId: input.defaultPrivateExecutionModId,
        };
    }
    if (alreadyRegistered && replaceExisting) {
        const unregisterResult = unregisterRuntimeModState({
            modId: input.mod.modId,
            registeredMods: input.registeredMods,
            hookRuntime: input.hookRuntime,
            kernel: input.kernel,
            getHttpContext: input.getHttpContext,
            sdkRuntimeContext: input.sdkRuntimeContext,
            defaultPrivateExecutionModId: currentDefaultPrivateExecutionModId,
        });
        currentDefaultPrivateExecutionModId = unregisterResult.defaultPrivateExecutionModId;
    }
    try {
        assertRuntimeModCapabilitiesDeclared({
            baselineCapabilities: capabilityResolution.baselineCapabilities,
            manifestCapabilities: capabilityResolution.manifestCapabilities,
        });
        const result = await registerRuntimeModState({
            mod: input.mod,
            sourceType,
            capabilityResolution: {
                baselineCapabilities: capabilityResolution.baselineCapabilities,
                manifestCapabilities: capabilityResolution.manifestCapabilities,
            },
            registeredMods: input.registeredMods,
            hookRuntime: input.hookRuntime,
            kernel: input.kernel,
            getHttpContext: input.getHttpContext,
            sdkRuntimeContext: input.sdkRuntimeContext,
            defaultPrivateExecutionModId: currentDefaultPrivateExecutionModId,
        });
        emitRuntimeModRegisterDone({
            flowId,
            startedAt,
            modId: input.mod.modId,
            registeredCount: input.registeredMods.size,
            defaultPrivateExecutionModId: result.defaultPrivateExecutionModId,
            sourceType,
            baselineCapabilities: capabilityResolution.baselineCapabilities,
        });
        return {
            registered: true,
            defaultPrivateExecutionModId: result.defaultPrivateExecutionModId,
        };
    }
    catch (error) {
        if (previousRegistration && previousCapabilityResolution) {
            input.hookRuntime.suspendMod(input.mod.modId);
            try {
                const rollbackResult = await restoreReplacedRuntimeMod({
                    previousRegistration,
                    previousSourceType,
                    previousCapabilityResolution,
                    registeredMods: input.registeredMods,
                    hookRuntime: input.hookRuntime,
                    kernel: input.kernel,
                    getHttpContext: input.getHttpContext,
                    sdkRuntimeContext: input.sdkRuntimeContext,
                    defaultPrivateExecutionModId: currentDefaultPrivateExecutionModId,
                });
                currentDefaultPrivateExecutionModId = rollbackResult.defaultPrivateExecutionModId;
            }
            catch (rollbackError) {
                emitRuntimeModRegisterFailed({
                    flowId,
                    startedAt,
                    modId: input.mod.modId,
                    error: rollbackError,
                });
                throw rollbackError;
            }
        }
        emitRuntimeModRegisterFailed({
            flowId,
            startedAt,
            modId: input.mod.modId,
            error,
        });
        throw error;
    }
}
