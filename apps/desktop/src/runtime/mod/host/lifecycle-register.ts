import type { DesktopExecutionKernelService } from '@runtime/execution-kernel';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import type { HookSourceType } from '@runtime/hook/contracts/types';
import { anyCapabilityMatches } from '@runtime/hook/contracts/capabilities';
import type { RuntimeModRegistration } from '../types';
import { resolveDeclaredDataCapabilities } from './capability-bindings';
import { resolveCodegenCapabilityDecision } from '../codegen/capability-catalog';
import { type ModRuntimeContext } from "@nimiplatform/sdk/mod";
export async function registerRuntimeModState(input: {
    mod: RuntimeModRegistration;
    sourceType: HookSourceType;
    capabilityResolution: {
        baselineCapabilities: string[];
        manifestCapabilities: string[];
    };
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
    const mergedCapabilities = [
        ...input.capabilityResolution.baselineCapabilities,
        ...input.capabilityResolution.manifestCapabilities,
    ];
    if (input.sourceType === 'codegen') {
        const decision = resolveCodegenCapabilityDecision(mergedCapabilities);
        const hardDenied = Array.from(new Set([...decision.denied, ...decision.unknown]));
        if (hardDenied.length > 0) {
            throw new Error(`CODEGEN_CAPABILITY_DENIED: ${hardDenied.join(',')}`);
        }
        const grants = input.mod.grantCapabilities || [];
        const missingConsent = decision.requiresConsent.filter((capability) => !anyCapabilityMatches(grants, capability));
        if (missingConsent.length > 0) {
            throw new Error(`CODEGEN_T1_CONSENT_REQUIRED: ${missingConsent.join(',')}`);
        }
    }
    input.hookRuntime.setModSourceType(input.mod.modId, input.sourceType);
    input.hookRuntime.setCapabilityBaseline(input.mod.modId, input.capabilityResolution.baselineCapabilities);
    input.hookRuntime.setGrantCapabilities(input.mod.modId, input.mod.grantCapabilities || []);
    input.hookRuntime.setDenialCapabilities(input.mod.modId, input.mod.denialCapabilities || []);
    for (const capability of resolveDeclaredDataCapabilities([
        ...mergedCapabilities,
    ])) {
        input.hookRuntime.registerDataCapability(capability);
    }
    await input.mod.setup({
        kernel: input.kernel,
        hookRuntime: input.hookRuntime,
        getHttpContext: input.getHttpContext,
        sdkRuntimeContext: input.sdkRuntimeContext,
    });
    input.registeredMods.set(input.mod.modId, input.mod);
    const nextDefaultPrivateExecutionModId = input.mod.isDefaultPrivateExecution || input.defaultPrivateExecutionModId === input.mod.modId
        ? input.mod.modId
        : input.defaultPrivateExecutionModId;
    return { defaultPrivateExecutionModId: nextDefaultPrivateExecutionModId };
}
