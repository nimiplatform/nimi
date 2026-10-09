import type { LabIntegrationHistoryRecord } from './integration-history-model.js';
import { useTranslation } from '../../shell/i18n/index.js';

// History owns saved facts, not the current occupant of an App asset path.
export function HistoricalIntegrationAssets({ record }: { record: LabIntegrationHistoryRecord }) {
  const { t } = useTranslation();
  if (!record.assetPaths.length) return null;
  return <div className="mt-3 text-xs" data-testid="integration-historical-assets"><p>{t('Integrations.historicalFilesHelp')}</p>{record.assetPaths.map(path => <p key={path} className="mt-1 break-all">{path}</p>)}</div>;
}

export function IntegrationSavedRecord({ record }: { record: LabIntegrationHistoryRecord }) {
  const { t } = useTranslation();
  return <><h3 className="font-semibold">{t('Integrations.savedRecord')}</h3><p className="mt-2 text-xs">{t('Integrations.savedSnapshot')}</p>
    <p className="mt-2 break-all text-sm">{record.targetDisplayName} · {record.operation} · {t(`Integrations.states.${record.status}`)}</p>
    <p className="mt-1 break-all text-xs">{record.callId} · {record.createdAt}</p>
    {record.errorCode ? <p className="mt-2 text-sm">{record.errorCode}</p> : null}
    {record.inputJson ? <><h4 className="mt-3 text-sm">{t('Integrations.savedInput')}</h4><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(record.inputJson), null, 2)}</pre></> : null}
    {record.resultJson ? <><h4 className="mt-3 text-sm">{t('Integrations.savedResult')}</h4><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(record.resultJson), null, 2)}</pre></> : null}
    {!record.inputJson && !record.resultJson ? <p className="mt-3 text-sm">{t('Integrations.noSavedBody')}</p> : null}
    <HistoricalIntegrationAssets record={record} />
  </>;
}
