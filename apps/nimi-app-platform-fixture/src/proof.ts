import { createAppScopeRef, type NimiAppScopeRef } from '@nimiplatform/sdk/app';

export const FIXTURE_APP_ID = 'community.nimi.fixture.platform-proof';

export type FixtureProbeState = 'pending' | 'ok' | 'not-granted';

export type FixtureProof = {
  readonly appId: typeof FIXTURE_APP_ID;
  readonly admissionTrack: 'admission-sandbox-ci';
  readonly productReadinessClaimAllowed: false;
  readonly developerRegistration: false;
  readonly localAdoption: false;
  readonly scopeRef: NimiAppScopeRef;
  readonly realm: {
    readonly account: FixtureProbeState;
    readonly feed: FixtureProbeState;
    readonly world: FixtureProbeState;
  };
  readonly runtime: {
    readonly protectedGrant: FixtureProbeState;
    readonly aiConsume: FixtureProbeState;
  };
  readonly appScope: {
    readonly aiConfig: FixtureProbeState;
    readonly storage: FixtureProbeState;
    readonly localAssets: FixtureProbeState;
  };
};

export function createInitialFixtureProof(): FixtureProof {
  return {
    appId: FIXTURE_APP_ID,
    admissionTrack: 'admission-sandbox-ci',
    productReadinessClaimAllowed: false,
    developerRegistration: false,
    localAdoption: false,
    scopeRef: createAppScopeRef({ appId: FIXTURE_APP_ID, surfaceId: 'platform-proof' }),
    realm: {
      account: 'pending',
      feed: 'pending',
      world: 'pending',
    },
    runtime: {
      protectedGrant: 'pending',
      aiConsume: 'pending',
    },
    appScope: {
      aiConfig: 'pending',
      storage: 'pending',
      localAssets: 'pending',
    },
  };
}
