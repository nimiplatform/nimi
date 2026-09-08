import { useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useTranslation } from '../../shell/i18n/index.js';
import { openWorldTourWindow, resolveWorldTourFixture } from './world-tour-shared.js';
import { resumeWorldTour } from './world-tour-runtime.js';

export function WorldTourActions() {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  const resume = async () => {
    setResuming(true); setError(''); setMessage('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await resumeWorldTour(controller.signal, setMessage);
      setMessage(result.message);
    } catch (cause) {
      setMessage('');
      setError(controller.signal.aborted ? t('WorldTour.canceled') : cause instanceof Error ? cause.message : t('WorldTour.generationFailed'));
    } finally { setResuming(false); abort.current = null; }
  };
  const open = async () => {
    setOpening(true); setError('');
    try {
      const world = await resolveWorldTourFixture({});
      await openWorldTourWindow({ manifestPath: world.manifestPath });
    } catch (cause) {
      setError(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'not-found'
        ? t('WorldTour.noSavedWorld') : cause instanceof Error ? cause.message : t('WorldTour.launchClaimFailed'));
    } finally { setOpening(false); }
  };
  return <div className="world-tour-actions">
    <Button tone="secondary" size="sm" disabled={opening} onClick={() => void open()}>{t('WorldTour.openSaved')}</Button>
    <Button tone="secondary" size="sm" disabled={resuming} onClick={() => void resume()}>{t('WorldTour.resume')}</Button>
    {resuming ? <Button tone="secondary" size="sm" onClick={() => abort.current?.abort()}>{t('WorldTour.cancel')}</Button> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
  </div>;
}
