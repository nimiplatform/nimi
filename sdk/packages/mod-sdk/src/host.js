const MOD_SDK_HOST_KEY = '__NIMI_MOD_SDK_HOST__';
function readHost() {
    const value = globalThis[MOD_SDK_HOST_KEY];
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value;
}
export function setModSdkHost(host) {
    globalThis[MOD_SDK_HOST_KEY] = host;
}
export function clearModSdkHost() {
    delete globalThis[MOD_SDK_HOST_KEY];
}
export function getModSdkHost() {
    const host = readHost();
    if (host) {
        return host;
    }
    throw new Error('MOD_SDK_HOST_NOT_READY');
}
