type ImportMetaEnvValue = string | boolean | undefined;

type GlobalEnvCarrier = typeof globalThis & {
  __NIMI_IMPORT_META_ENV__?: Record<string, ImportMetaEnvValue>;
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function normalizeEnvValue(value: ImportMetaEnvValue): string {
  return String(value || '').trim();
}

export function readBundledEnv(name: string): string {
  const globalEnv = globalThis as GlobalEnvCarrier;
  const fromImportMeta = normalizeEnvValue(globalEnv.__NIMI_IMPORT_META_ENV__?.[name]);
  if (fromImportMeta) {
    return fromImportMeta;
  }

  return normalizeEnvValue(globalEnv.process?.env?.[name]);
}
