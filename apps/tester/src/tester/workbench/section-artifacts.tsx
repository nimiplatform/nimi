import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, FieldShell, InlineAlert, SelectField, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { ArrowRight, Boxes, Database, FileImage, PackageOpen, RefreshCw, ShieldCheck } from 'lucide-react';
import { testerCapabilities, type TesterCapabilityId } from '../tester-capabilities.js';
import {
  formatTesterRunTimestamp,
  getTesterRunStatusTone,
  type TesterRunStatusTone,
} from '../tester-history.js';
import { loadTesterImageHistory, type TesterImageHistoryRecord } from '../tester-image-history.js';
import type { WorkbenchSectionId } from './workbench-context.js';

type SectionArtifactsProps = {
  onOpenSection?: (section: WorkbenchSectionId) => void;
};

type ArtifactsState =
  | { kind: 'loading' }
  | { kind: 'ready'; records: TesterImageHistoryRecord[] }
  | { kind: 'error'; message: string };

type ArtifactFilter =
  | 'all'
  | 'runtime-media'
  | 'unavailable'
  | 'local-fixtures'
  | 'image.generate'
  | 'video.generate'
  | 'speech'
  | 'world.generate';

const storagePath = '$TMPDIR/nimiapp-tester/tester-image-history.json';
const sourceCoverage: Array<{
  id: string;
  label: string;
  capabilityIds: string[];
  note: string;
}> = [
  {
    id: 'image.generate',
    label: 'Image Generate',
    capabilityIds: ['image.generate'],
    note: 'Runtime media artifact',
  },
  {
    id: 'video.generate',
    label: 'Video Generate',
    capabilityIds: ['video.generate'],
    note: 'Runtime media artifact',
  },
  {
    id: 'speech.bundle',
    label: 'Speech Bundle',
    capabilityIds: ['audio.synthesize', 'speech.bundle'],
    note: 'Speech output only persists when Runtime returns artifact output',
  },
  {
    id: 'world.generate',
    label: 'World Tour fixture',
    capabilityIds: ['world.generate'],
    note: 'Local fixture; not persisted as runtime artifact',
  },
];

function statusTone(status: TesterImageHistoryRecord['status']): TesterRunStatusTone {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'danger';
  return 'warning';
}

function getCapabilityLabel(capabilityId: string, fallback?: string): string {
  if (fallback) return fallback;
  return testerCapabilities.find((capability) => capability.id === capabilityId)?.label || capabilityId;
}

function artifactLabel(record: TesterImageHistoryRecord): string {
  return record.artifactLabel || record.title || record.jobId || 'Runtime media artifact';
}

function storedArtifactCount(record: TesterImageHistoryRecord): number | null {
  if (record.kind !== 'runtime-media') return null;
  if (typeof record.artifactCount !== 'number') return null;
  if (!Number.isFinite(record.artifactCount) || record.artifactCount <= 0) return null;
  return record.artifactCount;
}

function isConfirmedRuntimeMediaArtifact(record: TesterImageHistoryRecord): boolean {
  return record.kind === 'runtime-media' && record.status === 'ready' && storedArtifactCount(record) !== null;
}

function artifactKindLabel(record: TesterImageHistoryRecord): string {
  if (record.kind !== 'runtime-media') return 'legacy/unknown stored record';
  if (storedArtifactCount(record) === null) return 'unknown from stored record';
  if (record.mimeType) return record.mimeType;
  if (record.capabilityId === 'image.generate') return 'image artifact';
  if (record.capabilityId === 'video.generate') return 'video artifact';
  if (record.capabilityId === 'audio.synthesize' || record.capabilityId === 'speech.bundle') return 'speech artifact';
  return 'media artifact';
}

function filterArtifact(record: TesterImageHistoryRecord, filter: ArtifactFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'runtime-media') return isConfirmedRuntimeMediaArtifact(record);
  if (filter === 'unavailable') return record.status === 'unavailable' || record.status === 'failed';
  if (filter === 'local-fixtures') return false;
  if (filter === 'speech') return record.capabilityId === 'audio.synthesize' || record.capabilityId === 'speech.bundle';
  return record.capabilityId === filter;
}

