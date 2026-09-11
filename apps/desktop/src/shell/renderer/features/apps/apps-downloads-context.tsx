import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createAppsJobsObserver, type AppsJobsSnapshot } from './apps-downloads-observer.js';

export type AppsDownloadsContextValue = AppsJobsSnapshot & {
  readonly observer: ReturnType<typeof createAppsJobsObserver>;
  readonly view: 'library' | 'downloads';
  readonly selectedJobId: string | null;
  readonly openDownloads: (jobId?: string) => void;
  readonly showLibrary: () => void;
  readonly selectJob: (jobId: string | null) => void;
};

const AppsDownloadsContext = createContext<AppsDownloadsContextValue | null>(null);

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-home-009a
export function AppsDownloadsProvider({ children }: PropsWithChildren) {
  const bindings = useDesktopRendererBindings();
  const [snapshot, setSnapshot] = useState<AppsJobsSnapshot>({ jobs: [], status: 'loading', pendingIds: [], error: null });
  const [view, setView] = useState<'library' | 'downloads'>('library');
  const [selectedJobId, selectJob] = useState<string | null>(null);
  const openDownloads = useCallback((jobId?: string) => { setView('downloads'); selectJob(jobId ?? null); }, []);
  const showLibrary = useCallback(() => setView('library'), []);
  const observer = useMemo(() => createAppsJobsObserver(bindings.sdk.machineProduct().apps, setSnapshot, async () => {
    const projection = await bindings.app.commands.firstRun.getRecord();
    const root = projection.record?.dataRoot;
    if (projection.error || root?.status !== 'ready' || !root.rootActivationId) throw new Error(projection.error ?? 'App data root is unavailable');
    return root.rootActivationId;
  }), [bindings]);
  useEffect(() => {
    setSnapshot(observer.getSnapshot());
    void observer.start();
    const interval = window.setInterval(() => void observer.refresh(), 2_000);
    return () => { window.clearInterval(interval); observer.dispose(); };
  }, [observer]);
  return <AppsDownloadsContext.Provider value={{
    ...snapshot, observer, view, selectedJobId, selectJob, openDownloads, showLibrary,
  }}>{children}</AppsDownloadsContext.Provider>;
}

export function useAppsDownloads(): AppsDownloadsContextValue | null {
  return useContext(AppsDownloadsContext);
}
