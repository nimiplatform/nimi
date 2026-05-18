// Nimi Home live bridge.
//
// Provides the typed surface Nimi Home consumes for factory AIProfile
// selection, AIProfile apply, and Nimi App registry projection. This
// module consumes only:
// - `@nimiplatform/sdk/mod` for `applyAIProfileToConfig` + types
// - `@nimiplatform/sdk/app` for Nimi App registry typed access
// - the platform catalog for factory AIProfile rows
// - the Desktop host `AIConfig` service for atomic config writes
// - the local Runtime client for host capability evidence

import { NimiAppClient, createNimiAppRegistryTransport } from '@nimiplatform/sdk/app';
import {
  applyAIProfileToConfig,
  type AIProfile,
  type AIScopeRef as DesktopAIScopeRef,
} from '@nimiplatform/sdk/mod';
import { localRuntime } from '@runtime/local-runtime';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import {
  loadPlatformAIProfileFactoryCatalog,
  loadPlatformAIProfileFactoryRows,
  loadPlatformNimiAppRegistryRows,
  type PlatformAIProfileFactoryRow,
} from '../../../../runtime/platform-catalog/index.js';
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
  const appClient = new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: loadPlatformNimiAppRegistryRows,
  }));

  return {
    appClient,
    projectAIProfileSelection: async () => {
      const rows = loadPlatformAIProfileFactoryRows();
      const recommendation = selectFactoryAIProfile(rows);
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

function selectFactoryAIProfile(rows: readonly PlatformAIProfileFactoryRow[]): PlatformAIProfileFactoryRow | null {
  // Deterministic fallback selection while the Platform-owned AIProfile
  // selection policy (P-AIPS-004) is wired through typed inputs. The
  // selection here picks the first admitted row that lists `first-run`
  // in its applicable scopes; foundation-correction scope explicitly
  // excludes redesigning the product selection UX.
  for (const row of rows) {
    if (row.applicableScopes.includes('first-run')) {
      return row;
    }
  }
  return rows[0] ?? null;
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
