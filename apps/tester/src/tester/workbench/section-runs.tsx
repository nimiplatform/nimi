import { useMemo, useState } from 'react';
import { Button, EmptyState, FieldShell, SelectField, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { ArrowRight, Boxes, ClipboardList, Database, Route, ShieldCheck } from 'lucide-react';
import { RunsHistoryList } from './runs-history-list.js';
import { testerCapabilities, type TesterCapabilityId } from '../tester-capabilities.js';
import {
  flattenTesterRunHistory,
  formatTesterRunTimestamp,
  getTesterRunStatusLabel,
  getTesterRunStatusTone,
  type TesterFlatRunRecord,
  type TesterRunHistory,
} from '../tester-history.js';
import type { WorkbenchSectionId } from './workbench-context.js';

type SectionRunsProps = {
  history: TesterRunHistory | null;
  onOpenSection?: (section: WorkbenchSectionId) => void;
};

type FilterValue =
  | 'all'
  | 'runtime-results'
  | 'unavailable-blockers'
  | 'local-fixtures'
  | TesterCapabilityId;

const storagePath = '$TMPDIR/nimiapp-tester/tester-run-history.json';

function filterRecord(record: TesterFlatRunRecord, filter: FilterValue): boolean {
  if (filter === 'all') return true;
  if (filter === 'runtime-results') return record.status === 'ready' || record.status === 'failed';
  if (filter === 'unavailable-blockers') return record.status === 'unavailable';
  if (filter === 'local-fixtures') return record.status === 'local-fixture';
  return record.capabilityId === filter;
}

function historyFromRecords(records: TesterFlatRunRecord[]): TesterRunHistory {
  return records.reduce<TesterRunHistory>((next, record) => {
    const { capabilityLabel: _capabilityLabel, ...historyRecord } = record;
    next[record.capabilityId] = [...(next[record.capabilityId] || []), historyRecord];
    return next;
  }, {});
}

function countByStatus(records: TesterFlatRunRecord[], status: TesterFlatRunRecord['status']): number {
  return records.filter((record) => record.status === status).length;
}

function summarizePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return 'No request summary recorded.';
  return trimmed.length > 150 ? `${trimmed.slice(0, 147)}...` : trimmed;
}

function runtimeResult(record: TesterFlatRunRecord | null): string {
  if (!record) return 'not runtime-invoked';
  if (record.status === 'local-fixture') return 'not runtime-invoked';
  if (record.status === 'ready') return 'ready';
  if (record.status === 'failed') return 'failed';
  return 'unavailable';
}

function boundaryObservation(record: TesterFlatRunRecord | null): string {
  if (!record) return 'strict active / fail-closed path pending observation';
  if (record.status === 'unavailable') return 'fail-closed observation; typed unavailable persisted';
  if (record.status === 'local-fixture') return 'strict active; local fixture recorded without runtime artifact claim';
  if (record.status === 'failed') return 'strict active; failed runtime result persisted without success claim';
  return 'strict active; runtime SDK result persisted through app-owned storage';
}

