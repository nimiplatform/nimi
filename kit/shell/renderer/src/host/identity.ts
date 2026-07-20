import type { NimiRendererInstanceScope } from './types.js';

const OPAQUE_PREFIX_PATTERN = /^[a-z][a-z0-9-]{7,127}$/u;
const LOCAL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;

export function createNimiRendererInstanceScope(
  opaquePrefix: string,
): NimiRendererInstanceScope {
  if (!OPAQUE_PREFIX_PATTERN.test(opaquePrefix)) {
    throw new Error('NIMI_RENDERER_HOST_SCOPE_PREFIX_INVALID');
  }

  function assertLocal(value: string): void {
    if (!LOCAL_ID_PATTERN.test(value)) {
      throw new Error('NIMI_RENDERER_HOST_LOCAL_ID_INVALID');
    }
  }

  return Object.freeze({
    domId(localId: string): string {
      assertLocal(localId);
      return `${opaquePrefix}--id--${localId}`;
    },
    globalName(localName: string): string {
      assertLocal(localName);
      return `${opaquePrefix}--global--${localName}`;
    },
  });
}
