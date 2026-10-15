import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type NimiRuntimeLocalEnvironmentClient,
  type NimiRuntimeLocalEnvironmentPlanInput,
} from '@nimiplatform/sdk/runtime';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { cancelRuntimeEnvironmentDependencyJob, latestEnvironmentDependencyJob, projectRuntimeEnvironmentState } from './runtime-environment-state.js';

export async function observeRuntimeEnvironment(
  client: Pick<NimiRuntimeLocalEnvironmentClient, 'resolveEnvironmentPlan' | 'listEnvironmentDependencyJobs'>,
  resolution: NimiRuntimeLocalEnvironmentPlanInput,
) {
  const [plan, allJobs] = await Promise.all([
    client.resolveEnvironmentPlan(resolution),
    client.listEnvironmentDependencyJobs(),
  ]);
  const jobs = plan.dependencies.flatMap((dependency) => {
    const job = latestEnvironmentDependencyJob(allJobs, dependency);
    return job ? [job] : [];
  });
  return { plan, jobs };
}

/** A read projection of one exact configuration or shared component, never a task store. */
export function useRuntimeEnvironmentObservation(
  resolution: NimiRuntimeLocalEnvironmentPlanInput | null,
  polling = false,
  revision = '',
) {
  const client = useRuntimeConfigLocalEnvironmentClient();
  const requestKey = resolution ? JSON.stringify(resolution) : '';
  const key = requestKey ? JSON.stringify([requestKey, revision]) : '';
  const currentKey = useRef(key);
  currentKey.current = key;
  const generation = useRef(0);
  const inFlight = useRef<{ key: string; request: number } | null>(null);
  const [result, setResult] = useState<{
    key: string;
    data?: Awaited<ReturnType<typeof observeRuntimeEnvironment>>;
    checking: boolean;
    error?: string;
    reasonCode?: string;
  }>({ key: '', checking: false });
  const [mutation, setMutation] = useState<{ key: string; busy: boolean; error?: string }>({ key: '', busy: false });

  const refresh = useCallback(async (force = false) => {
    // A cancellation may finish after navigation. Its old refresh must not
    // replace or invalidate the next configuration's observation.
    if (!key || currentKey.current !== key) return;
    if (!force && inFlight.current?.key === key && inFlight.current.request === generation.current) return;
    const request = ++generation.current;
    inFlight.current = { key, request };
    setMutation(previous => previous.key === key && !previous.busy ? { key, busy: false } : previous);
    setResult(previous => ({ key, ...(previous.key === key ? { data: previous.data } : {}), checking: true }));
    try {
      const data = await observeRuntimeEnvironment(client, JSON.parse(requestKey) as NimiRuntimeLocalEnvironmentPlanInput);
      if (generation.current === request && currentKey.current === key) setResult({ key, data, checking: false });
    } catch (error) {
      if (generation.current === request && currentKey.current === key) setResult({ key, checking: false, error: error instanceof Error ? error.message : String(error), reasonCode: extractNimiErrorFields(error).reasonCode });
    } finally {
      if (inFlight.current?.request === request) inFlight.current = null;
    }
  }, [client, key, requestKey]);

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const data = result.key === key ? result.data : undefined;
  const active = data ? projectRuntimeEnvironmentState(data.plan, data.jobs).state === 'active' : false;
  useEffect(() => {
    if (!key || (!active && !polling)) return;
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [key, active, polling, refresh]);

  const cancelJob = async (jobId: string) => {
    if (!data || (mutation.key === key && mutation.busy)) return;
    setMutation({ key, busy: true });
    try {
      await cancelRuntimeEnvironmentDependencyJob(client, data.plan, data.jobs, jobId);
      await refresh(true);
      setMutation(previous => previous.key === key ? { key, busy: false } : previous);
    } catch (error) {
      setMutation(previous => previous.key === key ? { key, busy: false, error: error instanceof Error ? error.message : String(error) } : previous);
    }
  };
  return {
    data,
    checking: !!key && (result.key !== key || result.checking),
    error: result.key === key ? result.error : undefined,
    reasonCode: result.key === key ? result.reasonCode : undefined,
    busy: mutation.key === key && mutation.busy,
    actionError: mutation.key === key ? mutation.error : undefined,
    refresh,
    cancelJob,
  };
}
