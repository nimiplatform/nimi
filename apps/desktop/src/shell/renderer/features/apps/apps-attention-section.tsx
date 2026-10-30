import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Surface } from '@nimiplatform/kit/ui';
import { collectAppsAIConfigIssues, type AppsAttentionIssue } from './apps-attention.js';
import { entryOperationNeedsAttention } from './apps-card-fields.js';
import { AppListRow } from './apps-list-row.js';
import { appsActionsLocked, pendingActionForEntry, type AppCardActionId, type AppsPendingAction } from './apps-card-actions.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import { AppsLocalPreparation } from './apps-local-preparation.js';
import { groupAppsEntries } from './apps-entry-groups.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r102
export function AppsAttentionSection(props: {
  readonly entries: readonly DesktopAppsEntry[];
  readonly iconUrls: ReadonlyMap<string, string | null>;
  readonly pendingActions: readonly AppsPendingAction[];
  readonly actionDispatcherFor: (entryKey: string) => (action: AppCardActionId) => void;
  readonly onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const issues = collectAppsAIConfigIssues(props.entries);
  const local = issues.filter(issue => issue.route === 'local');
  const cloud = issues.filter(issue => issue.route === 'cloud');
  const operations = props.entries.filter(entryOperationNeedsAttention);
  const [preparing, setPreparing] = useState<readonly AppsAttentionIssue[] | null>(null);
  const operationRow = (entry: DesktopAppsEntry) => <AppListRow key={entry.identity.entryKey} entry={entry} iconUrl={props.iconUrls.get(entry.identity.appId)} showSourceBadge presentation="attention"
    activeAction={pendingActionForEntry(props.pendingActions, entry.identity.entryKey)} actionsDisabled={appsActionsLocked(props.pendingActions, entry.identity.appId)}
    onAction={props.actionDispatcherFor(entry.identity.entryKey)} />;
  if (!issues.length && !operations.length && !preparing) return null;
  return <Surface as="section" tone="card" padding="none" className="desktop-module-card" data-testid="apps-home-attention" aria-label={t('Apps.home.attentionTitle')}>
    <div className="space-y-5">
      {local.length || preparing ? <div className="space-y-3" data-testid="apps-attention-local">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="desktop-module-section-title">{t('Apps.attention.localTitle')}</h2>
          {!preparing ? <Button size="sm" tone="primary" onClick={() => setPreparing(local)} data-testid="apps-review-local-preparation">{t('Apps.attention.reviewPreparation')}</Button> : null}
        </div>
        {preparing ? <AppsLocalPreparation issues={preparing} onClose={() => { setPreparing(null); props.onRefresh(); }} onChanged={props.onRefresh} /> :
          <ul className="divide-y divide-[var(--nimi-border-subtle)]">{local.map(issue => <li key={issue.key} className="py-3" data-testid={`apps-local-issue:${issue.capabilityContract}`}>
            <div className="text-sm font-semibold">{displayRuntimeConfigCapabilityLabel(issue.capabilityContract, t)}</div>
            <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('Apps.attention.affects', { apps: issue.apps.map(app => app.identity.displayName).join('、') })}</p>
          </li>)}</ul>}
      </div> : null}
      {cloud.length ? <div className="space-y-2" data-testid="apps-attention-choices">
        <h2 className="desktop-module-section-title">{t('Apps.attention.choicesTitle')}</h2>
        <ul className="divide-y divide-[var(--nimi-border-subtle)]">{cloud.map(issue => <li key={issue.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><div className="text-sm font-semibold">{issue.apps[0]!.identity.displayName} · {displayRuntimeConfigCapabilityLabel(issue.capabilityContract, t)}</div>
            <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t(issue.reasons.includes('AI_REMOTE_MODEL_CATALOG_STALE') ? 'Apps.attention.cloudStale' : 'Apps.attention.cloudChoice')}</p>
          </div>
          <Button size="sm" onClick={() => props.actionDispatcherFor(issue.apps[0]!.identity.entryKey)('open-ai-config')}>{t('Apps.attention.reviewChoice')}</Button>
        </li>)}</ul>
      </div> : null}
      {operations.length ? <div className="space-y-2"><h2 className="desktop-module-section-title">{t('Apps.attention.operationsTitle')}</h2>
        {groupAppsEntries(operations).map(group => group.entries.length === 1 ? operationRow(group.primary) :
          <details key={group.appId} data-testid={`apps-attention-group:${group.appId}`}>
            <summary className="cursor-pointer py-3 text-sm font-semibold">{group.displayName} · {t('Apps.home.attentionSources', { count: group.entries.length })}</summary>
            {group.entries.map(entry => <div key={entry.identity.entryKey}>
              {entry.localDevelopment ? <p className="break-all px-4 pt-3 text-xs text-[var(--nimi-text-secondary)]">{entry.localDevelopment.canonicalProjectRoot} · {entry.localDevelopment.selector}</p> : null}
              {operationRow(entry)}
            </div>)}
          </details>)}
      </div> : null}
    </div>
  </Surface>;
}
