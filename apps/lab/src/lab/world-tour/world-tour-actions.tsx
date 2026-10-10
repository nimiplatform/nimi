import { useContext, useEffect, useRef, useState } from 'react';
import { StudioHistoryResultContext } from '../../ai-studio-core/contexts.js';
import type { StudioParameterPanelProps } from '../../ai-studio-core/parameter-fields.js';
import { WorldTourInputPanel } from './world-tour-input-panel.js';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useTranslation } from '../../shell/i18n/index.js';
import { useLabRendererHost } from '../../renderer/context.js';

export function WorldTourActions(props: StudioParameterPanelProps) {
  const rendererHost = useLabRendererHost();
  const commitResult = useContext(StudioHistoryResultContext);
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  const observation = useRef<AbortController | null>(null);
  useEffect(() => () => observation.current?.abort(), []);
  const resume = async () => {
    if (props.disabled || observation.current) return;
    setResuming(true); setError(''); setMessage('');
    const controller = new AbortController();
    abort.current = controller;
    const view = new AbortController(); observation.current = view;
    try {
      const result = await rendererHost.app.commands.resumeWorldTour(controller.signal, setMessage, view.signal);
      view.signal.throwIfAborted();
      if (result.ok) controller.signal.throwIfAborted();
      if (result.recordedHistory && commitResult) await commitResult(result, result.recordedHistory.prompt, result.recordedHistory.runConfig);
      if (result.ok) setMessage(result.message);
      else {
        setMessage('');
        setError(result.jobId ? `${result.message} (${result.jobId})` : result.message);
      }
    } catch (cause) {
      if (view.signal.aborted) return;
      setMessage('');
      setError(cause instanceof Error ? cause.message : t('WorldTour.generationFailed'));
    } finally { if (!view.signal.aborted) setResuming(false); abort.current = null; observation.current = null; }
  };
  const open = async () => {
    setOpening(true); setError('');
    try {
      const world = await rendererHost.app.commands.resolveWorldTourFixture({});
      await rendererHost.app.commands.openWorldTourWindow({ manifestPath: world.manifestPath });
    } catch (cause) {
      setError(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'not-found'
        ? t('WorldTour.noSavedWorld') : cause instanceof Error ? cause.message : t('WorldTour.launchClaimFailed'));
    } finally { setOpening(false); }
  };
  return <div className="world-tour-actions">
    <WorldTourInputPanel {...props} />
    <Button tone="secondary" size="sm" disabled={opening} onClick={() => void open()}>{t('WorldTour.openSaved')}</Button>
    <Button tone="secondary" size="sm" disabled={props.disabled || resuming} onClick={() => void resume()}>{t('WorldTour.resume')}</Button>
    {resuming ? <Button tone="secondary" size="sm" onClick={() => abort.current?.abort()}>{t('WorldTour.cancel')}</Button> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
  </div>;
}
