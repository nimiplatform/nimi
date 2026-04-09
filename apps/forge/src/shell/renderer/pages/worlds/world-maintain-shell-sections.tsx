import { Button } from '@nimiplatform/nimi-kit/ui';
import { WorldRuleTruthPanel } from './world-rule-truth-panel.js';

type WorldMaintainHeaderProps = {
  backTo: string;
  effectiveWorldId: string;
  onBack: () => void;
  onSave: () => void;
  title?: string;
  translate: (key: string, fallback: string) => string;
  working: boolean;
};

export function WorldMaintainHeader({
  backTo: _backTo,
  effectiveWorldId,
  onBack,
  onSave,
  title,
  translate,
  working,
}: WorldMaintainHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          tone="ghost"
          size="sm"
          onClick={onBack}
        >
          &larr; {translate('worlds.backToList', 'Back')}
        </Button>
        <h1 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
          {title || translate('pages.worldMaintain', 'Maintain World')}
        </h1>
        <span className="text-xs text-[var(--nimi-text-muted)]">{effectiveWorldId.slice(0, 8)}</span>
      </div>
      <Button
        tone="primary"
        size="sm"
        disabled={working}
        onClick={onSave}
      >
        {translate('maintain.save', 'Save')}
      </Button>
    </div>
  );
}

type WorldMaintainAlertsProps = {
  error: string | null;
  notice: string | null;
  onClearError: () => void;
  onClearNotice: () => void;
};

export function WorldMaintainAlerts({
  error,
  notice,
  onClearError,
  onClearNotice,
}: WorldMaintainAlertsProps) {
  return (
    <>
      {error && (
        <div className="flex items-center justify-between border-b border-[var(--nimi-status-danger)]/20 bg-[var(--nimi-status-danger)]/10 px-4 py-2 text-sm text-[var(--nimi-status-danger)]">
          <span>{error}</span>
          <Button tone="ghost" size="sm" onClick={onClearError}>&times;</Button>
        </div>
      )}
      {notice && !error && (
        <div className="flex items-center justify-between border-b border-[var(--nimi-status-success)]/20 bg-[var(--nimi-status-success)]/10 px-4 py-2 text-sm text-[var(--nimi-status-success)]">
          <span>{notice}</span>
          <Button tone="ghost" size="sm" onClick={onClearNotice}>&times;</Button>
        </div>
      )}
    </>
  );
}

type WorldMaintainTruthPanelSectionProps = Parameters<typeof WorldRuleTruthPanel>[0];

export function WorldMaintainTruthPanelSection(props: WorldMaintainTruthPanelSectionProps) {
  return <WorldRuleTruthPanel {...props} />;
}
