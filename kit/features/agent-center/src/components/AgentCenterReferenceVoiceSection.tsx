import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { agentCenterEnCatalog } from '../locales/index.js';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { translateAgentCenter } from '../i18n.js';
import type { AgentCenterAppearanceSectionProps } from './AgentCenterAppearanceSection.js';

export function AgentCenterReferenceVoiceSection({ session, snapshot, i18n, placementActions, blocked = false }: AgentCenterAppearanceSectionProps & { readonly blocked?: boolean }) {
  const voice = snapshot.state.appearance.referenceVoice;
  const [error, setError] = useState(false);
  const activeSessionRef = useRef<typeof session | null>(session);
  activeSessionRef.current = session;
  useEffect(() => {
    activeSessionRef.current = session;
    setError(false);
    return () => { activeSessionRef.current = null; };
  }, [session]);
  if (!voice || !session.appearance.useReferenceVoice) return null;
  const t = (key: string, fallback: string) => translateAgentCenter(i18n, `AgentCenter.referenceVoice.${key}`, agentCenterEnCatalog[`AgentCenter.referenceVoice.${key}` as keyof typeof agentCenterEnCatalog] ?? fallback);
  const busy = voice.phase === 'creating' || voice.phase === 'binding';
  const setup = voice.reason === 'creation-configuration-required' || voice.reason === 'reference-input-unsupported'
    ? 'creation' : voice.reason === 'synthesis-configuration-required' || voice.reason === 'configuration-incompatible' ? 'synthesis' : null;
  const run = async () => {
    const operationSession = session;
    setError(false);
    try { await session.appearance.useReferenceVoice!(); }
    catch { if (activeSessionRef.current === operationSession) setError(true); }
  };
  const cancel = async () => {
    const operationSession = session;
    try { await session.appearance.cancelReferenceVoice?.(); }
    catch { if (activeSessionRef.current === operationSession) setError(true); }
  };
  return <details className="group min-w-0" data-agent-center-reference-voice={voice.phase}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--nimi-radius-sm)] py-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-field-focus)] [&::-webkit-details-marker]:hidden">
      <span>{voice.phase === 'bound' ? t('sample', 'Current voice sample') : t('title', 'Create a voice from the character’s sample')}</span>
      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)] transition-transform group-open:rotate-180" />
    </summary>
    <div className="grid gap-3 pb-1 pt-2">
        {voice.previewUrl ? <audio controls preload="none" src={voice.previewUrl} aria-label={t('sample', 'Current voice sample')} className="h-10 w-full min-w-0" /> : null}
      {voice.phase === 'bound' ? <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-5 text-[var(--nimi-text-secondary)]">{t('bound', 'A voice is already selected for new speech.')}</p> : <>
        <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-5 text-[var(--nimi-text-secondary)]">{t('description', 'Create a reusable voice from this sample for future speech.')}</p>
        {voice.reason === 'reference-missing' ? <p className="m-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">{t('missing', 'This character has no available sound sample.')}</p> : null}
        {setup ? <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-5 text-[var(--nimi-text-secondary)]">{setup === 'creation'
          ? t('creationSetup', 'Configure a voice creation service that supports audio samples first.')
          : t('synthesisSetup', 'Match voice creation to shared speech settings. Changes to shared speech settings affect every Agent.')}</p> : null}
        {voice.reason === 'owner-unavailable' ? <InlineAlert tone="warning">{t('unavailable', 'The sample or configuration could not be read. Refresh to try again.')}</InlineAlert> : null}
        {(error || voice.phase === 'failed') ? <InlineAlert tone="danger">{voice.reason === 'binding-unconfirmed'
          ? t('unconfirmed', 'Could not confirm whether the voice was saved. Refresh first—the voice will not be cloned again.')
          : t('failed', 'Voice setup did not complete. Check the current voice or try again.')}</InlineAlert> : null}
        {voice.phase === 'canceled' ? <InlineAlert tone="neutral">{t('canceled', 'Voice setup canceled. The previous voice is retained.')}</InlineAlert> : null}
        <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-5 text-[var(--nimi-text-secondary)]">{t('cost', 'Voice creation and speech may incur provider charges.')}</p>
        <div className="flex flex-wrap gap-2">
          {setup ? <Button size="sm" tone="secondary" onClick={() => placementActions?.openReferenceVoiceSetup?.(setup)} disabled={busy || !placementActions?.openReferenceVoiceSetup}>{t('setup', 'Configure voice creation')}</Button> : voice.reason !== 'reference-missing' && voice.reason !== 'owner-unavailable' ? (
            <Button size="sm" tone="primary" disabled={blocked || busy || voice.phase === 'loading' || voice.phase === 'unavailable' || snapshot.availability.replaceAppearance.state !== 'available'} onClick={() => void run()}>
              {voice.phase === 'creating' ? t('creating', 'Creating voice…') : voice.phase === 'binding' ? t('binding', 'Saving voice…') : t('use', 'Create and use voice')}
            </Button>
          ) : null}
          {voice.phase === 'creating' ? <Button size="sm" tone="secondary" onClick={() => void cancel()}>{t('cancel', 'Cancel')}</Button> : null}
          {!busy ? <Button size="sm" tone="ghost" onClick={() => { setError(false); void session.refresh(); }}>{t('refresh', 'Refresh')}</Button> : null}
        </div>
      </>}
    </div>
  </details>;
}