function countCoverage(records: TesterImageHistoryRecord[], capabilityIds: string[]): number {
  if (capabilityIds.includes('world.generate')) return 0;
  return records.filter((record) => capabilityIds.includes(record.capabilityId) && isConfirmedRuntimeMediaArtifact(record)).length;
}

function runtimeResult(record: TesterImageHistoryRecord | null): string {
  if (!record) return 'no selected record';
  if (!record.kind) return 'legacy/unknown stored record';
  if (record.kind !== 'runtime-media') return 'not runtime artifact';
  if (storedArtifactCount(record) === null) return `${record.status}; artifact metadata incomplete`;
  return record.status;
}

function artifactCountTypeLabel(record: TesterImageHistoryRecord | null): string {
  if (!record) return 'none';
  const count = storedArtifactCount(record);
  if (count === null) return 'not captured / unknown from stored record';
  return `${count} / ${artifactKindLabel(record)}`;
}

function artifactRowMessage(record: TesterImageHistoryRecord): string {
  if (record.message) return record.message;
  if (isConfirmedRuntimeMediaArtifact(record)) return 'Runtime artifact record persisted.';
  return 'Stored record is missing confirmed runtime artifact metadata.';
}

function traceState(record: TesterImageHistoryRecord | null): string {
  if (!record) return 'not captured';
  if (record.traceState === 'captured') return record.traceId ? `captured (${record.traceId})` : 'captured';
  return 'not captured; current artifact record has no trace metadata';
}

