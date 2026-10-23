import { createContext, useContext } from 'react';
import type { NimiAppActivityRecord, NimiAppActivityViewSnapshot } from '@nimiplatform/sdk/app';
import type { SystemEntryContext, SystemEntryProjection } from '../../../shared/system-entry-types.js';
import type { SystemEntryAIState } from './system-entry-ai-model.js';

export type HomeMessageNotice = Readonly<{ tone: 'info' | 'warning'; text: string }>;
export type HomeActivityViewKey = 'pending' | 'recent';
export type HomeAppActivity = Readonly<{
  pending: NimiAppActivityViewSnapshot;
  recent: NimiAppActivityViewSnapshot;
  busy: Readonly<Record<string, 'open' | 'read'>>;
  notices: Readonly<Record<string, HomeMessageNotice>>;
  open(record: NimiAppActivityRecord): void;
  markRead(record: NimiAppActivityRecord): void;
  retry(): void;
  loadMore(view: HomeActivityViewKey): void;
}>;

export type SystemEntryContextValue = Readonly<{
  hostContext: SystemEntryContext | null;
  homeVisible: boolean;
  projection: SystemEntryProjection | null;
  appActivity: HomeAppActivity;
  ai: SystemEntryAIState | null;
  refresh(): Promise<void>;
  openUsage(): Promise<void>;
  openCurrentWork(): Promise<void>;
}>;

export const SystemEntryProviderContext = createContext<SystemEntryContextValue | null>(null);

export function useSystemEntry(): SystemEntryContextValue {
  const context = useContext(SystemEntryProviderContext);
  if (!context) throw new Error('SYSTEM_ENTRY_PROVIDER_MISSING');
  return context;
}

/** Home and system overview consume the same two formal activity views. */
export function useHomeAppActivity(): HomeAppActivity { return useSystemEntry().appActivity; }

/** Current work and usage detail read these owner results, never RPC Usage. */
export function useSystemEntryAI(): SystemEntryAIState | null { return useSystemEntry().ai; }
