import type { NimiDesktopMachineProductRuntimeClient } from '@nimiplatform/sdk/runtime';
import { AppPackageJobPhase, ReasonCode, type AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
type AppRuntime = NimiDesktopMachineProductRuntimeClient['apps'];
export type AppDownloadCommand = 'pause' | 'resume' | 'cancel' | 'reorder';
export type AppsJobsSnapshot = {
  readonly jobs: readonly AppPackageJob[];
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly pendingIds: readonly string[];
  readonly error: string | null;
};

export function packageJobKey(job: Pick<AppPackageJob, 'jobId'>): string {
  return Array.from(job.jobId, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function packageJobIsTerminal(job: Pick<AppPackageJob, 'phase'>): boolean {
  return [AppPackageJobPhase.COMPLETED, AppPackageJobPhase.FAILED, AppPackageJobPhase.CANCELED].includes(job.phase);
}

export function timestampMilliseconds(value: { seconds: string; nanos: number } | undefined): number {
  return value ? Number(value.seconds) * 1_000 + value.nanos / 1_000_000 : 0;
}

function acceptJob(current: AppPackageJob | undefined, next: AppPackageJob): AppPackageJob {
  if (!current) return next;
  // Terminal App jobs are immutable. A retry has its own Runtime job ID.
  if (packageJobIsTerminal(current) && !packageJobIsTerminal(next)) return current;
  return timestampMilliseconds(next.updatedAt) < timestampMilliseconds(current.updatedAt) ? current : next;
}

export function mergePackageJobs(current: readonly AppPackageJob[], incoming: readonly AppPackageJob[]): readonly AppPackageJob[] {
  const previous = new Map(current.map((job) => [packageJobKey(job), job]));
  // A complete owner List replaces membership, including after a data-root change.
  return incoming.map((job) => acceptJob(previous.get(packageJobKey(job)), job));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One Home observer over the existing App job List and exact control surface. */
export function createAppsJobsObserver(client: AppRuntime, commit: (snapshot: AppsJobsSnapshot) => void, readOwnerActivation: () => Promise<string>) {
  let snapshot: AppsJobsSnapshot = { jobs: [], status: 'loading', pendingIds: [], error: null };
  let disposed = false;
  let readGeneration = 0;
  let reading: Promise<void> | null = null;
  let controlling = false;
  let ownerActivation: string | null = null;
  const publish = (next: AppsJobsSnapshot) => {
    if (disposed) return;
    snapshot = next;
    commit(next);
  };
  const refresh = (): Promise<void> => {
    if (disposed || controlling) return Promise.resolve();
    if (reading) return reading;
    const generation = ++readGeneration;
    const task = (async () => {
      const owner = await readOwnerActivation();
      if (disposed || generation !== readGeneration) return;
      if (owner !== ownerActivation) {
        ownerActivation = owner;
        publish({ ...snapshot, jobs: [], status: 'loading', error: null });
      }
      const response = await client.listAppPackageJobs({});
      const after = await readOwnerActivation();
      if (disposed || generation !== readGeneration) return;
      if (after !== owner) {
        ownerActivation = after;
        publish({ ...snapshot, jobs: [], status: 'unavailable', error: 'App data root changed; refresh download tasks' });
        return;
      }
      if (response.reasonCode !== ReasonCode.ACTION_EXECUTED) throw new Error(String(response.reasonCode));
      publish({ ...snapshot, jobs: mergePackageJobs(snapshot.jobs, response.jobs), status: 'ready', error: null });
    })().catch((error: unknown) => {
      if (!disposed && generation === readGeneration) publish({ ...snapshot, status: 'unavailable', error: errorText(error) });
    }).finally(() => { if (reading === task) reading = null; });
    reading = task;
    return task;
  };
  return {
    getSnapshot: () => snapshot,
    start() { disposed = false; reading = null; return refresh(); },
    refresh,
    async control(command: AppDownloadCommand, jobs: readonly AppPackageJob[], beforeJobId: Uint8Array = new Uint8Array()): Promise<readonly { jobId: string; error: string | null }[]> {
      if (disposed || controlling || snapshot.status !== 'ready' || ownerActivation === null) return [];
      const commandOwner = ownerActivation;
      // Freeze membership at the click; later arrivals never join a batch.
      const selected = jobs.map((job) => ({ ...job, jobId: job.jobId.slice() }));
      controlling = true;
      ++readGeneration;
      publish({ ...snapshot, pendingIds: selected.map(packageJobKey) });
      const results: { jobId: string; error: string | null }[] = [];
      for (const [index, job] of selected.entries()) {
        if (disposed) break;
        const jobId = packageJobKey(job);
        let ownerConfirmed = false;
        try {
          const before = await readOwnerActivation();
          if (disposed) break;
          if (before !== commandOwner) {
            ownerActivation = before;
            publish({ ...snapshot, jobs: [], status: 'unavailable', error: 'App data root changed; refresh download tasks' });
            throw new Error('App data root changed; refresh download tasks');
          }
          ownerConfirmed = true;
          const response = command === 'pause' ? await client.pauseAppPackageJob({ jobId: job.jobId })
            : command === 'resume' ? await client.resumeAppPackageJob({ jobId: job.jobId })
              : command === 'reorder' ? await client.reorderAppPackageJob({ jobId: job.jobId, beforeJobId })
                : await client.cancelAppPackageJob({ jobId: job.jobId, expectedPhase: job.phase, reasonCode: 'user-canceled' });
          if (disposed) break;
          ownerConfirmed = false;
          const after = await readOwnerActivation();
          if (disposed) break;
          if (after !== commandOwner) {
            ownerActivation = after;
            publish({ ...snapshot, jobs: [], status: 'unavailable', error: 'App data root changed; refresh download tasks' });
            throw new Error('App data root changed; refresh download tasks');
          }
          ownerConfirmed = true;
          if (response.reasonCode !== ReasonCode.ACTION_EXECUTED || !response.job || packageJobKey(response.job) !== jobId) {
            throw new Error(String(response.reasonCode));
          }
          const accepted = response.job;
          if (command === 'cancel' && accepted.phase !== AppPackageJobPhase.CANCELED) throw new Error('App cancellation is not confirmed');
          publish({ ...snapshot, jobs: snapshot.jobs.map((current) => packageJobKey(current) === jobId ? acceptJob(current, accepted) : current) });
          results.push({ jobId, error: null });
        } catch (error) {
          results.push({ jobId, error: errorText(error) });
          if (!ownerConfirmed) {
            publish({ ...snapshot, status: 'unavailable', error: errorText(error) });
            results.push(...selected.slice(index + 1).map((remaining) => ({ jobId: packageJobKey(remaining), error: errorText(error) })));
            break;
          }
        }
      }
      // A response can be lost after the owner accepted an action. Always read
      // again; never remove a row or restart a download on an uncertain result.
      await reading;
      controlling = false;
      publish({ ...snapshot, pendingIds: [] });
      await refresh();
      return results;
    },
    dispose() { disposed = true; ++readGeneration; },
  };
}
