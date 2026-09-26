import { startDownloadPolling } from './download-polling.js';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalTransferSessionSummary,
} from '@nimiplatform/sdk/runtime';
import { isNimiRuntimeLocalEnvironmentDependencyJobActiveState } from '@nimiplatform/sdk/runtime';
import { replaceEqualDeep, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useAppsDownloads } from '../apps/apps-downloads-context.js';
import { packageJobIsTerminal } from '../apps/apps-downloads-observer.js';
import { CAPABILITY_INVENTORY_KEY } from './runtime-capability-inventory.js';
import { createRuntimeConfigLocalEnvironmentClient, RuntimeDownloadActivityContext } from './runtime-config-local-environment-sdk-service.js';
import { isDownloadTerminal } from './runtime-config-model-center-utils.js';
import { RUNTIME_MODEL_LIBRARY_KEY } from './use-runtime-model-library.js';

type GlobalDownloadsContextValue = {
  readonly loading: boolean;
  readonly transfers: readonly NimiRuntimeLocalTransferSessionSummary[];
  readonly environments: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
  readonly errors: readonly string[];
  readonly activeCount: number;
  readonly refresh: () => Promise<void>;
  readonly selectedTransfer: { readonly id: string; readonly revision: number } | null;
  readonly selectTransfer: (id: string) => void;
};
const GlobalDownloadsContext = createContext<GlobalDownloadsContextValue | null>(null);

// @nimi-authority: rule.nimi.desktop.product-surfaces.global-downloads
export function GlobalDownloadsProvider({ children }: PropsWithChildren) {
  const bindings = useDesktopRendererBindings();
  const apps = useAppsDownloads();
  const queryClient = useQueryClient();
  const phaseSignature = useRef('');
  const local = useMemo(
    () => createRuntimeConfigLocalEnvironmentClient(() => bindings.sdk.localEnvironmentRpc()),
    [bindings],
  );
  const [transfers, setTransfers] = useState<readonly NimiRuntimeLocalTransferSessionSummary[]>([]);
  const [environments, setEnvironments] = useState<readonly NimiRuntimeLocalEnvironmentDependencyJob[]>([]);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTransfer, setSelectedTransfer] = useState<GlobalDownloadsContextValue['selectedTransfer']>(null);
  const polling = useRef<ReturnType<typeof startDownloadPolling> | null>(null);
  const pendingDownloads = useRef(0);
  const onDownloadStart = useCallback(() => {
    pendingDownloads.current += 1;
    polling.current?.wake();
    return () => {
      pendingDownloads.current -= 1;
      polling.current?.wake();
    };
  }, []);
  const selectTransfer = useCallback((id: string) => {
    setSelectedTransfer((previous) => ({ id, revision: (previous?.revision ?? 0) + 1 }));
    setLoading(true);
    polling.current?.wake();
  }, []);
  const activation = useRef('');
  const appPhases = apps?.jobs.map((job) => `${job.jobId}:${job.phase}`).join('|') ?? '';
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['desktop', 'apps-overview'] });
  }, [appPhases, queryClient]);
  useEffect(() => {
    let active = true,
      reading = false,
      hasActiveJobs = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const before = (await bindings.app.commands.firstRun.getRecord()).record?.dataRoot?.rootActivationId;
        if (!before) throw Error('Download state is unavailable until the data root is ready');
        if (activation.current !== before) {
          activation.current = before;
          if (active) {
            setTransfers([]);
            setEnvironments([]);
          }
        }
        const results = await Promise.allSettled([
          local.listTransfers(),
          local.listEnvironmentDependencyJobs(),
        ]);
        hasActiveJobs = (results[0].status === 'fulfilled' && results[0].value.some((item) => !isDownloadTerminal(item.state)))
          || (results[1].status === 'fulfilled' && results[1].value.some((item) => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(item.state)));
        const after = (await bindings.app.commands.firstRun.getRecord()).record?.dataRoot?.rootActivationId;
        if (!active) return;
        if (after !== before) {
          setTransfers([]);
          setEnvironments([]);
          throw Error('Data location changed; refresh downloads');
        }
        const failures: string[] = [];
        if (results[0].status === 'fulfilled') { const items = results[0].value; setTransfers((previous) => replaceEqualDeep(previous, items)); }
        else failures.push(String(results[0].reason));
        if (results[1].status === 'fulfilled') { const items = results[1].value; setEnvironments((previous) => replaceEqualDeep(previous, items)); }
        else failures.push(String(results[1].reason));
        const signature = results
          .map((result) =>
            result.status === 'fulfilled'
              ? result.value
                  .map((item) => `${'jobId' in item ? item.jobId : item.installSessionId}:${item.state}`)
                  .join('|')
              : 'unavailable',
          )
          .join(';');
        if (phaseSignature.current && phaseSignature.current !== signature) {
          void queryClient.invalidateQueries({ queryKey: CAPABILITY_INVENTORY_KEY });
          void queryClient.invalidateQueries({ queryKey: RUNTIME_MODEL_LIBRARY_KEY });
          void queryClient.invalidateQueries({ queryKey: ['desktop', 'apps-overview'] });
        }
        phaseSignature.current = signature;
        setErrors((previous) => replaceEqualDeep(previous, failures));
      } catch (error) {
        if (active) setErrors((previous) => replaceEqualDeep(previous, [error instanceof Error ? error.message : String(error)]));
      } finally {
        reading = false;
        if (active) setLoading(false);
      }
    };
    const observer = startDownloadPolling(refresh, () => hasActiveJobs || pendingDownloads.current > 0);
    polling.current = observer;
    return () => {
      active = false;
      observer.stop();
      polling.current = null;
    };
  }, [bindings, local, queryClient]);
  const refresh = useCallback(async () => {
    polling.current?.wake();
    await apps?.observer.refresh();
  }, [apps?.observer]);
  const activeCount =
    transfers.filter((item) => !isDownloadTerminal(item.state)).length +
    environments.filter((item) => isNimiRuntimeLocalEnvironmentDependencyJobActiveState(item.state)).length +
    (apps?.jobs.filter((item) => !packageJobIsTerminal(item)).length ?? 0);
  return (
    <GlobalDownloadsContext.Provider value={{ transfers, environments, errors, activeCount, refresh, loading, selectedTransfer, selectTransfer }}>
      <RuntimeDownloadActivityContext.Provider value={onDownloadStart}>
        {children}
      </RuntimeDownloadActivityContext.Provider>
    </GlobalDownloadsContext.Provider>
  );
}

export function useGlobalDownloads() {
  return useContext(GlobalDownloadsContext);
}
