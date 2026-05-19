import type { AIScopeRef } from '@nimiplatform/sdk/mod';

export const TESTER_APP_ID = 'nimi.tester';
export const TESTER_APP_INSTANCE_ID = 'nimi.tester.local-first-party';
export const TESTER_AI_SURFACE_ID = 'tester';
export const TESTER_RUNTIME_CLIENT_ID = TESTER_APP_ID;

export const TESTER_AI_SCOPE_REF: AIScopeRef = {
  kind: 'app',
  ownerId: TESTER_APP_ID,
  surfaceId: TESTER_AI_SURFACE_ID,
};
