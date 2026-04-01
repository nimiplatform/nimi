import {
  localRuntime,
  normalizeLocalRuntimeProfilesDeclaration,
  profileSupportsCapability,
  type LocalRuntimeExecutionEntryDescriptor as LocalRuntimeDependencyDescriptor,
  type LocalRuntimeExecutionPlan as LocalRuntimeDependencyResolutionPlan,
  type LocalRuntimeAssetRecord,
  type LocalRuntimeNodeDescriptor,
  type LocalRuntimeProfileDescriptor,
  type LocalRuntimeProfileEntryDescriptor,
  type LocalRuntimeProfileResolutionPlan,
  type LocalRuntimeServiceDescriptor,
} from '@runtime/local-runtime';
import type { SpeechSynthesizeOutput } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { runtimeModMediaCachePut, type RuntimeModMediaCachePutInput, type RuntimeModMediaCachePutResult, } from '@runtime/llm-adapter/tauri-bridge';
import { type ModRuntimeLocalProfileSnapshot, type RuntimeCanonicalCapability } from "@nimiplatform/sdk/mod";
import type { HookModLocalProfileSnapshot } from '@runtime/hook/contracts/facade';
function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
export function readManifestProfiles(modId: string): LocalRuntimeProfileDescriptor[] {
    const normalizedModId = String(modId || '').trim();
    if (!normalizedModId)
        return [];
    const summaries = useAppStore.getState().localManifestSummaries || [];
    const summary = summaries.find((item) => String(item.id || '').trim() === normalizedModId) || null;
    if (!summary)
        return [];
    const manifest = asRecord(summary.manifest);
    const ai = asRecord(manifest.ai);
    return normalizeLocalRuntimeProfilesDeclaration(ai.profiles);
}
function selectProfile(profiles: LocalRuntimeProfileDescriptor[], capability?: RuntimeCanonicalCapability): LocalRuntimeProfileDescriptor | null {
    if (profiles.length <= 0) {
        return null;
    }
    if (capability) {
        const recommendedMatch = profiles.find((profile) => profile.recommended && profileSupportsCapability(profile, capability));
        if (recommendedMatch) {
            return recommendedMatch;
        }
        const matchingProfile = profiles.find((profile) => profileSupportsCapability(profile, capability));
        if (matchingProfile) {
            return matchingProfile;
        }
    }
    return profiles.find((profile) => profile.recommended) || profiles[0] || null;
}
function normalizeIdentifier(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}
function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => String(item || '').trim().length > 0)));
}
function normalizeText(value: unknown): string {
    return String(value || '').trim();
}
function encodeBytesBase64(bytes: Uint8Array): string {
    if (bytes.length === 0) {
        return '';
    }
    const globalBuffer = (globalThis as {
        Buffer?: {
            from(value: Uint8Array): {
                toString(format: string): string;
            };
        };
    }).Buffer;
    if (globalBuffer) {
        return globalBuffer.from(bytes).toString('base64');
    }
    if (typeof btoa === 'function') {
        let binary = '';
        for (const byte of bytes) {
            binary += String.fromCharCode(byte);
        }
        return btoa(binary);
    }
    throw new Error('RUNTIME_MOD_MEDIA_CACHE_BASE64_UNAVAILABLE');
}
function resolveAudioExtensionHint(input: {
    audioFormat?: string;
    mimeType?: string;
}): string | undefined {
    const format = normalizeText(input.audioFormat).toLowerCase();
    if (format === 'mp3')
        return 'mp3';
    if (format === 'wav')
        return 'wav';
    if (format === 'pcm')
        return 'pcm';
    const mimeType = normalizeText(input.mimeType).toLowerCase();
    if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3')
        return 'mp3';
    if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav')
        return 'wav';
    if (mimeType === 'audio/pcm' || mimeType === 'audio/l16')
        return 'pcm';
    return undefined;
}
function normalizeSpeechArtifactMimeType(value: string | undefined): string | undefined {
    const mimeType = normalizeText(value).toLowerCase();
    if (!mimeType) {
        return undefined;
    }
    if (mimeType === 'audio/mp3') {
        return 'audio/mpeg';
    }
    if (mimeType === 'audio/x-wav') {
        return 'audio/wav';
    }
    if (mimeType === 'audio/x-pcm') {
        return 'audio/pcm';
    }
    return mimeType;
}
async function cacheSpeechArtifactForDesktopPlayback(input: {
    artifact: SpeechSynthesizeOutput['artifacts'][number];
    audioFormat?: string;
    mediaCachePut?: (value: RuntimeModMediaCachePutInput) => Promise<RuntimeModMediaCachePutResult>;
}): Promise<SpeechSynthesizeOutput['artifacts'][number]> {
    const bytes = input.artifact.bytes instanceof Uint8Array && input.artifact.bytes.length > 0
        ? input.artifact.bytes
        : null;
    if (!bytes) {
        const mimeType = normalizeSpeechArtifactMimeType(input.artifact.mimeType);
        return mimeType && mimeType !== input.artifact.mimeType
            ? {
                ...input.artifact,
                mimeType,
            }
            : input.artifact;
    }
    const mimeType = normalizeSpeechArtifactMimeType(input.artifact.mimeType);
    if (!mimeType) {
        throw new Error('RUNTIME_MOD_MEDIA_CACHE_MIME_TYPE_REQUIRED');
    }
    const cached = await (input.mediaCachePut || runtimeModMediaCachePut)({
        mediaBase64: encodeBytesBase64(bytes),
        mimeType,
        extensionHint: resolveAudioExtensionHint({
            audioFormat: input.audioFormat,
            mimeType,
        }),
    });
    if (!cached.uri) {
        throw new Error('RUNTIME_MOD_MEDIA_CACHE_URI_REQUIRED');
    }
    const cachedMimeType = normalizeSpeechArtifactMimeType(cached.mimeType);
    if (!cachedMimeType) {
        throw new Error('RUNTIME_MOD_MEDIA_CACHE_MIME_TYPE_REQUIRED');
    }
    return {
        ...input.artifact,
        uri: cached.uri,
        mimeType: cachedMimeType,
    };
}
export async function cacheSpeechArtifactsForDesktopPlayback(input: {
    artifacts: SpeechSynthesizeOutput['artifacts'];
    audioFormat?: string;
    mediaCachePut?: (value: RuntimeModMediaCachePutInput) => Promise<RuntimeModMediaCachePutResult>;
}): Promise<SpeechSynthesizeOutput['artifacts']> {
    return Promise.all((input.artifacts || []).map((artifact) => cacheSpeechArtifactForDesktopPlayback({
        artifact,
        audioFormat: input.audioFormat,
        mediaCachePut: input.mediaCachePut,
    })));
}
function mapCanonicalCapabilityToLocalRuntime(capability: RuntimeCanonicalCapability | undefined): string | undefined {
    if (!capability)
        return undefined;
    if (capability === 'text.generate')
        return 'chat';
    if (capability === 'text.embed')
        return 'embedding';
    if (capability === 'image.generate')
        return 'image';
    if (capability === 'video.generate')
        return 'video';
    if (capability === 'audio.synthesize')
        return 'tts';
    if (capability === 'audio.transcribe')
        return 'stt';
    return undefined;
}
function mapLocalRuntimeCapabilityToCanonical(capability: unknown): RuntimeCanonicalCapability | undefined {
    const normalized = String(capability || '').trim().toLowerCase();
    if (!normalized)
        return undefined;
    if (normalized === 'text.generate' || normalized === 'chat')
        return 'text.generate';
    if (normalized === 'text.embed' || normalized === 'embedding')
        return 'text.embed';
    if (normalized === 'image.generate' || normalized === 'image')
        return 'image.generate';
    if (normalized === 'video.generate' || normalized === 'video')
        return 'video.generate';
    if (normalized === 'audio.synthesize' || normalized === 'tts' || normalized === 'speech.synthesize')
        return 'audio.synthesize';
    if (normalized === 'audio.transcribe' || normalized === 'stt' || normalized === 'speech.transcribe')
        return 'audio.transcribe';
    return undefined;
}
function toDependencyEntries(dependencies: LocalRuntimeDependencyResolutionPlan['entries']): ModRuntimeLocalProfileSnapshot['entries'] {
    return dependencies.map((item: LocalRuntimeDependencyDescriptor) => ({
        entryId: item.entryId,
        kind: item.kind,
        capability: mapLocalRuntimeCapabilityToCanonical(item.capability),
        required: item.required,
        selected: item.selected,
        preferred: item.preferred,
        assetId: item.modelId,
        assetKind: undefined,
        templateId: undefined,
        repo: item.repo,
        engine: item.engine,
        serviceId: item.serviceId,
        nodeId: item.nodeId,
        reasonCode: item.reasonCode,
        warnings: Array.isArray(item.warnings) ? item.warnings : [],
    }));
}
function toDependencyEntry(item: LocalRuntimeDependencyDescriptor, input?: {
    reasonCode?: string;
    warnings?: string[];
}): ModRuntimeLocalProfileSnapshot['entries'][number] {
    return {
        entryId: item.entryId,
        kind: item.kind,
        capability: mapLocalRuntimeCapabilityToCanonical(item.capability),
        required: item.required,
        selected: item.selected,
        preferred: item.preferred,
        assetId: item.modelId,
        assetKind: undefined,
        templateId: undefined,
        repo: item.repo,
        engine: item.engine,
        serviceId: item.serviceId,
        nodeId: item.nodeId,
        reasonCode: input?.reasonCode ?? item.reasonCode,
        warnings: input?.warnings ?? (Array.isArray(item.warnings) ? item.warnings : []),
    };
}
function assetRepairLabel(entry: LocalRuntimeProfileEntryDescriptor): string {
    const assetId = String(entry.assetId || '').trim() || entry.entryId;
    return `Install asset ${assetId}`;
}
function findAssetForEntry(entry: LocalRuntimeProfileEntryDescriptor, assets: Awaited<ReturnType<typeof localRuntime.listAssets>>): Awaited<ReturnType<typeof localRuntime.listAssets>>[number] | null {
    return assets.find((asset) => {
        const assetId = String(entry.assetId || '').trim();
        const kind = String(entry.assetKind || '').trim();
        const engine = String(entry.engine || '').trim().toLowerCase();
        if (assetId && String(asset.assetId || '').trim() !== assetId) {
            return false;
        }
        if (kind && String(asset.kind || '').trim() !== kind) {
            return false;
        }
        if (engine && String(asset.engine || '').trim().toLowerCase() !== engine) {
            return false;
        }
        return Boolean(assetId || kind || String(entry.templateId || '').trim());
    }) || null;
}
function assessPassiveAssetRuntimeState(input: {
    entry: LocalRuntimeProfileEntryDescriptor;
    assets: Awaited<ReturnType<typeof localRuntime.listAssets>>;
}): DependencyRuntimeAssessment {
    const warnings = [];
    const asset = findAssetForEntry(input.entry, input.assets);
    let readiness: DependencyReadiness = 'ready';
    let reasonCode: string | undefined;
    const repairActions: ModRuntimeLocalProfileSnapshot['repairActions'] = [];
    if (!asset || asset.status === 'removed') {
        reasonCode = 'LOCAL_AI_DEPENDENCY_ASSET_NOT_INSTALLED';
        warnings.push('selected asset entry is not installed');
        readiness = input.entry.required === false ? 'degraded' : 'missing';
        repairActions.push({
            actionId: `install:${input.entry.entryId}`,
            label: assetRepairLabel(input.entry),
            reasonCode,
            entryId: input.entry.entryId,
            capability: mapLocalRuntimeCapabilityToCanonical(input.entry.capability),
        });
    }
    else if (asset.status === 'unhealthy') {
        reasonCode = 'LOCAL_AI_DEPENDENCY_ASSET_UNHEALTHY';
        warnings.push('selected asset entry is unhealthy');
        readiness = 'degraded';
    }
    return {
        entry: {
            entryId: input.entry.entryId,
            kind: 'asset',
            capability: mapLocalRuntimeCapabilityToCanonical(input.entry.capability),
            required: input.entry.required !== false,
            selected: true,
            preferred: input.entry.preferred === true,
            assetId: input.entry.assetId,
            assetKind: input.entry.assetKind as ModRuntimeLocalProfileSnapshot['entries'][number]['assetKind'],
            templateId: input.entry.templateId,
            repo: input.entry.repo,
            engine: input.entry.engine,
            serviceId: undefined,
            nodeId: undefined,
            reasonCode,
            warnings,
        },
        readiness,
        repairActions,
    };
}
type DependencyReadiness = 'ready' | 'degraded' | 'missing';
type DependencyRuntimeAssessment = {
    entry: ModRuntimeLocalProfileSnapshot['entries'][number];
    readiness: DependencyReadiness;
    repairActions: ModRuntimeLocalProfileSnapshot['repairActions'];
};
function buildDependencyRepairAction(input: {
    actionId: string;
    dependency: LocalRuntimeDependencyDescriptor;
    reasonCode: string;
    label: string;
}): ModRuntimeLocalProfileSnapshot['repairActions'][number] {
    return {
        actionId: input.actionId,
        label: input.label,
        reasonCode: input.reasonCode,
        entryId: input.dependency.entryId,
        capability: mapLocalRuntimeCapabilityToCanonical(input.dependency.capability),
    };
}
function dependencyRepairLabel(dep: LocalRuntimeDependencyDescriptor): string {
    if (dep.kind === 'asset') {
        const assetId = String(dep.modelId || '').trim() || dep.entryId;
        return `Install asset ${assetId}`;
    }
    if (dep.kind === 'service') {
        const serviceId = String(dep.serviceId || '').trim() || dep.entryId;
        return `Install service ${serviceId}`;
    }
    if (dep.kind === 'node') {
        const nodeId = String(dep.nodeId || '').trim() || dep.entryId;
        return `Install node host for ${nodeId}`;
    }
    return `Install runtime entry ${dep.entryId}`;
}
function findModelForDependency(dependency: LocalRuntimeDependencyDescriptor, models: LocalRuntimeAssetRecord[]): LocalRuntimeAssetRecord | null {
    const targetModelId = normalizeIdentifier(dependency.modelId);
    const targetEngine = normalizeIdentifier(dependency.engine);
    return models.find((model) => {
        if (normalizeIdentifier(model.assetId) !== targetModelId || !targetModelId)
            return false;
        if (!targetEngine)
            return true;
        return normalizeIdentifier(model.engine) === targetEngine;
    }) || null;
}
function findServiceForDependency(dependency: LocalRuntimeDependencyDescriptor, services: LocalRuntimeServiceDescriptor[]): LocalRuntimeServiceDescriptor | null {
    const targetServiceId = normalizeIdentifier(dependency.serviceId);
    if (!targetServiceId)
        return null;
    return services.find((service) => normalizeIdentifier(service.serviceId) === targetServiceId) || null;
}
function findNodeForDependency(dependency: LocalRuntimeDependencyDescriptor, nodes: LocalRuntimeNodeDescriptor[]): LocalRuntimeNodeDescriptor | null {
    const targetNodeId = normalizeIdentifier(dependency.nodeId);
    if (!targetNodeId)
        return null;
    const targetServiceId = normalizeIdentifier(dependency.serviceId);
    return nodes.find((node) => {
        if (normalizeIdentifier(node.nodeId) !== targetNodeId)
            return false;
        if (targetServiceId && normalizeIdentifier(node.serviceId) !== targetServiceId)
            return false;
        return true;
    }) || null;
}
function selectedDependencyInstallAction(dependency: LocalRuntimeDependencyDescriptor, reasonCode: string): ModRuntimeLocalProfileSnapshot['repairActions'][number] {
    return buildDependencyRepairAction({
        actionId: `install:${dependency.entryId}`,
        dependency,
        reasonCode,
        label: dependencyRepairLabel(dependency),
    });
}
function assessDependencyRuntimeState(input: {
    dependency: LocalRuntimeDependencyDescriptor;
    models: LocalRuntimeAssetRecord[];
    services: LocalRuntimeServiceDescriptor[];
    nodes: LocalRuntimeNodeDescriptor[];
}): DependencyRuntimeAssessment {
    const { dependency, models, services, nodes } = input;
    const warnings = [...(Array.isArray(dependency.warnings) ? dependency.warnings : [])];
    const repairActions: ModRuntimeLocalProfileSnapshot['repairActions'] = [];
    let readiness: DependencyReadiness = 'ready';
    let reasonCode = String(dependency.reasonCode || '').trim() || undefined;
    if (!dependency.selected) {
        if (dependency.required) {
            reasonCode = reasonCode || 'LOCAL_AI_DEPENDENCY_NOT_SELECTED';
            warnings.push('required runtime entry not selected by resolver');
            readiness = 'missing';
            repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
        }
        return {
            entry: toDependencyEntry(dependency, {
                reasonCode,
                warnings: uniqueStrings(warnings),
            }),
            readiness,
            repairActions,
        };
    }
    if (dependency.kind === 'asset') {
        const model = findModelForDependency(dependency, models);
        if (!model || model.status === 'removed') {
            reasonCode = 'LOCAL_AI_DEPENDENCY_MODEL_NOT_INSTALLED';
            warnings.push('selected model entry is not installed');
            readiness = dependency.required ? 'missing' : 'degraded';
            repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
        }
        else if (model.status === 'unhealthy') {
            reasonCode = 'LOCAL_AI_DEPENDENCY_MODEL_UNHEALTHY';
            warnings.push('selected model entry is unhealthy');
            readiness = 'degraded';
            repairActions.push(buildDependencyRepairAction({
                actionId: `fix:model:${dependency.entryId}`,
                dependency,
                reasonCode,
                label: `Repair model ${model.assetId}`,
            }));
        }
        else if (model.status !== 'active') {
            reasonCode = 'LOCAL_AI_DEPENDENCY_MODEL_NOT_ACTIVE';
            warnings.push('selected model entry is installed but not active');
            readiness = dependency.required ? 'missing' : 'degraded';
            repairActions.push(buildDependencyRepairAction({
                actionId: `start:model:${dependency.entryId}`,
                dependency,
                reasonCode,
                label: `Start model ${model.assetId}`,
            }));
        }
    }
    else if (dependency.kind === 'service') {
        const service = findServiceForDependency(dependency, services);
        if (!service || service.status === 'removed') {
            reasonCode = 'LOCAL_AI_DEPENDENCY_SERVICE_NOT_INSTALLED';
            warnings.push('selected service entry is not installed');
            readiness = dependency.required ? 'missing' : 'degraded';
            repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
        }
        else if (service.status === 'unhealthy') {
            reasonCode = 'LOCAL_AI_DEPENDENCY_SERVICE_UNHEALTHY';
            warnings.push('selected service entry is unhealthy');
            readiness = 'degraded';
            repairActions.push(buildDependencyRepairAction({
                actionId: `fix:service:${dependency.entryId}`,
                dependency,
                reasonCode,
                label: `Repair service ${service.serviceId}`,
            }));
        }
        else if (service.status !== 'active') {
            reasonCode = 'LOCAL_AI_DEPENDENCY_SERVICE_NOT_ACTIVE';
            warnings.push('selected service entry is installed but not active');
            readiness = dependency.required ? 'missing' : 'degraded';
            repairActions.push(buildDependencyRepairAction({
                actionId: `start:service:${dependency.entryId}`,
                dependency,
                reasonCode,
                label: `Start service ${service.serviceId}`,
            }));
        }
    }
    else if (dependency.kind === 'node') {
        const node = findNodeForDependency(dependency, nodes);
        if (!node) {
            reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_NOT_AVAILABLE';
            warnings.push('selected node entry is not available in node catalog');
            readiness = dependency.required ? 'missing' : 'degraded';
            repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
        }
        else {
            const hostService = services.find((service) => normalizeIdentifier(service.serviceId) === normalizeIdentifier(node.serviceId)) || null;
            if (!hostService || hostService.status === 'removed') {
                reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_SERVICE_NOT_INSTALLED';
                warnings.push('node host service is not installed');
                readiness = dependency.required ? 'missing' : 'degraded';
                repairActions.push(selectedDependencyInstallAction(dependency, reasonCode));
            }
            else if (hostService.status === 'unhealthy') {
                reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_SERVICE_UNHEALTHY';
                warnings.push('node host service is unhealthy');
                readiness = 'degraded';
                repairActions.push(buildDependencyRepairAction({
                    actionId: `fix:node-host:${dependency.entryId}`,
                    dependency,
                    reasonCode,
                    label: `Repair node host ${hostService.serviceId}`,
                }));
            }
            else if (hostService.status !== 'active') {
                reasonCode = 'LOCAL_AI_DEPENDENCY_NODE_SERVICE_NOT_ACTIVE';
                warnings.push('node host service is installed but not active');
                readiness = dependency.required ? 'missing' : 'degraded';
                repairActions.push(buildDependencyRepairAction({
                    actionId: `start:node-host:${dependency.entryId}`,
                    dependency,
                    reasonCode,
                    label: `Start node host ${hostService.serviceId}`,
                }));
            }
        }
    }
    return {
        entry: toDependencyEntry(dependency, {
            reasonCode,
            warnings: uniqueStrings(warnings),
        }),
        readiness,
        repairActions,
    };
}
function dedupeRepairActions(actions: ModRuntimeLocalProfileSnapshot['repairActions']): ModRuntimeLocalProfileSnapshot['repairActions'] {
    const dedupe = new Map<string, ModRuntimeLocalProfileSnapshot['repairActions'][number]>();
    for (const action of actions) {
        const actionId = String(action.actionId || '').trim();
        if (!actionId)
            continue;
        if (!dedupe.has(actionId)) {
            dedupe.set(actionId, action);
        }
    }
    return Array.from(dedupe.values());
}
function isDependencyRequiredById(dependencies: LocalRuntimeDependencyResolutionPlan['entries'], entryId: string | undefined): boolean {
    const normalized = normalizeIdentifier(entryId);
    if (!normalized)
        return false;
    return dependencies.some((item: LocalRuntimeDependencyDescriptor) => normalizeIdentifier(item.entryId) === normalized && item.required);
}
function buildRepairActionsFromPlan(plan: LocalRuntimeDependencyResolutionPlan): ModRuntimeLocalProfileSnapshot['repairActions'] {
    const actions: ModRuntimeLocalProfileSnapshot['repairActions'] = [];
    for (const dep of plan.entries) {
        if (!dep.required || dep.selected)
            continue;
        actions.push({
            actionId: `install:${dep.entryId}`,
            label: dependencyRepairLabel(dep),
            reasonCode: dep.reasonCode || 'LOCAL_AI_DEPENDENCY_NOT_SELECTED',
            entryId: dep.entryId,
            capability: mapLocalRuntimeCapabilityToCanonical(dep.capability),
        });
    }
    for (const decision of plan.preflightDecisions) {
        if (decision.ok)
            continue;
        actions.push({
            actionId: `preflight:${decision.target}:${decision.check}`,
            label: `Resolve preflight: ${decision.check}`,
            reasonCode: decision.reasonCode || 'LOCAL_AI_PREFLIGHT_FAILED',
            entryId: decision.entryId,
        });
    }
    if (actions.length === 0 && plan.warnings.length > 0) {
        actions.push({
            actionId: 'runtime:review-warnings',
            label: 'Review profile warnings in Runtime Setup',
            reasonCode: plan.reasonCode || 'LOCAL_AI_DEPENDENCY_WARNING',
        });
    }
    return actions;
}
function toHookEntryKind(kind: string): HookModLocalProfileSnapshot['entries'][number]['kind'] {
    if (kind === 'service') return 'service';
    if (kind === 'node') return 'node';
    return 'asset';
}
function toHookSnapshot(snapshot: ModRuntimeLocalProfileSnapshot): HookModLocalProfileSnapshot {
    return {
        ...snapshot,
        entries: snapshot.entries.map((entry) => ({
            ...entry,
            kind: toHookEntryKind(entry.kind),
        })),
    };
}
export function createModLocalProfileSnapshotResolver(): (input: {
    modId: string;
    capability?: RuntimeCanonicalCapability;
    routeSourceHint?: 'cloud' | 'local';
}) => Promise<HookModLocalProfileSnapshot> {
    return async (input) => {
        const modId = String(input.modId || '').trim();
        const capability = input.capability;
        const localRuntimeCapability = mapCanonicalCapabilityToLocalRuntime(capability);
        const routeSourceHint = input.routeSourceHint;
        if (routeSourceHint === 'cloud' && capability) {
            return {
                modId,
                status: 'ready',
                routeSource: 'cloud',
                warnings: [],
                entries: [],
                repairActions: [],
                updatedAt: new Date().toISOString(),
            };
        }
        if (!modId) {
            return {
                modId: '',
                status: 'missing',
                routeSource: 'cloud',
                reasonCode: ReasonCode.LOCAL_AI_MOD_ID_REQUIRED,
                warnings: ['modId required'],
                entries: [],
                repairActions: [{
                        actionId: 'runtime:open-setup',
                        label: 'Open Runtime Setup',
                        reasonCode: ReasonCode.LOCAL_AI_MOD_ID_REQUIRED,
                    }],
                updatedAt: new Date().toISOString(),
            };
        }
        const profiles = readManifestProfiles(modId);
        if (profiles.length <= 0) {
            return {
                modId,
                status: 'missing',
                routeSource: 'cloud',
                reasonCode: ReasonCode.LOCAL_AI_PROFILES_DECLARATION_MISSING,
                warnings: ['manifest ai.profiles missing'],
                entries: [],
                repairActions: [{
                        actionId: 'runtime:open-setup',
                        label: 'Open Runtime Setup',
                        reasonCode: ReasonCode.LOCAL_AI_PROFILES_DECLARATION_MISSING,
                    }],
                updatedAt: new Date().toISOString(),
            };
        }
        const profile = selectProfile(profiles, capability);
        if (!profile) {
            return {
                modId,
                status: 'missing',
                routeSource: 'cloud',
                reasonCode: ReasonCode.LOCAL_AI_PROFILE_NOT_FOUND,
                warnings: ['no matching ai profile found'],
                entries: [],
                repairActions: [{
                        actionId: 'runtime:open-setup',
                        label: 'Open Runtime Setup',
                        reasonCode: ReasonCode.LOCAL_AI_PROFILE_NOT_FOUND,
                    }],
                updatedAt: new Date().toISOString(),
            };
        }
        const plan: LocalRuntimeProfileResolutionPlan = await localRuntime.resolveProfile({
            modId,
            capability: localRuntimeCapability,
            profile,
        });
        let models: LocalRuntimeAssetRecord[] = [];
        let services: LocalRuntimeServiceDescriptor[] = [];
        let nodes: LocalRuntimeNodeDescriptor[] = [];
        let assets: Awaited<ReturnType<typeof localRuntime.listAssets>> = [];
        const inventoryWarnings: string[] = [];
        try {
            // Keep inventory reads serialized to avoid spiking the runtime bridge with
            // four concurrent IPC calls every time mods refresh dependency status.
            models = await localRuntime.listAssets();
            services = await localRuntime.listServices();
            nodes = await localRuntime.listNodesCatalog(localRuntimeCapability ? { capability: localRuntimeCapability } : undefined);
            assets = models;
        }
        catch (error) {
            inventoryWarnings.push(`runtime inventory unavailable: ${error instanceof Error ? error.message : String(error || '')}`);
        }
        const assessments = plan.executionPlan.entries.map((dependency) => assessDependencyRuntimeState({
            dependency,
            models,
            services,
            nodes,
        }));
        const runtimeEntries = assessments.map((item) => item.entry);
        const runtimeRepairActions = assessments.flatMap((item) => item.repairActions);
        const passiveAssetAssessments = plan.assetEntries.map((entry) => assessPassiveAssetRuntimeState({
            entry,
            assets,
        }));
        const assetEntries = passiveAssetAssessments.map((item) => item.entry);
        const assetRepairActions = passiveAssetAssessments.flatMap((item) => item.repairActions);
        const hasMissingRequiredInRuntime = assessments.some((item) => item.readiness === 'missing' && item.entry.required);
        const hasMissingRequiredAssets = passiveAssetAssessments.some((item) => item.readiness === 'missing' && item.entry.required);
        const hasDegradedInRuntime = assessments.some((item) => item.readiness === 'degraded');
        const hasDegradedAssets = passiveAssetAssessments.some((item) => item.readiness === 'degraded');
        const hasAnySelectedRuntimeDependency = assessments.some((item) => item.entry.selected);
        const hasAnyRuntimeReadySelection = assessments.some((item) => item.entry.selected && item.readiness === 'ready');
        const firstRuntimeReasonCode = assessments.find((item) => item.readiness !== 'ready' && String(item.entry.reasonCode || '').trim().length > 0)?.entry.reasonCode;
        const firstAssetReasonCode = passiveAssetAssessments.find((item) => item.readiness !== 'ready' && String(item.entry.reasonCode || '').trim().length > 0)?.entry.reasonCode;
        const failedRequiredPreflight = plan.executionPlan.preflightDecisions.find((item) => !item.ok && isDependencyRequiredById(plan.executionPlan.entries, item.entryId));
        const hasFailedPreflight = plan.executionPlan.preflightDecisions.some((item) => !item.ok);
        const warnings = uniqueStrings([
            ...plan.warnings,
            ...inventoryWarnings,
            ...runtimeEntries.flatMap((item) => item.warnings),
            ...assetEntries.flatMap((item) => item.warnings),
        ]);
        const hasMissingRequired = hasMissingRequiredInRuntime || hasMissingRequiredAssets || Boolean(failedRequiredPreflight);
        const hasDegraded = hasDegradedInRuntime || hasDegradedAssets || hasFailedPreflight || warnings.length > 0;
        const status: ModRuntimeLocalProfileSnapshot['status'] = hasMissingRequired ? 'missing' : (hasDegraded ? 'degraded' : 'ready');
        const routeSource: ModRuntimeLocalProfileSnapshot['routeSource'] = !hasAnySelectedRuntimeDependency
            ? 'cloud'
                : status === 'ready'
                    ? 'local'
                        : (hasAnyRuntimeReadySelection ? 'mixed' : 'cloud');
        const repairActions = dedupeRepairActions([
            ...runtimeRepairActions,
            ...assetRepairActions,
            ...buildRepairActionsFromPlan(plan.executionPlan),
        ]);
        const reasonCode = firstRuntimeReasonCode
            || firstAssetReasonCode
            || failedRequiredPreflight?.reasonCode
            || plan.executionPlan.preflightDecisions.find((item) => !item.ok)?.reasonCode
            || plan.reasonCode;
        return toHookSnapshot({
            modId,
            planId: plan.planId,
            status,
            routeSource,
            reasonCode,
            warnings,
            entries: [...runtimeEntries, ...assetEntries].length > 0
                ? [...runtimeEntries, ...assetEntries]
                : toDependencyEntries(plan.executionPlan.entries),
            repairActions,
            updatedAt: new Date().toISOString(),
        });
    };
}
