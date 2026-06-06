import {
  mergeNimiRuntimeBridgeDataRootConfig,
  mergeNimiRuntimeBridgeDeveloperRegistrationConfig,
  mergeNimiRuntimeBridgeRealmJwtConfig,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeConfigProjection = {
  dataRootChanged: boolean;
  jwtIssuer: string;
  developerRegistration: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createTesterRuntimeConfigProjection(): TesterRuntimeConfigProjection {
  const dataRoot = mergeNimiRuntimeBridgeDataRootConfig({ schemaVersion: 1 }, '/tester/nimi_data', '/tester/nimi_data/models');
  const jwt = mergeNimiRuntimeBridgeRealmJwtConfig(dataRoot.nextConfig, {
    realmBaseUrl: 'https://realm.tester.local',
    jwtIssuer: 'https://realm.tester.local',
    jwtAudience: 'nimi-runtime',
    jwksUrl: 'https://realm.tester.local/api/auth/jwks',
    revocationUrl: 'https://realm.tester.local/api/auth/sessions/introspect',
  });
  const developer = mergeNimiRuntimeBridgeDeveloperRegistrationConfig(jwt.nextConfig, true);
  const auth = asRecord(developer.nextConfig.auth);
  const jwtConfig = asRecord(auth.jwt);
  const developerRegistration = asRecord(auth.developerRegistration);
  return {
    dataRootChanged: dataRoot.changed,
    jwtIssuer: String(jwtConfig.issuer || ''),
    developerRegistration: developerRegistration.enabled === true,
  };
}
