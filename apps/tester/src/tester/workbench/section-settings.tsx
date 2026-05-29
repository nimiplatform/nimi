import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, SegmentedControl, StatusBadge, Surface, Toggle } from '@nimiplatform/kit/ui';
import type { TesterAIConfigSummary } from '../tester-ai-config.js';
import type { TesterRunHistory } from '../tester-history.js';
import {
  TESTER_PREFERENCES_SCHEMA_VERSION,
  TESTER_PREFERENCES_STORAGE_KEY,
  TESTER_PROMPT_DRAFTS_SCHEMA_VERSION,
  TESTER_PROMPT_DRAFTS_STORAGE_KEY,
  type TesterEvidenceCaptureMode,
  type TesterPreferences,
  type TesterPreferenceStoreStatus,
} from '../tester-preferences.js';

const evidenceModes: Array<{ value: TesterEvidenceCaptureMode; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'after-run', label: 'After run' },
];

type SectionSettingsProps = {
  appId: string;
  scaffoldProfile: string;
  summary: TesterAIConfigSummary | null;
  history: TesterRunHistory | null;
  historyError: string | null;
  preferences: TesterPreferences;
  storeStatus: TesterPreferenceStoreStatus;
  onPreferenceChange: (patch: Partial<Omit<TesterPreferences, 'schemaVersion'>>) => void;
  onResetPreferences: () => void;
};

function storeTone(status: TesterPreferenceStoreStatus): 'success' | 'warning' | 'info' | 'neutral' {
  if (status.state === 'ready') return 'success';
  if (status.state === 'reset' || status.state === 'defaulted') return 'info';
  if (status.state === 'corrupt' || status.state === 'unavailable' || status.state === 'write-error') return 'warning';
  return 'neutral';
}

function storeLabel(status: TesterPreferenceStoreStatus): string {
  if (status.state === 'write-error') return 'write blocked';
  if (status.state === 'defaulted') return 'defaults active';
  return status.state;
}

function countRunRecords(history: TesterRunHistory | null): number {
  if (!history) return 0;
  return Object.values(history).reduce((total, records) => total + records.length, 0);
}

