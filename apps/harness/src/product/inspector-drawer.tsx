import { Button } from '@nimiplatform/kit/ui';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { FolderTree, Plug, SlidersHorizontal, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import type { SessionDrafts } from './session-drafts.js';
import type { HarnessView } from './harness-types.js';
import { WorkspaceFiles } from './workspace-files.js';
import { SessionSettings } from './session-settings.js';
import { IntegrationsPanel } from './integrations-panel.js';

export type InspectorTab = 'files' | 'session' | 'integrations';

export function InspectorDrawer({
  tab,
  onTabChange,
  onClose,
  view,
  selectedFile,
  onSelectFile,
  scope,
  drafts,
  report,
}: {
  tab: InspectorTab;
  onTabChange: (next: InspectorTab) => void;
  onClose: () => void;
  view: HarnessView;
  selectedFile?: string;
  onSelectFile: (ref: string | undefined) => void;
  scope?: NimiAppScope;
  drafts?: SessionDrafts;
  report: (message: string) => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="harness-inspector" aria-label="Inspector">
      <header className="harness-inspector__header">
        <div className="harness-inspector__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'files'}
            className={`harness-tab-btn ${tab === 'files' ? 'harness-tab-btn--active' : ''}`}
            onClick={() => onTabChange('files')}
          >
            <FolderTree size={14} aria-hidden="true" />
            <span>{t('inspector.files')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'session'}
            className={`harness-tab-btn ${tab === 'session' ? 'harness-tab-btn--active' : ''}`}
            onClick={() => onTabChange('session')}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>{t('inspector.session')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'integrations'}
            className={`harness-tab-btn ${tab === 'integrations' ? 'harness-tab-btn--active' : ''}`}
            onClick={() => onTabChange('integrations')}
          >
            <Plug size={14} aria-hidden="true" />
            <span>{t('inspector.integrations')}</span>
          </button>
        </div>
        <Button size="sm" tone="ghost" leadingIcon={<X size={14} />} onClick={onClose} aria-label={t('inspector.close')} />
      </header>

      <div className="harness-inspector__body">
        {tab === 'files' && (
          <WorkspaceFiles
            key={'files:' + view.sessionId + ':' + (view.workspaceDir ?? '')}
            sessionId={view.sessionId}
            selected={selectedFile}
            toolRevision={view.workspaceRevision}
            drafts={drafts}
            onSelect={onSelectFile}
          />
        )}
        {tab === 'session' && scope && (
          <SessionSettings
            key={'settings:' + scope.viewKey + ':' + view.sessionId}
            scope={scope}
            id={view.sessionId}
            instructions={view.instructions}
            running={view.running}
            usage={view.usage}
            contextWindowTokens={view.contextWindowTokens}
            sessionAllowlist={view.sessionAllowlist}
            report={report}
          />
        )}
        {tab === 'integrations' && <IntegrationsPanel />}
      </div>
    </aside>
  );
}
