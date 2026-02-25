import i18next from 'i18next';
import { getI18n, initReactI18next, useTranslation as useModTranslation, } from 'react-i18next';
export { useModTranslation };
let runtimeI18nBinding = null;
const pendingTranslations = new Map();
function ensureFallbackI18nextReady(locale) {
    const normalizedLocale = String(locale || '').trim() || 'en';
    if (i18next.isInitialized) {
        return;
    }
    i18next.use(initReactI18next);
    void i18next.init({
        lng: normalizedLocale,
        fallbackLng: normalizedLocale,
        resources: {},
        initImmediate: false,
        interpolation: {
            escapeValue: false,
        },
    });
}
function normalizeRuntimeI18n(value) {
    if (value && typeof value === 'object') {
        const candidate = value;
        if (typeof candidate.addResourceBundle === 'function') {
            return candidate;
        }
    }
    return null;
}
function resolveBoundRuntimeI18n() {
    if (runtimeI18nBinding) {
        return runtimeI18nBinding;
    }
    return normalizeRuntimeI18n(getI18n());
}
function resolveRuntimeI18n(locale) {
    const boundI18n = resolveBoundRuntimeI18n();
    if (boundI18n) {
        return boundI18n;
    }
    ensureFallbackI18nextReady(locale);
    return i18next;
}
function buildPendingTranslationKey(modId, locale) {
    return `${modId}::${locale}`;
}
function resolveLocaleTargets(i18nInstance, locale) {
    const normalizedLocale = String(locale || '').trim() || 'en';
    const baseLocale = normalizedLocale.split('-')[0] || normalizedLocale;
    const targets = new Set([normalizedLocale, baseLocale]);
    const candidates = [
        i18nInstance.language,
        i18nInstance.resolvedLanguage,
        ...(Array.isArray(i18nInstance.languages) ? i18nInstance.languages : []),
    ];
    for (const candidate of candidates) {
        const normalizedCandidate = String(candidate || '').trim();
        if (!normalizedCandidate)
            continue;
        const candidateBase = normalizedCandidate.split('-')[0] || normalizedCandidate;
        if (normalizedCandidate === normalizedLocale
            || normalizedCandidate.startsWith(`${normalizedLocale}-`)
            || normalizedLocale.startsWith(`${normalizedCandidate}-`)
            || candidateBase === baseLocale) {
            targets.add(normalizedCandidate);
            targets.add(candidateBase);
        }
    }
    return Array.from(targets.values());
}
function registerBundle(input) {
    const i18nInstance = resolveRuntimeI18n(input.locale);
    const targetLocales = resolveLocaleTargets(i18nInstance, input.locale);
    for (const targetLocale of targetLocales) {
        i18nInstance.addResourceBundle(targetLocale, input.modId, input.translations, true, false);
    }
}
function flushPendingTranslations() {
    if (pendingTranslations.size === 0) {
        return;
    }
    const pending = Array.from(pendingTranslations.values());
    pendingTranslations.clear();
    for (const entry of pending) {
        registerBundle(entry);
    }
}
export function bindRuntimeI18n(instance) {
    runtimeI18nBinding = normalizeRuntimeI18n(instance);
    if (runtimeI18nBinding) {
        flushPendingTranslations();
    }
}
export function unbindRuntimeI18n() {
    runtimeI18nBinding = null;
}
export function getPendingModTranslationCount() {
    return pendingTranslations.size;
}
function shouldQueuePendingTranslation() {
    return !resolveBoundRuntimeI18n();
}
function queuePendingTranslation(entry) {
    const queueKey = buildPendingTranslationKey(entry.modId, entry.locale);
    pendingTranslations.set(queueKey, entry);
}
export function flushPendingModTranslations() {
    flushPendingTranslations();
}
function resolveRuntimeI18nForRegistration(locale) {
    const boundI18n = getI18n();
    if (!runtimeI18nBinding && boundI18n && typeof boundI18n.addResourceBundle === 'function') {
        runtimeI18nBinding = boundI18n;
    }
    return resolveRuntimeI18n(locale);
}
export function registerModTranslations(modId, locale, translations) {
    const normalizedModId = String(modId || '').trim();
    if (!normalizedModId) {
        return;
    }
    const normalizedLocale = String(locale || '').trim() || 'en';
    const entry = {
        modId: normalizedModId,
        locale: normalizedLocale,
        translations,
    };
    if (shouldQueuePendingTranslation()) {
        queuePendingTranslation(entry);
        const fallbackInstance = resolveRuntimeI18nForRegistration(normalizedLocale);
        const targetLocales = resolveLocaleTargets(fallbackInstance, normalizedLocale);
        for (const targetLocale of targetLocales) {
            fallbackInstance.addResourceBundle(targetLocale, normalizedModId, translations, true, false);
        }
        return;
    }
    registerBundle(entry);
}
