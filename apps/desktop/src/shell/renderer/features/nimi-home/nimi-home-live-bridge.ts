// Nimi Home live bridge.
//
// Provides the typed surface Nimi Home consumes for factory AIProfile
// selection, AIProfile apply, and Nimi App registry projection. This
// module consumes only:
// - `@nimiplatform/sdk/ai` for `applyAIProfileToConfig` + types
// - `@nimiplatform/sdk/app` for Nimi App registry typed access
// - the platform catalog for factory AIProfile rows
// - the Desktop host `AIConfig` service for atomic config writes
// - the local Runtime client for host capability evidence
//
// T4 Fork C: the Nimi App registry / package status the `NimiAppClient`
// consumes is sourced from the runtime `~/.nimi/apps/registry.json` +
// `~/.nimi/apps/packages.json` projections (via the `apps_bridge_projection_get`
// Tauri command), NOT from the build-time `platform-catalog/generated.ts`
// catalog. `generated.ts` is retired as the Apps bridge source; it remains the
// source only for the factory AIProfile catalog/rows used below.

import { NimiAppClient, createNimiAppRegistryTransport } from '@nimiplatform/sdk/app';
import {
  applyAIProfileToConfig,
  type AIProfile,
  type AIScopeRef as DesktopAIScopeRef,
} from '@nimiplatform/sdk/ai';
import { localRuntime } from '@runtime/local-runtime';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import { getAppsBridgeProjection } from '@renderer/bridge';
import {
  loadPlatformAIProfileFactoryCatalog,
  loadPlatformAIProfileFactoryRows,
} from '../../../../runtime/platform-catalog/index.js';
import { selectFactoryAIProfileForFirstRun } from '../../first-run/install-level-policy.js';
import type { ColdStartState } from '../../first-run/types.js';

export interface NimiHomeAIProfileProjection {
  readonly profileState: ColdStartState;
  readonly materializationState: ColdStartState;
  readonly profileId?: string;
  readonly detail?: string;
}

export interface NimiHomeScopeRef {
  readonly kind: 'account' | 'app' | 'workspace' | 'first-run';
  readonly scopeId: string;
}

export interface DesktopHomeLiveBridge {
  readonly appClient: NimiAppClient;
  readonly projectAIProfileSelection: () => Promise<NimiHomeAIProfileProjection>;
  readonly applyAgentChatProfile: (
    scopeRef: NimiHomeScopeRef,
    profileId: string,
  ) => Promise<{ applied: boolean }>;
}

export function createDesktopHomeLiveBridge(): DesktopHomeLiveBridge {
  // T4 Fork C: the Nimi App registry transport is fed by the runtime
  // `~/.nimi/apps` projections. `getAppsBridgeProjection()` materializes
  // `registry.json` + `packages.json` and returns the three SDK transport
  // loader payloads. The projection is fetched once per bridge instance and
  // shared by every loader so the three loaders see one consistent snapshot.
  let projectionPromise: ReturnType<typeof getAppsBridgeProjection> | null = null;
  const loadProjection = (): ReturnType<typeof getAppsBridgeProjection> => {
    if (!projectionPromise) {
      projectionPromise = getAppsBridgeProjection();
    }
    return projectionPromise;
  };
  const appClient = new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: async () => (await loadProjection()).registryRows,
    loadReleaseDescriptors: async () => (await loadProjection()).releaseDescriptors,
    loadInstallEvidence: async () => (await loadProjection()).installEvidence,
  }));

  return {
    appClient,
    projectAIProfileSelection: async () => {
      const rows = loadPlatformAIProfileFactoryRows();
      const recommendation = selectFactoryAIProfileForFirstRun(rows, 'minimal');
      if (!recommendation) {
        return {
          profileState: 'unavailable',
          materializationState: 'unavailable',
          detail: 'no admitted factory AIProfile row available',
        };
      }
      try {
        const deviceProfile = await localRuntime.collectDeviceProfile();
        const hostReady = Boolean(deviceProfile);
        return {
          profileState: hostReady ? 'ready' : 'unavailable',
          materializationState: recommendation.materializationConfirmationRequired
            ? 'needs-confirmation'
            : hostReady ? 'ready' : 'unavailable',
          profileId: recommendation.alias,
        };
      } catch (error) {
        return {
          profileState: 'unavailable',
          materializationState: 'unavailable',
          profileId: recommendation.alias,
          detail: error instanceof Error ? error.message : 'AIProfile selection unavailable',
        };
      }
    },
    applyAgentChatProfile: (scopeRef, profileId) =>
      applyFactoryAIProfile({ kind: scopeRef.kind, id: scopeRef.scopeId }, profileId)
        .then((result) => ({ applied: result.applied })),
  };
}

interface InternalScopeRef {
  readonly kind: 'account' | 'app' | 'workspace' | 'first-run';
  readonly id: string;
}

interface ApplyResult {
  readonly applied: boolean;
  readonly profileId: string;
  readonly scope: InternalScopeRef;
}

async function applyFactoryAIProfile(scopeRef: InternalScopeRef, profileId: string): Promise<ApplyResult> {
  const profile = findPlatformAIProfile(profileId);
  if (!profile) {
    return { applied: false, profileId, scope: scopeRef };
  }
  const aiScopeRef = toDesktopAIScopeRef(scopeRef);
  const service = getDesktopAIConfigService();
  const baseConfig = service.aiConfig.get(aiScopeRef);
  service.aiConfig.update(aiScopeRef, applyAIProfileToConfig(baseConfig, profile));
  return { applied: true, profileId, scope: scopeRef };
}

function findPlatformAIProfile(profileId: string): AIProfile | null {
  return loadPlatformAIProfileFactoryCatalog().find((profile) => profile.profileId === profileId) ?? null;
}

function toDesktopAIScopeRef(scopeRef: InternalScopeRef): DesktopAIScopeRef {
  if (scopeRef.kind === 'app') {
    return { kind: 'app', ownerId: scopeRef.id };
  }
  return { kind: 'feature', ownerId: 'nimi.home', surfaceId: scopeRef.id };
}
