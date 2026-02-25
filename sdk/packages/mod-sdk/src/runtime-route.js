import { asRecord } from './json-utils';
export function normalizeRuntimeRouteSource(value) {
    return String(value || '').trim() === 'token-api' ? 'token-api' : 'local-runtime';
}
export function parseRuntimeRouteBinding(value) {
    if (!value || typeof value !== 'object')
        return null;
    const record = asRecord(value);
    return {
        source: normalizeRuntimeRouteSource(record.source),
        connectorId: String(record.connectorId || ''),
        model: String(record.model || ''),
        localModelId: String(record.localModelId || '').trim() || undefined,
        engine: String(record.engine || '').trim() || undefined,
    };
}
function toPositiveInt(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return undefined;
    const rounded = Math.floor(numeric);
    return rounded > 0 ? rounded : undefined;
}
function normalizeContextSource(value) {
    const normalized = String(value || '').trim();
    if (normalized === 'provider-api'
        || normalized === 'template'
        || normalized === 'default'
        || normalized === 'unknown') {
        return normalized;
    }
    return undefined;
}
function parseRuntimeRouteModelProfiles(value) {
    if (!Array.isArray(value))
        return [];
    const deduped = new Set();
    const parsed = [];
    for (const item of value) {
        const record = asRecord(item);
        const model = String(record.model || record.id || '').trim();
        if (!model)
            continue;
        const dedupeKey = model.toLowerCase();
        if (deduped.has(dedupeKey))
            continue;
        deduped.add(dedupeKey);
        const maxContextTokens = toPositiveInt(record.maxContextTokens);
        const maxOutputTokens = toPositiveInt(record.maxOutputTokens);
        const contextSource = normalizeContextSource(record.contextSource);
        parsed.push({
            model,
            ...(typeof maxContextTokens === 'number' ? { maxContextTokens } : {}),
            ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
            ...(contextSource ? { contextSource } : {}),
        });
    }
    return parsed;
}
function parseLocalRuntimeModels(value) {
    if (!Array.isArray(value))
        return [];
    const deduped = new Set();
    const models = [];
    for (const item of value) {
        const record = asRecord(item);
        const localModelId = String(record.localModelId || record.id || '').trim();
        if (!localModelId)
            continue;
        const dedupeKey = localModelId.toLowerCase();
        if (deduped.has(dedupeKey))
            continue;
        deduped.add(dedupeKey);
        const model = String(record.model || record.name || '').trim() || localModelId;
        models.push({
            localModelId,
            label: String(record.label || '').trim() || undefined,
            engine: String(record.engine || '').trim() || undefined,
            model,
            endpoint: String(record.endpoint || '').trim() || undefined,
            status: String(record.status || '').trim() || undefined,
            capabilities: Array.isArray(record.capabilities)
                ? record.capabilities.map((capability) => String(capability || '').trim()).filter(Boolean)
                : undefined,
        });
    }
    return models;
}
export function parseRuntimeRouteOptions(value, options) {
    const record = asRecord(value);
    const selected = parseRuntimeRouteBinding(record.selected);
    if (!selected)
        return null;
    const resolvedDefault = parseRuntimeRouteBinding(record.resolvedDefault) || undefined;
    const localRuntime = asRecord(record.localRuntime);
    const localRuntimeModels = parseLocalRuntimeModels(localRuntime.models);
    const connectors = (Array.isArray(record.connectors) ? record.connectors : [])
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
        const connector = asRecord(item);
        const modelProfiles = parseRuntimeRouteModelProfiles(connector.modelProfiles);
        return {
            id: String(connector.id || ''),
            label: String(connector.label || ''),
            vendor: String(connector.vendor || '').trim() || undefined,
            models: Array.isArray(connector.models)
                ? connector.models.map((model) => String(model || '').trim()).filter(Boolean)
                : [],
            ...(modelProfiles.length > 0 ? { modelProfiles } : {}),
        };
    })
        .filter((item) => item.id);
    return {
        selected,
        ...(options?.includeResolvedDefault ? { resolvedDefault: resolvedDefault || selected } : {}),
        localRuntime: {
            models: localRuntimeModels,
            defaultEndpoint: String(localRuntime.defaultEndpoint || '').trim() || undefined,
        },
        connectors,
    };
}
