// Desktop Apps read-only inventory projection.
//
// The SDK composes catalog, authenticated account inventory, optional
// Runtime-owned local records, and the global 0K immutable-package posture.
// Desktop renders that result without package jobs, filesystem inspection, or
// a second status/readiness authority.

import type {
  NimiAppClient,
  NimiAppInventoryEntry,
  NimiAppOrdinaryVisibility,
} from '@nimiplatform/sdk/app';
import { deriveAppCardState, type AppCardState } from './apps-card-state.js';

export interface DesktopAppsEntry {
  readonly app: NimiAppInventoryEntry;
  readonly cardState: AppCardState;
  readonly detail?: string;
  readonly catalogDiscoveryProof: DesktopAppsCatalogDiscoveryProof;
}

export interface DesktopAppsCatalogDiscoveryProof {
  readonly admittedCatalogDiscovery: boolean;
  readonly ordinaryVisibility: NimiAppOrdinaryVisibility | 'absent';
  readonly required: {
    readonly catalog: 'present';
    readonly ordinaryVisibility: 'ordinary-visible';
    readonly localRecord: 'absent';
  };
  readonly sources: {
    readonly catalog: NimiAppInventoryEntry['sources']['catalog']['status'];
    readonly account: NimiAppInventoryEntry['sources']['account']['status'];
    readonly localRecord: NimiAppInventoryEntry['sources']['localRecord']['status'];
    readonly packageReadiness: NimiAppInventoryEntry['sources']['packageReadiness']['status'];
  };
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
  | { readonly status: 'error'; readonly detail: string };

export async function projectAppsPanel(client: NimiAppClient): Promise<DesktopAppsPanelProjection> {
  if (!client) {
    return { status: 'error', detail: 'projectAppsPanel: nimiAppClient is required' };
  }

  let inventory: readonly NimiAppInventoryEntry[];
  try {
    inventory = await client.list();
  } catch (error) {
    return { status: 'error', detail: `list failed: ${errorMessage(error)}` };
  }

  return {
    status: 'loaded',
    entries: inventory.map(projectInventoryEntry),
  };
}

function projectInventoryEntry(app: NimiAppInventoryEntry): DesktopAppsEntry {
  const detail = resolveEntryDetail(app);
  return {
    app,
    cardState: deriveAppCardState(app),
    catalogDiscoveryProof: catalogDiscoveryProof(app),
    ...(detail ? { detail } : {}),
  };
}

function catalogDiscoveryProof(app: NimiAppInventoryEntry): DesktopAppsCatalogDiscoveryProof {
  const sources = {
    catalog: app.sources.catalog.status,
    account: app.sources.account.status,
    localRecord: app.sources.localRecord.status,
    packageReadiness: app.sources.packageReadiness.status,
  };
  const ordinaryVisibility = app.sources.catalog.value?.ordinaryVisibility ?? 'absent';
  return {
    admittedCatalogDiscovery:
      sources.catalog === 'present'
      && ordinaryVisibility === 'ordinary-visible'
      && sources.localRecord === 'absent',
    ordinaryVisibility,
    required: {
      catalog: 'present',
      ordinaryVisibility: 'ordinary-visible',
      localRecord: 'absent',
    },
    sources,
  };
}

function resolveEntryDetail(app: NimiAppInventoryEntry): string | undefined {
  return optionalText(app.detail)
    ?? optionalText(app.sources.localRecord.detail)
    ?? optionalText(app.sources.account.detail)
    ?? optionalText(app.sources.packageReadiness.value?.detail)
    ?? optionalText(app.sources.packageReadiness.detail)
    ?? optionalText(app.sources.catalog.detail);
}

function optionalText(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  const detailsCause = (error as { readonly details?: { readonly cause?: unknown } }).details?.cause;
  if (typeof detailsCause === 'string' && detailsCause.trim()) {
    return `${error.message}: ${detailsCause.trim()}`;
  }
  return error.message;
}