export function SectionSettings({
  appId,
  scaffoldProfile,
  summary,
  history,
  historyError,
  preferences,
  storeStatus,
  onPreferenceChange,
  onResetPreferences,
}: SectionSettingsProps) {
  const storageWritable = storeStatus.state !== 'unavailable' && storeStatus.state !== 'write-error';
  const runtime = summary?.runtime ?? null;
  const runRecordCount = countRunRecords(history);
  const captureDetail = preferences.evidenceCaptureMode === 'after-run'
    ? 'After-run capture triggers the same print workflow after local run/artifact persistence has been attempted.'
    : 'Manual capture only runs from the command bar Capture evidence action.';

  return (
    <div className="section-settings" data-testid="nimi-tester-section-settings">
      <header className="settings-control-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Developer control plane</h1>
          <p>Local workbench controls for app-owned preferences. Runtime, Auth, Provider, and SDK admission authority remains read-only here.</p>
        </div>
        <div className="settings-control-header__chips" aria-label="Settings status">
          <StatusBadge tone={storeTone(storeStatus)} shape="dot">Preference store: {storeLabel(storeStatus)}</StatusBadge>
          <StatusBadge tone={preferences.evidenceCaptureMode === 'after-run' ? 'info' : 'neutral'} shape="outline">
            Capture: {preferences.evidenceCaptureMode}
          </StatusBadge>
          <StatusBadge tone="neutral" shape="outline">Authority: read-only</StatusBadge>
        </div>
      </header>

      <div className="settings-control-grid">
        <Surface className="settings-control-panel settings-control-panel--primary" material="glass-thin" tone="panel" elevation="base">
          <div className="settings-control-panel__head">
            <div className="settings-control-panel__title">
              <HardDrive size={16} aria-hidden="true" />
              <div>
                <p className="eyebrow">Local preference store</p>
                <h3>App-owned workbench preferences</h3>
              </div>
            </div>
            <StatusBadge tone={storeTone(storeStatus)} shape="dot">{storeLabel(storeStatus)}</StatusBadge>
          </div>

          <div className="settings-store-status settings-store-status--compact">
            <CheckCircle2 size={15} aria-hidden="true" />
            <div>
              <strong>{storeStatus.message}</strong>
              <span>{TESTER_PREFERENCES_STORAGE_KEY} · schema v{TESTER_PREFERENCES_SCHEMA_VERSION}</span>
            </div>
          </div>
          {storeStatus.error ? (
            <div className="settings-store-status settings-store-status--warning">
              <AlertTriangle size={15} aria-hidden="true" />
              <div>
                <strong>Storage error</strong>
                <span>{storeStatus.error}</span>
              </div>
            </div>
          ) : null}

          <div className="settings-preference-list">
            <label className="settings-preference-row">
              <span>
                <strong>Persist request drafts</strong>
                <small>When enabled, App Lab and AI Capabilities save prompt edits per capability and scenario in localStorage.</small>
              </span>
              <Toggle
                checked={preferences.draftPersistence}
                disabled={!storageWritable}
                onChange={(draftPersistence) => onPreferenceChange({ draftPersistence })}
              />
            </label>
            <label className="settings-preference-row">
              <span>
                <strong>Verbose result console</strong>
                <small>Shows or hides local diagnostic hints in App Lab and AI Capabilities result panels.</small>
              </span>
              <Toggle
                checked={preferences.verboseConsole}
                disabled={!storageWritable}
                onChange={(verboseConsole) => onPreferenceChange({ verboseConsole })}
              />
            </label>
          </div>
        </Surface>

        <Surface className="settings-control-panel" material="glass-thin" tone="panel" elevation="base">
          <div className="settings-control-panel__head">
            <div className="settings-control-panel__title">
              <SlidersHorizontal size={16} aria-hidden="true" />
              <div>
                <p className="eyebrow">Evidence capture policy</p>
                <h3>Acceptance screenshot workflow</h3>
              </div>
            </div>
            <StatusBadge tone={preferences.evidenceCaptureMode === 'after-run' ? 'info' : 'neutral'} shape="dot">
              {preferences.evidenceCaptureMode}
            </StatusBadge>
          </div>
          <p className="settings-control-copy">{captureDetail}</p>
          <SegmentedControl
            items={evidenceModes.map((mode) => ({ ...mode, disabled: !storageWritable }))}
            value={preferences.evidenceCaptureMode}
            onValueChange={(value) => onPreferenceChange({ evidenceCaptureMode: value as TesterEvidenceCaptureMode })}
            ariaLabel="Evidence capture mode"
            size="sm"
          />
          <div className="settings-policy-facts">
            <span>Manual uses command bar Capture evidence.</span>
            <span>After-run calls window.print() after persistence attempt.</span>
            <span>No trace capture or provider scheduling is claimed.</span>
          </div>
        </Surface>

        <Surface className="settings-control-panel settings-control-panel--authority" material="glass-thin" tone="panel" elevation="base">
          <div className="settings-control-panel__head">
            <div className="settings-control-panel__title">
              <ShieldCheck size={16} aria-hidden="true" />
              <div>
                <p className="eyebrow">Authority boundaries</p>
                <h3>Read-only scaffold and runtime facts</h3>
              </div>
            </div>
            <StatusBadge tone="neutral" shape="outline">locked</StatusBadge>
          </div>
          <dl className="settings-authority-list">
            <div>
              <dt>App identity</dt>
              <dd>{appId}</dd>
            </div>
            <div>
              <dt>Scaffold profile</dt>
              <dd>{scaffoldProfile}</dd>
            </div>
            <div>
              <dt>Runtime status / mode</dt>
              <dd>{runtime ? `${runtime.status} / ${runtime.mode}` : 'checking / scaffold-managed'}</dd>
            </div>
            <div>
              <dt>Provider catalog surface</dt>
              <dd>{summary?.providerCatalogSurface || 'runtimeAdmin.listConnectors/listConnectorModels'}</dd>
            </div>
            <div>
              <dt>Scheduling owner</dt>
              <dd>{summary?.schedulingOwner || 'runtime'}</dd>
            </div>
            <div>
              <dt>App-local defaults</dt>
              <dd>{summary?.appLocalProviderDefaults === false ? 'forbidden' : 'not granted here'}</dd>
            </div>
          </dl>
          <div className="settings-readonly-note">
            <LockKeyhole size={15} aria-hidden="true" />
            <span>Settings cannot change Runtime, Auth, Provider, or SDK admission permissions.</span>
          </div>
        </Surface>

        <Surface className="settings-control-panel" material="glass-thin" tone="panel" elevation="base">
          <div className="settings-control-panel__head">
            <div className="settings-control-panel__title">
              <Database size={16} aria-hidden="true" />
              <div>
                <p className="eyebrow">Storage provenance</p>
                <h3>Reset local controls</h3>
              </div>
            </div>
            <StatusBadge tone={historyError ? 'warning' : 'info'} shape="dot">
              {runRecordCount} run records
            </StatusBadge>
          </div>
          <div className="settings-provenance-grid">
            <div>
              <span>Preferences</span>
              <strong>window.localStorage</strong>
              <small>{TESTER_PREFERENCES_STORAGE_KEY} · schema v{TESTER_PREFERENCES_SCHEMA_VERSION}</small>
            </div>
            <div>
              <span>Prompt drafts</span>
              <strong>window.localStorage</strong>
              <small>{TESTER_PROMPT_DRAFTS_STORAGE_KEY} · schema v{TESTER_PROMPT_DRAFTS_SCHEMA_VERSION}</small>
            </div>
          </div>
          <div className="settings-provenance-grid">
            <div>
              <span>Runs / artifacts</span>
              <strong>app-owned Tauri commands and local history</strong>
              <small>{historyError || 'Evidence records are displayed read-only from their own stores.'}</small>
            </div>
          </div>
          <div className="settings-reset-row">
            <div>
              <strong>Reset local preferences</strong>
              <span>Restores defaults for draft persistence, verbose console, and evidence capture mode. Prompt drafts, runs, and artifacts are not cleared.</span>
            </div>
            <Button
              type="button"
              tone="secondary"
              size="sm"
              leadingIcon={<RotateCcw size={14} />}
              disabled={!storageWritable && storeStatus.state !== 'write-error'}
              onClick={onResetPreferences}
            >
              Reset preferences
            </Button>
          </div>
        </Surface>
      </div>
    </div>
  );
}