export function SectionArtifacts({ onOpenSection }: SectionArtifactsProps) {
  const [state, setState] = useState<ArtifactsState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadTesterImageHistory()
      .then((records) => {
        if (!active) return;
        setState({ kind: 'ready', records });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error || 'Artifacts unavailable.'),
        });
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const records = state.kind === 'ready' ? state.records : [];
  const filteredRecords = useMemo(() => records.filter((record) => filterArtifact(record, filter)), [records, filter]);
  const selectedRecord = filteredRecords.find((record) => record.id === selectedRecordId) ?? filteredRecords[0] ?? null;
  const totalArtifactCount = records.reduce((total, record) => total + (storedArtifactCount(record) || 0), 0);
  const runtimeMediaCount = records.filter(isConfirmedRuntimeMediaArtifact).length;
  const traceCapturedCount = records.filter((record) => record.traceState === 'captured').length;
  const traceLabel = traceCapturedCount > 0 ? `trace captured: ${traceCapturedCount}` : 'trace not captured';
  const filterItems = [
    { value: 'all' as ArtifactFilter, label: 'All artifacts' },
    { value: 'runtime-media' as ArtifactFilter, label: 'Runtime media' },
    { value: 'unavailable' as ArtifactFilter, label: 'Unavailable / failed' },
    { value: 'local-fixtures' as ArtifactFilter, label: 'Local fixtures' },
    { value: 'image.generate' as ArtifactFilter, label: 'Image' },
    { value: 'video.generate' as ArtifactFilter, label: 'Video' },
    { value: 'speech' as ArtifactFilter, label: 'Speech' },
    { value: 'world.generate' as ArtifactFilter, label: 'World' },
  ];

  return (
    <div className="section-artifacts section-artifacts--inventory">
      <header className="section-header section-header--compact artifacts-inventory-header">
        <div>
          <p className="eyebrow">Artifacts</p>
          <h2>Artifact inventory</h2>
          <p>Inspect real runtime media outputs and local fixture references without creating placeholder artifacts.</p>
        </div>
        <div className="artifacts-inventory-header__chips" aria-label="Artifact inventory summary">
          <StatusBadge tone={totalArtifactCount === 0 ? 'neutral' : 'info'} shape="dot">total artifacts: {totalArtifactCount}</StatusBadge>
          <StatusBadge tone={runtimeMediaCount === 0 ? 'neutral' : 'success'} shape="dot">runtime media: {runtimeMediaCount}</StatusBadge>
          <StatusBadge tone="neutral" shape="dot">local fixtures: 0</StatusBadge>
          <StatusBadge tone={traceCapturedCount === 0 ? 'neutral' : 'info'} shape="dot">{traceLabel}</StatusBadge>
          <Button
            type="button"
            tone="secondary"
            size="sm"
            leadingIcon={<RefreshCw size={14} />}
            onClick={() => setReloadKey((value) => value + 1)}
          >
            Reload
          </Button>
        </div>
      </header>

      <div className="artifacts-inventory-layout">
        <Surface className="artifacts-inventory-panel artifacts-inventory-filters" material="glass-thin" tone="card" elevation="base">
          <div className="artifacts-inventory-panel__header">
            <p className="eyebrow">Artifact filters</p>
            <StatusBadge tone="neutral">{filterItems.length} views</StatusBadge>
          </div>
          <FieldShell label="Filter by artifact source or media type">
            <SelectField
              value={filter}
              onValueChange={(value) => {
                setFilter(value as ArtifactFilter);
                setSelectedRecordId(null);
              }}
              options={filterItems.map((item) => ({ value: item.value, label: item.label }))}
              aria-label="Filter artifact inventory"
            />
          </FieldShell>
          <div className="artifacts-source-coverage" aria-label="Artifact source coverage">
            <p className="artifacts-source-coverage__title">Source coverage</p>
            <ul>
              {sourceCoverage.map((source) => {
                const count = countCoverage(records, source.capabilityIds);
                return (
                  <li key={source.id} className={count > 0 ? 'artifacts-source-coverage__row' : 'artifacts-source-coverage__row artifacts-source-coverage__row--empty'}>
                    <div>
                      <strong>{source.label}</strong>
                      <code>{source.id}</code>
                      <span>{source.note}</span>
                    </div>
                    <em>{count > 0 ? `${count} record${count === 1 ? '' : 's'}` : 'no record'}</em>
                  </li>
                );
              })}
            </ul>
          </div>
        </Surface>

        <Surface className="artifacts-inventory-panel artifacts-inventory-list" material="glass-thin" tone="card" elevation="base">
          <div className="artifacts-inventory-panel__header">
            <div>
              <p className="eyebrow">Artifact inventory</p>
              <h3>Runtime media records</h3>
            </div>
            <StatusBadge tone={filteredRecords.length === 0 ? 'neutral' : 'info'}>{filteredRecords.length} shown</StatusBadge>
          </div>
          {state.kind === 'loading' ? (
            <p className="artifacts-card__status">Loading artifact projection...</p>
          ) : null}
          {state.kind === 'error' ? (
            <InlineAlert tone="warning">
              <div className="runtime-alert-copy">
                <strong>Typed unavailable</strong>
                <span>{state.message}</span>
                <span>tester_image_history_load/save is the only admitted artifact storage command; fix the Tauri command before retrying.</span>
              </div>
            </InlineAlert>
          ) : null}
          {state.kind === 'ready' && filteredRecords.length === 0 ? (
            <EmptyState
              icon={<PackageOpen size={18} />}
              title="Empty artifact inventory"
              description="Run Image Generate, Video Generate, or Speech from App Lab or AI Capabilities to persist a real Runtime/SDK artifact record. No placeholder media is created here."
            />
          ) : null}
          {state.kind === 'ready' && filteredRecords.length > 0 ? (
            <ul className="artifacts-inventory-records">
              {filteredRecords.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    className={record.id === selectedRecord?.id ? 'artifacts-inventory-row artifacts-inventory-row--selected' : 'artifacts-inventory-row'}
                    onClick={() => setSelectedRecordId(record.id)}
                  >
                    <FileImage size={16} aria-hidden="true" />
                    <div className="artifacts-inventory-row__main">
                      <strong>{artifactLabel(record)}</strong>
                      <span>{getCapabilityLabel(record.capabilityId, record.capabilityLabel)} · run {record.runId || record.id}</span>
                      <small>{artifactRowMessage(record)}</small>
                    </div>
                    <div className="artifacts-inventory-row__meta">
                      <StatusBadge tone={statusTone(record.status)} shape="dot">{runtimeResult(record)}</StatusBadge>
                      <span>{artifactCountTypeLabel(record)}</span>
                      <time dateTime={record.createdAt}>{formatTesterRunTimestamp(record.createdAt)}</time>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Surface>

        <Surface className="artifacts-inventory-panel artifacts-evidence-detail" material="glass-thin" tone="card" elevation="base">
          <div className="artifacts-inventory-panel__header">
            <div>
              <p className="eyebrow">Selected artifact detail / protocol</p>
              <h3>{selectedRecord ? artifactLabel(selectedRecord) : 'Empty artifact protocol'}</h3>
            </div>
            {selectedRecord ? (
              <StatusBadge tone={getTesterRunStatusTone(selectedRecord.status)} shape="dot">
                {runtimeResult(selectedRecord)}
              </StatusBadge>
            ) : null}
          </div>
          <dl className="artifacts-evidence-fields">
            <div>
              <dt>Artifact source</dt>
              <dd>tester_image_history_load/save</dd>
            </div>
            <div>
              <dt>Linked run</dt>
              <dd>{selectedRecord?.runId || selectedRecord?.id || 'no selected record'}</dd>
            </div>
            <div>
              <dt>Runtime result</dt>
              <dd>{runtimeResult(selectedRecord)}</dd>
            </div>
            <div>
              <dt>Artifact count/type</dt>
              <dd>{artifactCountTypeLabel(selectedRecord)}</dd>
            </div>
            <div>
              <dt>MIME</dt>
              <dd>{selectedRecord?.mimeType || 'not captured'}</dd>
            </div>
            <div>
              <dt>Trace</dt>
              <dd>{traceState(selectedRecord)}</dd>
            </div>
            <div>
              <dt>Boundary</dt>
              <dd>strict boundary active / no REST bypass</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{storagePath}</dd>
            </div>
          </dl>
          <p className="artifacts-evidence-detail__note">
            Local record does not imply trace or evidence completion. World Tour local fixture lives outside runtime artifact inventory.
          </p>
          {!selectedRecord ? (
            <EmptyState
              icon={<Boxes size={18} />}
              title="No selected artifact"
              description="The detail panel stays explicit: linked run is absent, trace is not captured, and no artifact is claimed until a real runtime media record exists."
            />
          ) : null}
        </Surface>
      </div>

      <Surface className="runs-protocol-strip artifacts-protocol-strip" material="glass-thin" tone="card" elevation="base">
        <div className="runs-protocol-strip__item">
          <Database size={16} />
          <span>Retention: last 80 records in tester_image_history_load/save.</span>
        </div>
        <div className="runs-protocol-strip__item">
          <ShieldCheck size={16} />
          <span>Only real Runtime/SDK artifact records persisted. World Tour local fixture is not runtime artifact.</span>
        </div>
        <div className="runs-protocol-strip__actions" aria-label="Artifact inventory navigation">
          {onOpenSection ? (
            <>
              <Button type="button" tone="secondary" size="sm" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenSection('app-lab')}>
                Open App Lab
              </Button>
              <Button type="button" tone="secondary" size="sm" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenSection('ai-capabilities')}>
                Open AI Capabilities
              </Button>
              <Button type="button" tone="secondary" size="sm" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenSection('runs')}>
                Open Runs
              </Button>
            </>
          ) : (
            <span>Populate from App Lab or AI Capabilities, then inspect linkage in Runs.</span>
          )}
        </div>
      </Surface>
    </div>
  );
}
