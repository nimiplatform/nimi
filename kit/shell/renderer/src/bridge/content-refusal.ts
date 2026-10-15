// @nimi-authority: rule.nimi.runtime.ai-provider.content-refusal-presentation
// Ephemeral renderer presentation only: one current notice, no policy, retry,
// receipt, timer, transcript, or authority. Producers retain their own errors.
export type NimiContentRefusalNotice = Readonly<{
  correlation: string;
  reasonCode: 'AI_CONTENT_FILTER_BLOCKED';
  ruleId?: 'pem-private-key' | 'github-classic-pat';
  stage?: 'input' | 'output';
}>;
let current: NimiContentRefusalNotice | null = null;
// The existing bounded correlation window also bridges a newly submitted Job
// to its first observer. true means already shown; a number is its call start.
const recentCorrelations = new Map<string, true | number>();
function rememberCorrelation(key: string, value: true | number): void {
  recentCorrelations.set(key, value);
  if (recentCorrelations.size > 64) recentCorrelations.delete(recentCorrelations.keys().next().value!);
}
let callSequence = 0;
let presentationEpoch = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) { try { listener(); } catch { /* A UI subscriber cannot replace the original failure or stream. */ } } };
export function getNimiContentRefusalPresentationEpoch(): number { return presentationEpoch; }
export function retireNimiContentRefusalPresentation(): void { presentationEpoch++; current = null; recentCorrelations.clear(); emit(); }
export function nextNimiContentRefusalCorrelation(): string { return `call-${++callSequence}`; }
export function getNimiContentRefusalNotice(): NimiContentRefusalNotice | null { return current; }
export function subscribeNimiContentRefusalNotice(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function dismissNimiContentRefusalNotice(correlation: string): void {
  if (current?.correlation !== correlation) return;
  current = null; emit();
}
export function reportNimiContentRefusal(input: {
  readonly correlation: string;
  readonly reasonCode: unknown;
  readonly metadata?: unknown;
  readonly presentationEpoch: number;
}): void {
  if (input.presentationEpoch !== presentationEpoch) return;
  if (input.reasonCode !== 'AI_CONTENT_FILTER_BLOCKED' && input.reasonCode !== 'ai-content-filter-blocked') return;
  if (!input.correlation || input.correlation.length > 512 || recentCorrelations.get(input.correlation) === true) return;
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata as Record<string, unknown> : {};
  const rule = metadata.rule_id;
  const stage = metadata.failure_stage;
  current = Object.freeze({ correlation: input.correlation, reasonCode: 'AI_CONTENT_FILTER_BLOCKED',
    ...(rule === 'pem-private-key' || rule === 'github-classic-pat' ? { ruleId: rule } : {}),
    ...(stage === 'input' || stage === 'output' ? { stage } : {}),
  });
  rememberCorrelation(input.correlation, true);
  // Bounded duplicate suppression for overlapping live subscriptions; this
  // holds only identifiers/call times, never queued notices, bodies, or receipts.
  emit();
}

function jobTimestamp(value: unknown): bigint | null {
  if (!value || typeof value !== 'object') return null;
  const stamp = value as { seconds: string; nanos: number };
  return BigInt(stamp.seconds) * 1_000_000_000n + BigInt(stamp.nanos);
}

export function rememberNimiScenarioJobSubmission(job: { jobId: string; createdAt: unknown; reasonCode: string; status: string }, epoch: number, startedAtMs: number): void {
  const createdAt = jobTimestamp(job.createdAt);
  // An idempotent submit can return an old Job. It is not a new operation.
  if (epoch !== presentationEpoch || createdAt === null || createdAt < BigInt(startedAtMs) * 1_000_000n) return;
  const key = `job:${job.jobId}`;
  if (recentCorrelations.get(key) !== true) rememberCorrelation(key, startedAtMs);
  observeNimiSubmittedJob(job, epoch);
}

export function observeNimiSubmittedJob(job: { jobId: string; reasonCode: string; status: string }, epoch: number): void {
  const key = `job:${job.jobId}`;
  if (epoch !== presentationEpoch || typeof recentCorrelations.get(key) !== 'number') return;
  if (job.status === 'failed') reportNimiContentRefusal({ correlation: key, reasonCode: job.reasonCode, presentationEpoch: epoch });
  if (['completed', 'failed', 'canceled', 'timeout'].includes(job.status)) rememberCorrelation(key, true);
}

// Only the validated live stream calls this observer; snapshot hydration does
// not. A new subscription can join an active turn after its started event.
export function createNimiContentRefusalObserver(correlation: string, conversation = false, epoch = presentationEpoch): (value: unknown) => void {
  let terminal = false;
  return (value) => {
    if (epoch !== presentationEpoch) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const event = value as Record<string, unknown>;
    if (conversation) {
      if (event.type === 'turn-failed' && typeof event.turnId === 'string' && event.turnId) {
        const turnCorrelation = typeof event.conversationAnchorId === 'string'
          ? `conversation:${event.conversationAnchorId}:${event.turnId}` : `${correlation}:${event.turnId}`;
        // This carrier has no confirmed source classification. An anchor is
        // identity, not evidence that changing historical context will help.
        reportNimiContentRefusal({ correlation: turnCorrelation, reasonCode: event.reasonCode, presentationEpoch: epoch });
      } else if (event.type === 'action-failed' && typeof event.turnId === 'string' && event.turnId
        && event.action && typeof event.action === 'object') {
        const action = event.action as Record<string, unknown>;
        if (action.turnId === event.turnId && typeof action.actionId === 'string' && action.actionId
          && action.capabilityContract === 'image.generate' && action.status === 'failed') {
          // Image refusal can follow committed text and a successful parent
          // turn. Model action IDs are only unique within their own turn.
          reportNimiContentRefusal({
            correlation: `conversation-action:${JSON.stringify([event.conversationAnchorId ?? correlation, event.turnId, action.actionId])}`,
            reasonCode: action.reasonCode, presentationEpoch: epoch,
          });
        }
      }
      return;
    }
    if (terminal) return;
    if (event.type === 'failed') {
      terminal = true;
      reportNimiContentRefusal({ correlation, reasonCode: event.reasonCode, presentationEpoch: epoch });
    } else if (event.type === 'completed') terminal = true;
  };
}

// Job subscriptions replay stored events. The protected Runtime and renderer
// share this host's clock. A recent new submission can fail before its watch
// opens; other watches ignore older replay. Delivery of the backlog is unchanged.
export function createNimiScenarioJobRefusalObserver(jobId: string, epoch: number, openedAtMs: number): (value: unknown) => void {
  const submittedAt = recentCorrelations.get(`job:${jobId}`);
  const openedAt = BigInt(typeof submittedAt === 'number' ? submittedAt : openedAtMs) * 1_000_000n;
  return value => {
    if (!value || typeof value !== 'object') return;
    const event = value as Record<string, unknown>;
    if (event.eventType !== 'failed' || !event.job || typeof event.job !== 'object'
      || !event.timestamp || typeof event.timestamp !== 'object') return;
    const job = event.job as Record<string, unknown>;
    const timestamp = jobTimestamp(event.timestamp);
    if (job.jobId !== jobId || job.status !== 'failed'
      || timestamp === null || timestamp < openedAt) return;
    reportNimiContentRefusal({ correlation: `job:${jobId}`, reasonCode: job.reasonCode, presentationEpoch: epoch });
  };
}
