import { createNimiAppActivityView, type NimiAppActivityOpenResult, type NimiAppActivityRecord, type NimiAppActivityView, type NimiAppActivityViewSnapshot, type NimiLocalAppActivityClient } from '@nimiplatform/sdk/app';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { activitySourceLabel, isOpenable } from '../home/home-app-activity-model.js';
import type { HomeActivityViewKey, HomeAppActivity, HomeMessageNotice } from './system-entry-context.js';

export const INITIAL_SYSTEM_ENTRY_ACTIVITY: NimiAppActivityViewSnapshot = Object.freeze({ status: 'loading', records: Object.freeze([]), complete: false, hasMore: false, error: null });
type ViewState = Readonly<{ scope: string | null; pending: NimiAppActivityViewSnapshot; recent: NimiAppActivityViewSnapshot; observedAt: string | null }>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r035
// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection
export function useSystemEntryActivityOwner(sdk: DesktopRendererSdkPort, scope: string | null): {
  activity: HomeAppActivity;
  observedAt: string | null;
  openActivity(record: NimiAppActivityRecord): Promise<NimiAppActivityOpenResult>;
} {
  const { t } = useTranslation();
  const client = useMemo<Pick<NimiLocalAppActivityClient, 'list' | 'subscribe'>>(() => ({
    list: (input) => sdk.appProduct().activity.list(input),
    subscribe: (input) => sdk.appProduct().activity.subscribe(input),
  }), [sdk]);
  const [state, setState] = useState<ViewState>({ scope: null, pending: INITIAL_SYSTEM_ENTRY_ACTIVITY, recent: INITIAL_SYSTEM_ENTRY_ACTIVITY, observedAt: null });
  const [busy, setBusy] = useState<Readonly<Record<string, 'open' | 'read'>>>({});
  const [notices, setNotices] = useState<Readonly<Record<string, HomeMessageNotice>>>({});
  const views = useRef<Partial<Record<HomeActivityViewKey, NimiAppActivityView>>>({});
  const liveScope = useRef(scope);
  liveScope.current = scope;

  useEffect(() => {
    let active = true;
    setState({ scope, pending: INITIAL_SYSTEM_ENTRY_ACTIVITY, recent: INITIAL_SYSTEM_ENTRY_ACTIVITY, observedAt: null });
    setBusy({});
    setNotices({});
    if (!scope) return () => { active = false; };
    const update = (key: HomeActivityViewKey) => (snapshot: NimiAppActivityViewSnapshot): void => {
      if (!active || liveScope.current !== scope) return;
      setState((previous) => ({ ...previous, scope, [key]: snapshot,
        observedAt: snapshot.status === 'ready' ? new Date().toISOString() : previous.observedAt }));
    };
    const pending = createNimiAppActivityView({ activity: client, filter: { kind: 'todo', todoStates: ['open'] }, onUpdate: update('pending') });
    const recent = createNimiAppActivityView({ activity: client, maxRecords: 300, onUpdate: update('recent') });
    views.current = { pending, recent };
    pending.start(); recent.start();
    return () => {
      active = false;
      views.current = {};
      void Promise.allSettled([pending.stop(), recent.stop()]);
    };
  }, [client, scope]);

  const setBusyFor = useCallback((activityId: string, value: 'open' | 'read' | null) => {
    setBusy((current) => { const next = { ...current }; if (value) next[activityId] = value; else delete next[activityId]; return next; });
  }, []);
  const notice = useCallback((activityId: string, value: HomeMessageNotice | null) => {
    setNotices((current) => { const next = { ...current }; if (value) next[activityId] = value; else delete next[activityId]; return next; });
  }, []);
  const openActivity = useCallback(async (record: NimiAppActivityRecord): Promise<NimiAppActivityOpenResult> => {
    if (!scope || scope !== liveScope.current || !isOpenable(record)) throw new Error('system-entry-activity-unavailable');
    setBusyFor(record.activityId, 'open'); notice(record.activityId, null);
    try {
      const result = await sdk.appProduct().activity.open({ activityId: record.activityId });
      if (scope !== liveScope.current) throw new Error('system-entry-view-stale');
      notice(record.activityId, { tone: result.outcome === 'opened' ? 'info' : 'warning',
        text: t(`runtimeConfig.overview.appActivity.result.${result.reason}`, { source: activitySourceLabel(record) ?? t('runtimeConfig.overview.appActivity.unknownSource') }) });
      return result;
    } catch (error) {
      if (scope === liveScope.current) notice(record.activityId, { tone: 'warning', text: t('runtimeConfig.overview.appActivity.result.error') });
      throw error;
    } finally { if (scope === liveScope.current) setBusyFor(record.activityId, null); }
  }, [scope, sdk, setBusyFor, notice, t]);
  const markRead = useCallback(async (record: NimiAppActivityRecord): Promise<void> => {
    if (!scope || scope !== liveScope.current) return;
    setBusyFor(record.activityId, 'read'); notice(record.activityId, null);
    try { await sdk.appProduct().activity.markRead({ activityId: record.activityId, displayedRevision: record.revision }); }
    catch { if (scope === liveScope.current) notice(record.activityId, { tone: 'warning', text: t('runtimeConfig.overview.appActivity.readFailed') }); }
    finally { if (scope === liveScope.current) setBusyFor(record.activityId, null); }
  }, [scope, sdk, setBusyFor, notice, t]);
  const sameScope = scope !== null && state.scope === scope;
  return {
    observedAt: sameScope ? state.observedAt : null,
    openActivity,
    activity: {
      pending: sameScope ? state.pending : INITIAL_SYSTEM_ENTRY_ACTIVITY,
      recent: sameScope ? state.recent : INITIAL_SYSTEM_ENTRY_ACTIVITY,
      busy: sameScope ? busy : {}, notices: sameScope ? notices : {},
      open: (record) => { void openActivity(record).catch(() => undefined); },
      markRead: (record) => { void markRead(record); },
      retry: () => { views.current.pending?.relist(); views.current.recent?.relist(); },
      loadMore: (key) => views.current[key]?.loadMore(),
    },
  };
}
