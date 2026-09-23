import {
  createNimiAppActivityView,
  type NimiAppActivityOpenResult,
  type NimiAppActivityRecord,
  type NimiAppActivityView,
  type NimiAppActivityViewSnapshot,
  type NimiLocalAppActivityClient,
} from '@nimiplatform/sdk/app';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { activitySourceLabel } from './home-app-activity-model.js';

export type HomeMessageNotice = Readonly<{ tone: 'info' | 'warning'; text: string }>;

export type HomeActivityViewKey = 'pending' | 'recent';

type Translate = ReturnType<typeof useTranslation>['t'];

const INITIAL_SNAPSHOT: NimiAppActivityViewSnapshot = Object.freeze({
  status: 'loading',
  records: Object.freeze([]),
  complete: false,
  hasMore: false,
  error: null,
});

export type HomeAppActivity = Readonly<{
  pending: NimiAppActivityViewSnapshot;
  recent: NimiAppActivityViewSnapshot;
  /** Per activityId: an open or mark-read call in flight. */
  busy: Readonly<Record<string, 'open' | 'read'>>;
  /** Per activityId: the actual result of the last open or mark-read. */
  notices: Readonly<Record<string, HomeMessageNotice>>;
  open: (record: NimiAppActivityRecord) => void;
  markRead: (record: NimiAppActivityRecord) => void;
  retry: () => void;
  /** Continues a listing that paused at its record bound. */
  loadMore: (view: HomeActivityViewKey) => void;
}>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r035
/**
 * Home consumes App activity through Desktop's formal App client with the same
 * list, subscribe, mark-read, and open operations every covered App uses.
 * Reading is recorded only by the explicit mark-read action for the displayed
 * revision; list, change delivery, hiding and opening never mark anything read.
 */
export function useHomeAppActivity(): HomeAppActivity {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  // Resolved per call so a session that is not ready yet surfaces as a
  // retried view failure instead of breaking Home.
  const activity = useMemo<Pick<NimiLocalAppActivityClient, 'list' | 'subscribe'>>(() => ({
    list: (input) => sdk.appProduct().activity.list(input),
    subscribe: (input) => sdk.appProduct().activity.subscribe(input),
  }), [sdk]);
  const [pending, setPending] = useState<NimiAppActivityViewSnapshot>(INITIAL_SNAPSHOT);
  const [recent, setRecent] = useState<NimiAppActivityViewSnapshot>(INITIAL_SNAPSHOT);
  const [busy, setBusy] = useState<Readonly<Record<string, 'open' | 'read'>>>({});
  const [notices, setNotices] = useState<Readonly<Record<string, HomeMessageNotice>>>({});
  const views = useRef<Partial<Record<HomeActivityViewKey, NimiAppActivityView>>>({});

  useEffect(() => {
    const pendingView = createNimiAppActivityView({
      activity,
      filter: { kind: 'todo', todoStates: ['open'] },
      onUpdate: setPending,
    });
    const recentView = createNimiAppActivityView({ activity, maxRecords: 300, onUpdate: setRecent });
    views.current = { pending: pendingView, recent: recentView };
    pendingView.start();
    recentView.start();
    return () => {
      views.current = {};
      void pendingView.stop();
      void recentView.stop();
    };
  }, [activity]);

  const setBusyFor = (activityId: string, value: 'open' | 'read' | null) => {
    setBusy((current) => {
      const next = { ...current };
      if (value) next[activityId] = value;
      else delete next[activityId];
      return next;
    });
  };
  const setNotice = (activityId: string, notice: HomeMessageNotice | null) => {
    setNotices((current) => {
      const next = { ...current };
      if (notice) next[activityId] = notice;
      else delete next[activityId];
      return next;
    });
  };

  const open = async (record: NimiAppActivityRecord) => {
    setBusyFor(record.activityId, 'open');
    setNotice(record.activityId, null);
    try {
      const result = await sdk.appProduct().activity.open({ activityId: record.activityId });
      setNotice(record.activityId, openNotice(t, record, result));
    } catch {
      setNotice(record.activityId, { tone: 'warning', text: t('runtimeConfig.overview.appActivity.result.error') });
    } finally {
      setBusyFor(record.activityId, null);
    }
  };

  const markRead = async (record: NimiAppActivityRecord) => {
    setBusyFor(record.activityId, 'read');
    setNotice(record.activityId, null);
    try {
      await sdk.appProduct().activity.markRead({ activityId: record.activityId, displayedRevision: record.revision });
    } catch {
      setNotice(record.activityId, { tone: 'warning', text: t('runtimeConfig.overview.appActivity.readFailed') });
    } finally {
      setBusyFor(record.activityId, null);
    }
  };

  return {
    pending,
    recent,
    busy,
    notices,
    open: (record) => void open(record),
    markRead: (record) => void markRead(record),
    retry: () => {
      views.current.pending?.relist();
      views.current.recent?.relist();
    },
    loadMore: (key) => views.current[key]?.loadMore(),
  };
}

function openNotice(t: Translate, record: NimiAppActivityRecord, result: NimiAppActivityOpenResult): HomeMessageNotice {
  const source = activitySourceLabel(record) ?? t('runtimeConfig.overview.appActivity.unknownSource');
  return {
    tone: result.outcome === 'opened' ? 'info' : 'warning',
    text: t(`runtimeConfig.overview.appActivity.result.${result.reason}`, { source }),
  };
}
