import { Button } from '@nimiplatform/kit/ui';
import type { NimiAppActivityRecord } from '@nimiplatform/kit/core/sdk-contract';

export type AgentActivityReferencesProps = {
  readonly records: readonly NimiAppActivityRecord[];
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly incomplete: boolean;
  readonly openingId: string | null;
  readonly openFailed: boolean;
  readonly open: (record: NimiAppActivityRecord) => void;
  readonly retry: () => void;
  readonly copy: {
    readonly title: string; readonly loading: string; readonly unavailable: string;
    readonly incomplete: string; readonly open: string; readonly opening: string;
    readonly openFailed: string; readonly retry: string; readonly more: string;
  };
};

/** A display of published App content, separate from canonical chat messages. */
// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-003
export function AgentActivityReferences(props: AgentActivityReferencesProps) {
  if (!props.loading && !props.unavailable && props.records.length === 0) return null;
  return (
    <section aria-label={props.copy.title} data-nimi-app-activity-references className="my-4 space-y-2 text-sm text-[var(--nimi-text-primary)]">
      <p className="text-xs font-medium text-[var(--nimi-text-muted)]">{props.copy.title}</p>
      {props.loading ? <p role="status" className="text-xs text-[var(--nimi-text-muted)]">{props.copy.loading}</p> : null}
      {props.unavailable ? <div role="status" className="flex items-center gap-2 text-xs"><span>{props.copy.unavailable}</span><Button size="sm" tone="ghost" onClick={props.retry}>{props.copy.retry}</Button></div> : null}
      {props.records.slice(0, 3).map(record => <Reference key={record.activityId} record={record} {...props} />)}
      {props.records.length > 3 ? <details className="space-y-2"><summary className="cursor-pointer py-2 text-xs text-[var(--nimi-text-muted)]">{props.copy.more}</summary>{props.records.slice(3).map(record => <Reference key={record.activityId} record={record} {...props} />)}</details> : null}
      {props.incomplete && !props.loading && props.records.length > 0 ? <p className="text-xs text-[var(--nimi-text-muted)]">{props.copy.incomplete}</p> : null}
      {props.openFailed ? <p role="status" className="text-xs text-[var(--nimi-status-danger)]">{props.copy.openFailed}</p> : null}
    </section>
  );
}

function Reference({ record, ...props }: AgentActivityReferencesProps & { readonly record: NimiAppActivityRecord }) {
  return <article data-activity-id={record.activityId} className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
    <div className="flex items-center justify-between gap-3 text-xs text-[var(--nimi-text-muted)]"><span>{record.source.displayName ?? record.source.appId}</span><time dateTime={record.occurredAt}>{new Date(record.occurredAt).toLocaleString()}</time></div>
    {record.agent ? <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{record.agent.displayName}</p> : null}
    <p className="mt-1 font-medium">{record.title}</p>
    {record.summary ? <p className="mt-1 whitespace-pre-wrap break-words text-[var(--nimi-text-secondary)]">{record.summary}</p> : null}
    {record.objectRef ? <Button className="mt-2" size="sm" tone="secondary" disabled={props.openingId !== null} onClick={() => props.open(record)}>{props.openingId === record.activityId ? props.copy.opening : props.copy.open}</Button> : null}
  </article>;
}
