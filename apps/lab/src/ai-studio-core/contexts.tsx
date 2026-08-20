import { createContext } from 'react';

import type { StudioParameterState, StudioParameterValue } from './parameters.js';

export type StudioHistoryPanelScope = 'capability' | 'all' | 'media';

export type StudioMediaHistoryRecord = {
  readonly id: string;
  readonly runId?: string;
  readonly kind?: 'runtime-media';
  readonly capabilityId: string;
  readonly capabilityLabel?: string;
  readonly title: string;
  readonly status: 'unavailable' | 'ready' | 'failed';
  readonly createdAt: string;
  readonly artifactCount?: number;
  readonly artifactLabel?: string;
  readonly relativePath?: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
  readonly jobId?: string;
  readonly jobState?: string;
  readonly message?: string;
  readonly traceState?: 'captured' | 'not-captured';
  readonly traceId?: string;
};

export type StudioHistoryLoadState = {
  readonly title: string;
  readonly error: string | null;
  readonly retry: () => void;
};

export const StudioHistoryLoadContext = createContext<StudioHistoryLoadState | null>(null);

export type StudioHistoryActions = {
  readonly removeRecord: (recordId: string, deleteAsset?: boolean) => Promise<void>;
  readonly clearScope: (capabilityId: string | null, deleteAssets: boolean) => Promise<void>;
};

export const StudioHistoryActionsContext = createContext<StudioHistoryActions | null>(null);

export type StudioHistoryPanelState = {
  readonly collapsed: boolean;
  readonly scope: StudioHistoryPanelScope;
  readonly hideFailures: boolean;
  readonly imageRecords: readonly StudioMediaHistoryRecord[];
  readonly setCollapsed: (collapsed: boolean) => void;
  readonly setScope: (scope: StudioHistoryPanelScope) => void;
  readonly setHideFailures: (hideFailures: boolean) => void;
};

export const StudioHistoryPanelContext = createContext<StudioHistoryPanelState | null>(null);

export type StudioCapabilityParameterStore = {
  readonly state: StudioParameterState;
  readonly setParameters: (capabilityId: string, parameters: StudioParameterValue) => void;
};

export const StudioCapabilityParameterContext = createContext<StudioCapabilityParameterStore | null>(null);
