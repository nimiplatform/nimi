/**
 * World Maintain Page — MAINTAIN pipeline wrapper (FG-WORLD-004)
 *
 * Imports World-Studio's MaintainWorkbench via @world-engine alias,
 * wires it to Forge's creator-world-store and world-data-client.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MaintainWorkbench } from '@world-engine/ui/maintain/maintain-workbench.js';
import type {
  EventNodeDraft,
  WorldLorebookDraftRow,
} from '@world-engine/contracts.js';
import { useCreatorWorldStore } from '@renderer/state/creator-world-store.js';
import {
  useWorldResourceQueries,
  type WorldMutationSummary,
} from '@renderer/hooks/use-world-queries.js';
import { useWorldMutations } from '@renderer/hooks/use-world-mutations.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type MaintainTab = 'WORLD' | 'WORLDVIEW' | 'EVENTS' | 'LOREBOOKS' | 'MUTATIONS';

export default function WorldMaintainPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { worldId = '' } = useParams<{ worldId: string }>();
  const queryClient = useQueryClient();

  // Auth
  const userId = useAppStore((s) => s.auth?.user?.id || '');

  // Store bindings
  const snapshot = useCreatorWorldStore((s) => s.snapshot);
  const patchSnapshot = useCreatorWorldStore((s) => s.patchSnapshot);
  const patchPanel = useCreatorWorldStore((s) => s.patchPanel);
  const hydrateForUser = useCreatorWorldStore((s) => s.hydrateForUser);
  const persistForUser = useCreatorWorldStore((s) => s.persistForUser);

  // Hydrate on mount
  useEffect(() => {
    if (userId) hydrateForUser(userId);
  }, [hydrateForUser, userId]);

  // Set selected world
  useEffect(() => {
    if (worldId && snapshot.panel.selectedWorldId !== worldId) {
      patchPanel({ selectedWorldId: worldId });
    }
  }, [worldId, snapshot.panel.selectedWorldId, patchPanel]);

  // Persist on snapshot change
  useEffect(() => {
    if (userId) persistForUser(userId);
  }, [persistForUser, snapshot, userId]);

  // Queries
  const { maintenanceQuery, eventsQuery, lorebooksQuery, mutationsQuery } = useWorldResourceQueries({
    enabled: Boolean(worldId),
    worldId,
  });

  // Mutations
  const mutations = useWorldMutations();

  // Local UI state
  const [eventSyncMode, setEventSyncMode] = useState<'merge' | 'replace'>('merge');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate snapshot from server data
  useEffect(() => {
    const maint = maintenanceQuery.data;
    if (!maint || typeof maint !== 'object') return;
    const record = maint as Record<string, unknown>;
    if (record.worldPatch && typeof record.worldPatch === 'object') {
      patchSnapshot({
        worldPatch: record.worldPatch as Record<string, unknown>,
        editorSnapshotVersion: String(record.editorSnapshotVersion || ''),
      });
    }
    if (record.worldviewPatch && typeof record.worldviewPatch === 'object') {
      patchSnapshot({
        worldviewPatch: record.worldviewPatch as Record<string, unknown>,
      });
    }
  }, [maintenanceQuery.data, patchSnapshot]);

  // Hydrate events from server
  useEffect(() => {
    const events = eventsQuery.data;
    if (!events) return;
    const primary = events.filter((e) => e.level === 'PRIMARY') as unknown as EventNodeDraft[];
    const secondary = events.filter((e) => e.level === 'SECONDARY') as unknown as EventNodeDraft[];
    patchSnapshot({ eventsDraft: { primary, secondary } });
  }, [eventsQuery.data, patchSnapshot]);

  // Hydrate lorebooks from server
  useEffect(() => {
    const lorebooks = lorebooksQuery.data;
    if (!lorebooks || !Array.isArray(lorebooks)) return;
    patchSnapshot({ lorebooksDraft: lorebooks as unknown as WorldLorebookDraftRow[] });
  }, [lorebooksQuery.data, patchSnapshot]);

  // Tab management
  const activeTab = snapshot.panel.activeMaintainTab;
  const onTabChange = useCallback((tab: MaintainTab) => {
    patchPanel({ activeMaintainTab: tab });
  }, [patchPanel]);

  // Data callbacks
  const onWorldPatchChange = useCallback((value: Record<string, unknown>) =>
    patchSnapshot({ worldPatch: value }), [patchSnapshot]);

  const onWorldviewPatchChange = useCallback((value: Record<string, unknown>) =>
    patchSnapshot({ worldviewPatch: value }), [patchSnapshot]);

  const onEventsChange = useCallback((next: { primary: EventNodeDraft[]; secondary: EventNodeDraft[] }) =>
    patchSnapshot({ eventsDraft: next }), [patchSnapshot]);

  const onEventGraphLayoutChange = useCallback((next: { selectedEventId: string; expandedPrimaryIds: string[] }) =>
    patchSnapshot({ eventGraphLayout: next }), [patchSnapshot]);

  const onLorebooksChange = useCallback((value: WorldLorebookDraftRow[]) =>
    patchSnapshot({ lorebooksDraft: value }), [patchSnapshot]);

  // Sync operations
  const onSyncEvents = useCallback(async () => {
    if (!worldId) return;
    try {
      const upserts = [
        ...snapshot.eventsDraft.primary,
        ...snapshot.eventsDraft.secondary,
      ].map((event) => event as unknown as Record<string, unknown>);

      await mutations.syncEventsMutation.mutateAsync({
        worldId,
        eventUpserts: upserts,
        reason: 'Forge manual sync',
        mode: eventSyncMode,
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'events', worldId] });
      setNotice('Events synced successfully');
    } catch (err) {
      setError(`Failed to sync events: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [worldId, snapshot.eventsDraft, mutations.syncEventsMutation, queryClient, eventSyncMode]);

  const onDeleteFirstEvent = useCallback(async () => {
    if (!worldId) return;
    const first = snapshot.eventsDraft.primary[0] || snapshot.eventsDraft.secondary[0];
    if (!first) return;
    const eventId = (first as unknown as Record<string, unknown>).id;
    if (!eventId || typeof eventId !== 'string') return;
    try {
      await mutations.deleteEventMutation.mutateAsync({ worldId, eventId });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'events', worldId] });
    } catch (err) {
      setError(`Failed to delete event: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [worldId, snapshot.eventsDraft, mutations.deleteEventMutation, queryClient]);

  const onSyncLorebooks = useCallback(async () => {
    if (!worldId) return;
    try {
      const upserts = snapshot.lorebooksDraft.map((lb) => lb as unknown as Record<string, unknown>);
      await mutations.syncLorebooksMutation.mutateAsync({
        worldId,
        lorebookUpserts: upserts,
        reason: 'Forge manual sync',
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', worldId] });
      setNotice('Lorebooks synced successfully');
    } catch (err) {
      setError(`Failed to sync lorebooks: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [worldId, snapshot.lorebooksDraft, mutations.syncLorebooksMutation, queryClient]);

  const onDeleteFirstLorebook = useCallback(async () => {
    if (!worldId) return;
    const first = snapshot.lorebooksDraft[0];
    if (!first) return;
    const lorebookId = (first as unknown as Record<string, unknown>).id;
    if (!lorebookId || typeof lorebookId !== 'string') return;
    try {
      await mutations.deleteLorebookMutation.mutateAsync({ worldId, lorebookId });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'lorebooks', worldId] });
    } catch (err) {
      setError(`Failed to delete lorebook: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [worldId, snapshot.lorebooksDraft, mutations.deleteLorebookMutation, queryClient]);

  // Derived
  const working = mutations.saveMaintenanceMutation.isPending
    || mutations.syncEventsMutation.isPending
    || mutations.syncLorebooksMutation.isPending;

  const mutationsList: WorldMutationSummary[] = mutationsQuery.data || [];

  const loading = maintenanceQuery.isLoading || eventsQuery.isLoading || lorebooksQuery.isLoading;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/worlds')}
            className="text-sm text-neutral-400 hover:text-white transition-colors"
          >
            &larr; {t('worlds.backToList', 'Back')}
          </button>
          <h1 className="text-lg font-semibold text-white">
            {t('pages.worldMaintain', 'Maintain World')}
          </h1>
          <span className="text-xs text-neutral-500">{worldId.slice(0, 8)}</span>
        </div>
        <button
          onClick={async () => {
            if (!worldId) return;
            try {
              await mutations.saveMaintenanceMutation.mutateAsync({
                worldId,
                worldPatch: snapshot.worldPatch,
                worldviewPatch: snapshot.worldviewPatch,
                reason: 'Forge manual save',
                ifSnapshotVersion: snapshot.editorSnapshotVersion || undefined,
              });
              await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'maintenance', worldId] });
              setNotice('Saved successfully');
            } catch (err) {
              setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }}
          disabled={working}
          className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
        >
          {t('maintain.save', 'Save')}
        </button>
      </div>

      {/* Notice/Error banners */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400">&times;</button>
        </div>
      )}
      {notice && !error && (
        <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-2 text-sm text-green-400 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-green-400/60 hover:text-green-400">&times;</button>
        </div>
      )}

      {/* Workbench */}
      <div className="min-h-0 flex-1">
        <MaintainWorkbench
          activeTab={activeTab}
          onTabChange={onTabChange}
          worldPatch={snapshot.worldPatch}
          worldviewPatch={snapshot.worldviewPatch}
          events={snapshot.eventsDraft}
          eventsSyncMode={eventSyncMode}
          editorSnapshotVersion={snapshot.editorSnapshotVersion}
          eventGraphLayout={snapshot.eventGraphLayout}
          lorebooksDraft={snapshot.lorebooksDraft}
          mutations={mutationsList}
          working={working}
          onWorldPatchChange={onWorldPatchChange}
          onWorldviewPatchChange={onWorldviewPatchChange}
          onEventsChange={onEventsChange}
          onEventGraphLayoutChange={onEventGraphLayoutChange}
          onEventsSyncModeChange={setEventSyncMode}
          onLorebooksChange={onLorebooksChange}
          onSyncEvents={onSyncEvents}
          onDeleteFirstEvent={onDeleteFirstEvent}
          onSyncLorebooks={onSyncLorebooks}
          onDeleteFirstLorebook={onDeleteFirstLorebook}
        />
      </div>
    </div>
  );
}
