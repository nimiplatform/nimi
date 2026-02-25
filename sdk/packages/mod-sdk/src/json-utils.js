export function asRecord(value, options) {
    if (!value || typeof value !== 'object') {
        return {};
    }
    if (!options?.allowArray && Array.isArray(value)) {
        return {};
    }
    return value;
}
export function safeParseJson(text, fallback) {
    try {
        return JSON.parse(String(text || ''));
    }
    catch {
        return fallback;
    }
}
export function safeParseObject(text) {
    const parsed = safeParseJson(String(text || '{}'), {});
    return asRecord(parsed);
}
export function safeParseArray(text) {
    const parsed = safeParseJson(String(text || '[]'), []);
    return Array.isArray(parsed) ? parsed : [];
}
export function toStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}
export function toFiniteNumber(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
export function clamp01(value, fallback = 0.5) {
    const numeric = toFiniteNumber(value, fallback);
    return Math.max(0, Math.min(1, numeric));
}