export function SectionRuns({ history, onOpenSection }: SectionRunsProps) {
  const [filter, setFilter] = useState<FilterValue>('all');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const records = useMemo(() => flattenTesterRunHistory(history), [history]);
  const filteredRecords = useMemo(
    () => records.filter((record) => filterRecord(record, filter)),
    [records, filter],
  );
  const selectedRecord = filteredRecords.find((record) => record.id === selectedRecordId) ?? filteredRecords[0] ?? null;
  const filteredHistory = useMemo(() => historyFromRecords(filteredRecords), [filteredRecords]);
  const runtimeResultCount = countByStatus(records, 'ready') + countByStatus(records, 'failed');
  const unavailableCount = countByStatus(records, 'unavailable');
  const localFixtureCount = countByStatus(records, 'local-fixture');

  const filterItems = useMemo(() => [
    { value: 'all' as FilterValue, label: 'All records' },
    { value: 'runtime-results' as FilterValue, label: 'Runtime results' },
    { value: 'unavailable-blockers' as FilterValue, label: 'Unavailable / blockers' },
    { value: 'local-fixtures' as FilterValue, label: 'Local fixtures' },
    ...testerCapabilities.map((capability) => ({ value: capability.id as FilterValue, label: capability.label })),
  ], []);

  return (
    <div className="section-runs section-runs--ledger">
      <header className="section-header section-header--compact runs-ledger-header">
        <div>
          <p className="eyebrow">Runs</p>
          <h2>Capability run evidence ledger</h2>
          <p>Review app-owned run records, runtime results, local fixtures, and boundary observations without claiming missing artifacts.</p>
        </div>
        <div className="runs-ledger-header__chips" aria-label="Run ledger summary">
          <StatusBadge tone={records.length === 0 ? 'neutral' : 'info'} shape="dot">total records: {records.length}</StatusBadge>
          <StatusBadge tone={runtimeResultCount === 0 ? 'neutral' : 'success'} shape="dot">runtime results: {runtimeResultCount}</StatusBadge>
          <StatusBadge tone={unavailableCount === 0 ? 'neutral' : 'warning'} shape="dot">typed blockers/unavailable: {unavailableCount}</StatusBadge>
          <StatusBadge tone={localFixtureCount === 0 ? 'neutral' : 'info'} shape="dot">local fixtures: {localFixtureCount}</StatusBadge>
        </div>
      </header>

      <div className="runs-ledger-layout">
        <Surface className="runs-ledger-panel runs-ledger-filters" material="glass-thin" tone="card" elevation="base">
          <div className="runs-ledger-panel__header">
            <p className="eyebrow">Run filters</p>
            <StatusBadge tone="neutral">{filterItems.length} views</StatusBadge>
          </div>
          <FieldShell label="Filter by record type or capability id">
            <SelectField
              value={filter}
              onValueChange={(value) => {
                setFilter(value as FilterValue);
                setSelectedRecordId(null);
              }}
              options={filterItems.map((item) => ({ value: item.value, label: item.label }))}
              aria-label="Filter run ledger records"
            />
          </FieldShell>
          <div className="runs-lane-coverage" aria-label="Capability coverage by lane">
            <p className="runs-lane-coverage__title">Capability coverage</p>
            <ul>
              {testerCapabilities.map((capability) => {
                const count = history?.[capability.id]?.length ?? 0;
                return (
                  <li key={capability.id} className={count > 0 ? 'runs-lane-coverage__row' : 'runs-lane-coverage__row runs-lane-coverage__row--empty'}>
                    <div>
                      <strong>{capability.label}</strong>
                      <code>{capability.id}</code>
                    </div>
                    <span>{count > 0 ? `${count} record${count === 1 ? '' : 's'}` : 'no record'}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Surface>

        <Surface className="runs-ledger-panel runs-ledger-timeline" material="glass-thin" tone="card" elevation="base">
          <div className="runs-ledger-panel__header">
            <div>
              <p className="eyebrow">Run timeline / ledger</p>
              <h3>Chronological run records</h3>
            </div>
            <StatusBadge tone={filteredRecords.length === 0 ? 'neutral' : 'info'}>{filteredRecords.length} shown</StatusBadge>
          </div>
          {filteredRecords.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={18} />}
              title="No run records for this view"
              description="Run a capability from App Lab or AI Capabilities to persist an app-owned local record. This page does not create placeholder rows."
            />
          ) : (
            <RunsHistoryList
              history={filteredHistory}
              className="runs-card__list runs-history--ledger"
              selectedRecordId={selectedRecord?.id ?? null}
              onSelectRecord={(record) => setSelectedRecordId(record.id)}
              showMessage
            />
          )}
        </Surface>

        <Surface className="runs-ledger-panel runs-evidence-detail" material="glass-thin" tone="card" elevation="base">
          <div className="runs-ledger-panel__header">
            <div>
              <p className="eyebrow">Selected record evidence detail</p>
              <h3>{selectedRecord ? selectedRecord.capabilityLabel : 'Empty evidence protocol'}</h3>
            </div>
            {selectedRecord ? (
              <StatusBadge tone={getTesterRunStatusTone(selectedRecord.status)} shape="dot">
                {getTesterRunStatusLabel(selectedRecord.status)}
              </StatusBadge>
            ) : null}
          </div>
          {selectedRecord ? (
            <div className="runs-evidence-detail__body">
              <div className="runs-evidence-detail__summary">
                <strong>{summarizePrompt(selectedRecord.prompt)}</strong>
                <span>{selectedRecord.message || 'No message recorded.'}</span>
                <time dateTime={selectedRecord.createdAt}>{formatTesterRunTimestamp(selectedRecord.createdAt)}</time>
              </div>
              <dl className="runs-evidence-fields">
                <div>
                  <dt>Record source</dt>
                  <dd>tester_run_history_load/save</dd>
                </div>
                <div>
                  <dt>Runtime result</dt>
                  <dd>{runtimeResult(selectedRecord)}</dd>
                </div>
                <div>
                  <dt>Local fixture</dt>
                  <dd>{selectedRecord.status === 'local-fixture' ? 'World Tour viewer fixture; not a runtime artifact' : 'none'}</dd>
                </div>
                <div>
                  <dt>Artifact</dt>
                  <dd>none; current run record has no artifact metadata</dd>
                </div>
                <div>
                  <dt>Trace</dt>
                  <dd>not captured; current run record has no trace metadata</dd>
                </div>
                <div>
                  <dt>Boundary</dt>
                  <dd>{boundaryObservation(selectedRecord)}</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>app-owned Tauri storage at {storagePath}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <EmptyState
              icon={<Boxes size={18} />}
              title="No selected record"
              description="The detail panel stays explicit: artifact is none, trace is not captured, and boundary status is only an observation until a real run record exists."
            />
          )}
        </Surface>
      </div>

      <Surface className="runs-protocol-strip" material="glass-thin" tone="card" elevation="base">
        <div className="runs-protocol-strip__item">
          <Database size={16} />
          <span>Retention: last 40 per capability, keyed by capability id in app-owned Tauri storage.</span>
        </div>
        <div className="runs-protocol-strip__item">
          <ShieldCheck size={16} />
          <span>Protocol: local record does not imply artifact availability, trace capture, or evidence completion.</span>
        </div>
        <div className="runs-protocol-strip__actions" aria-label="Run ledger navigation">
          {onOpenSection ? (
            <>
              <Button type="button" tone="secondary" size="sm" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenSection('app-lab')}>
                Open App Lab
              </Button>
              <Button type="button" tone="secondary" size="sm" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenSection('ai-capabilities')}>
                Open AI Capabilities
              </Button>
            </>
          ) : (
            <span><Route size={16} /> Populate from App Lab or AI Capabilities.</span>
          )}
        </div>
      </Surface>
    </div>
  );
}
