import { useState } from 'react';
import { WorldInputPreview } from './world-tour-input-panel.js';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type { StudioRunHistoryRecord } from '../../ai-studio-core/history.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { openWorldTourHistory, worldTourHistoryManifest } from './world-tour-history.js';

export function WorldTourHistoryActions({ record }: { readonly record: StudioRunHistoryRecord }) {
  const host = useLabRendererHost();
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  if (!worldTourHistoryManifest(record)) return null;
  const open = async () => {
    setOpening(true); setError(false);
    try { await openWorldTourHistory(record, host.app.commands); }
    catch { setError(true); }
    finally { setOpening(false); }
  };
  const source = record.result?.ok && record.result.kind === 'artifacts' ? record.result.sourceImage : undefined;
  return <div className="world-tour-history-actions">
    {!record.runConfig ? <InlineAlert tone="warning">{t('WorldTour.originalInputUnknown')}</InlineAlert> : null}
    {source ? <WorldInputPreview source={source} /> : null}
    <Button type="button" tone="secondary" size="sm" disabled={opening} onClick={() => void open()}>{t('WorldTour.openThisWorld')}</Button>
    {error ? <InlineAlert tone="warning">{t('WorldTour.historyUnavailable')}</InlineAlert> : null}
  </div>;
}
