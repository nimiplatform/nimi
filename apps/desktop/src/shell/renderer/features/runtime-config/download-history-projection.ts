import type { NimiRuntimeLocalEnvironmentDependencyJob, NimiRuntimeLocalTransferSessionSummary } from '@nimiplatform/sdk/runtime';
import type { AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';
import { packageJobKey } from '../apps/apps-downloads-observer.js';
import { appJobLane, environmentLane, groupTransferAttempts, setupTaskLane, transferLane, type DownloadsLane } from './global-downloads-presentation.js';
import { runtimeSetupTaskUnconfirmed, type RuntimeSetupTask } from './runtime-setup-task-store.js';
import { downloadHistoryRecord, isDownloadHistoryRemoved, type DownloadHistoryEntries } from './download-history-store.js';

export const setupHistoryRecord = (task: RuntimeSetupTask) => downloadHistoryRecord('setup', task.taskId, task.status, task.updatedAt);
export const transferHistoryRecord = (item: NimiRuntimeLocalTransferSessionSummary) => downloadHistoryRecord('model', item.installSessionId, item.state, item.updatedAt);
export const environmentHistoryRecord = (item: NimiRuntimeLocalEnvironmentDependencyJob) => downloadHistoryRecord('environment', item.jobId, item.state, item.updatedAt);
export const appHistoryRecord = (job: AppPackageJob) => downloadHistoryRecord('app', packageJobKey(job), job.phase, `${job.updatedAt?.seconds ?? ''}:${job.updatedAt?.nanos ?? ''}`);

// @nimi-authority: rule.nimi.desktop.product-surfaces.global-downloads
export function projectDownloadLane(input: {
  readonly lane: DownloadsLane;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly transfers: readonly NimiRuntimeLocalTransferSessionSummary[];
  readonly environments: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
  readonly appJobs: readonly AppPackageJob[];
  readonly removed: DownloadHistoryEntries;
}) {
  const { lane, removed } = input;
  const visible = (record: ReturnType<typeof downloadHistoryRecord>) => lane !== 'history' || !isDownloadHistoryRemoved(removed, record);
  const transfers = input.transfers.filter(item => transferLane(item.state) === lane && visible(transferHistoryRecord(item)));
  const environments = input.environments.filter(item => environmentLane(item) === lane && visible(environmentHistoryRecord(item)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const appJobs = input.appJobs.filter(item => appJobLane(item.phase) === lane && visible(appHistoryRecord(item)));
  const grouped = new Map<string, RuntimeSetupTask[]>();
  for (const task of input.tasks) {
    if (setupTaskLane(task) !== lane || runtimeSetupTaskUnconfirmed(task) || !visible(setupHistoryRecord(task))) continue;
    const key = task.draft?.profileUseId ?? task.taskId;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  const usedTransfers = new Set<string>();
  const usedEnvironments = new Set<string>();
  const setupGroups = [...grouped.entries()].map(([id, tasks]) => {
    const taskTransfers = transfers.filter(item => !usedTransfers.has(item.installSessionId) && tasks.some(task =>
      task.refs.transferIds.includes(item.installSessionId) || (!!item.planId && task.refs.installPlanIds.includes(item.planId))));
    const taskEnvironments = environments.filter(item => !usedEnvironments.has(item.jobId) && tasks.some(task => task.refs.dependencyJobIds.includes(item.jobId)));
    taskTransfers.forEach(item => usedTransfers.add(item.installSessionId));
    taskEnvironments.forEach(item => usedEnvironments.add(item.jobId));
    const updatedAt = [...tasks, ...taskTransfers, ...taskEnvironments].map(item => item.updatedAt).sort().at(-1) ?? '';
    return { id, tasks, taskTransfers, taskEnvironments, updatedAt,
      records: [...tasks.map(setupHistoryRecord), ...taskTransfers.map(transferHistoryRecord), ...taskEnvironments.map(environmentHistoryRecord)] };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const transferGroups = groupTransferAttempts(transfers.filter(item => !usedTransfers.has(item.installSessionId)));
  const standaloneEnvironments = environments.filter(item => !usedEnvironments.has(item.jobId));
  // Preserve the existing App history grouping, but remove every job represented by the row.
  const appGroups = lane === 'active' ? appJobs.map(job => ({ job, jobs: [job], attempts: 1 }))
    : [...new Set(appJobs.map(job => job.appId))].map(appId => {
      const jobs = appJobs.filter(job => job.appId === appId).sort((a, b) => Number(b.updatedAt?.seconds ?? 0) - Number(a.updatedAt?.seconds ?? 0));
      return { job: jobs[0]!, jobs, attempts: jobs.length };
    }).sort((a, b) => Number(b.job.updatedAt?.seconds ?? 0) - Number(a.job.updatedAt?.seconds ?? 0));
  return {
    setupGroups, transferGroups, environments: standaloneEnvironments, appGroups,
    count: setupGroups.length + transferGroups.length + standaloneEnvironments.length + appGroups.length,
    records: [...setupGroups.flatMap(group => group.tasks.map(setupHistoryRecord)), ...transfers.map(transferHistoryRecord), ...environments.map(environmentHistoryRecord), ...appJobs.map(appHistoryRecord)],
  };
}
