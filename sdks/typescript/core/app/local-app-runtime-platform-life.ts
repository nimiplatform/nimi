import type { LocalAppAgentLifeProjection } from '../../core-generated/runtime-typed-client.js';
import { asRecord, assertExactProjectionKeys, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation.js';
import { projectLifeRevision, projectLifeSelector, projectScheduledTime, type NimiLocalAppScheduledTime } from './local-app-runtime-platform-proactive.js';

export type NimiLocalAppAgentLifePhase = 'planned' | 'active' | 'paused' | 'completed' | 'interrupted' | 'canceled';
export type NimiLocalAppAgentLifeFrame = Readonly<{ frameId: string; activityRef: string; title: string; phase: NimiLocalAppAgentLifePhase; startsAt: NimiLocalAppScheduledTime; endsAt: NimiLocalAppScheduledTime | null; progress: number | null; interaction: boolean }>;
export type NimiLocalAppAgentLifeActivity = Readonly<{ activityRef: string; title: string; kind: 'routine' | 'project'; phase: NimiLocalAppAgentLifePhase; progress: number }>;
export type NimiLocalAppAgentLife = Readonly<{ activities: readonly NimiLocalAppAgentLifeActivity[]; revision: string; current: NimiLocalAppAgentLifeFrame | null; recent: readonly NimiLocalAppAgentLifeFrame[]; future: readonly NimiLocalAppAgentLifeFrame[]; nextCheckAt: NimiLocalAppScheduledTime | null; waitReason: string }>;
const phases: readonly NimiLocalAppAgentLifePhase[] = ['planned', 'active', 'paused', 'completed', 'interrupted', 'canceled'];
function text(value: unknown, limit: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || [...value].length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) return localAppProjectionError('life text');
  return value;
}
export function validateLifeTimezone(value: unknown): string {
  const zone = text(value, 128);
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); } catch { return localAppError('Choose a valid timezone.', 'SDK_LOCAL_APP_INPUT_INVALID', 'select_timezone'); }
  return zone;
}
function projectFrame(value: unknown): NimiLocalAppAgentLifeFrame {
  const row = asRecord(value);
  assertExactProjectionKeys(row, ['frameId', 'activityRef', 'title', 'phase', 'startsAt', 'endsAt', 'progress', 'interaction'], 'life frame');
  if (!phases.includes(row.phase as NimiLocalAppAgentLifePhase) || typeof row.interaction !== 'boolean' || (row.interaction ? row.progress !== null : typeof row.progress !== 'number' || !Number.isInteger(row.progress) || row.progress < 0 || row.progress > 100)) return localAppProjectionError('life frame state');
  const startsAt = projectScheduledTime(row.startsAt), endsAt = row.endsAt === null ? null : projectScheduledTime(row.endsAt);
  if (!endsAt && (!row.interaction || row.phase !== 'active')) return localAppProjectionError('life end');
  if (endsAt && (BigInt(endsAt.seconds) < BigInt(startsAt.seconds) || (endsAt.seconds === startsAt.seconds && endsAt.nanos <= startsAt.nanos))) return localAppProjectionError('life interval');
  return Object.freeze({ frameId: projectLifeSelector(row.frameId), activityRef: row.interaction ? text(row.activityRef, 256, true) : projectLifeSelector(row.activityRef), title: text(row.title, 160), phase: row.phase as NimiLocalAppAgentLifePhase, startsAt, endsAt, progress: row.progress as number | null, interaction: row.interaction });
}
export function projectLife(value: unknown): NimiLocalAppAgentLife {
  const row = asRecord(value);
  assertExactProjectionKeys(row, ['revision', 'current', 'recent', 'future', 'nextCheckAt', 'waitReason', 'activities'], 'life state');
  if (!Array.isArray(row.recent) || row.recent.length > 12 || !Array.isArray(row.future) || row.future.length > 6) return localAppProjectionError('life bounds');
  if (!Array.isArray(row.activities) || row.activities.length > 24) return localAppProjectionError('retained activity bounds');
  const activities = row.activities.map(value => {
    const a = asRecord(value);
    assertExactProjectionKeys(a, ['activityRef','title','kind','phase','progress'], 'retained activity');
    if (!['routine','project'].includes(String(a.kind)) || !['planned','active','paused'].includes(String(a.phase)) || typeof a.progress !== 'number' || !Number.isInteger(a.progress) || a.progress < 0 || a.progress > 100) return localAppProjectionError('retained activity state');
    return Object.freeze({ activityRef: projectLifeSelector(a.activityRef), title:text(a.title,160),kind:a.kind as 'routine'|'project',phase:a.phase as NimiLocalAppAgentLifePhase,progress:a.progress });
  });
  if (new Set(activities.map(a=>a.activityRef)).size !== activities.length) return localAppProjectionError('duplicate retained activity');
  const current = row.current === null ? null : projectFrame(row.current), recent = row.recent.map(projectFrame), future = row.future.map(projectFrame);
  if (current && current.phase !== 'active') return localAppProjectionError('current life phase');
  return Object.freeze({ activities:Object.freeze(activities), revision: projectLifeRevision(row.revision), current, recent: Object.freeze(recent), future: Object.freeze(future), nextCheckAt: row.nextCheckAt === null ? null : projectScheduledTime(row.nextCheckAt), waitReason: text(row.waitReason, 128, true) });
}
export function projectRuntimeLife(value: LocalAppAgentLifeProjection | undefined): NimiLocalAppAgentLife {
  if (!value) return localAppProjectionError('life state unavailable');
  const frame = (v: NonNullable<LocalAppAgentLifeProjection['current']>) => ({ frameId:v.frameId,activityRef:v.activityRef,title:v.title,progress:v.progress ?? null,interaction:v.interaction,startsAt:runtimeLifeTime(v.startsAt),endsAt:runtimeLifeTime(v.endsAt),phase: phases[v.phase - 1] });
  return projectLife({ activities:value.activities.map(a=>({...a,phase:phases[a.phase-1]})), revision:value.revision,waitReason:value.waitReason,current: value.current ? frame(value.current) : null, recent: value.recent.map(frame), future: value.future.map(frame), nextCheckAt: runtimeLifeTime(value.nextCheckAt) });
}
function runtimeLifeTime(value:{seconds:string;nanos:number}|undefined){return value?{seconds:value.seconds,nanos:value.nanos}:null;}
