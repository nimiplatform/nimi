type BundledEnvRecord = Record<string, string | boolean | undefined>;

type GlobalWithBundledEnv = typeof globalThis & {
  __NIMI_IMPORT_META_ENV__?: BundledEnvRecord;
};

export function installBundledImportMetaEnv(env: BundledEnvRecord): void {
  const runtimeGlobal = globalThis as GlobalWithBundledEnv;
  runtimeGlobal.__NIMI_IMPORT_META_ENV__ = {
    ...(runtimeGlobal.__NIMI_IMPORT_META_ENV__ || {}),
    ...env,
  };
}
