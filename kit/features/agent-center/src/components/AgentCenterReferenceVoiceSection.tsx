import { useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { translateAgentCenter } from '../i18n.js';
import type { AgentCenterAppearanceSectionProps } from './AgentCenterAppearanceSection.js';

export function AgentCenterReferenceVoiceSection({ session, snapshot, i18n, placementActions }: AgentCenterAppearanceSectionProps) {
  const voice = snapshot.state.appearance.referenceVoice;
  const [error, setError] = useState(false);
  if (!voice || !session.appearance.useReferenceVoice) return null;
  const t = (key: string, fallback: string) => translateAgentCenter(i18n, `AgentCenter.referenceVoice.${key}`, fallback);
  const busy = voice.phase === 'creating' || voice.phase === 'binding';
  const setup = voice.reason === 'creation-configuration-required' || voice.reason === 'reference-input-unsupported'
    ? 'creation' : voice.reason === 'synthesis-configuration-required' || voice.reason === 'configuration-incompatible' ? 'synthesis' : null;
  const run = async () => {
    setError(false);
    try { await session.appearance.useReferenceVoice!(); }
    catch { setError(true); }
  };
  return <div className="grid gap-2 border-t border-[var(--nimi-border-subtle)] pt-3" data-agent-center-reference-voice={voice.phase}>
    <h4 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold">{t('title', 'Use this character’s voice')}</h4>
    <p className="m-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{t('description', 'Clone the character’s current sound sample once, then reuse the saved voice for new lines. An opening line can be the sample.')}</p>
    {voice.sampleUrl ? <audio controls preload="none" src={voice.sampleUrl} aria-label={t('sample', 'Current voice sample')} className="w-full" /> : null}
    {voice.phase === 'bound' ? <InlineAlert tone="success">{t('bound', 'A voice is already bound. New speech uses the saved voice.')}</InlineAlert> : <>
      <p className="m-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{t('cost', 'Voice creation and later speech may incur provider charges. Text chat remains available without voice setup.')}</p>
      {voice.reason === 'reference-missing' ? <InlineAlert tone="neutral">{t('missing', 'This character has no available sound sample.')}</InlineAlert> : null}
      {setup ? <InlineAlert tone="warning">{setup === 'creation'
        ? t('creationSetup', 'Configure reference-audio voice creation for this App first.')
        : t('synthesisSetup', 'Voice creation must match the shared speech configuration. Changing shared speech settings affects every Agent.')}</InlineAlert> : null}
      {voice.reason === 'owner-unavailable' ? <InlineAlert tone="warning">{t('unavailable', 'The current reference or configuration could not be read. Refresh to try again.')}</InlineAlert> : null}
      {(error || voice.phase === 'failed') ? <InlineAlert tone="danger">{voice.reason === 'binding-unconfirmed'
        ? t('unconfirmed', 'The save result is not confirmed. Refresh before trying again; the voice will not be cloned again.')
        : t('failed', 'Voice setup did not complete. Check the current voice or try again.')}</InlineAlert> : null}
      {voice.phase === 'canceled' ? <InlineAlert tone="neutral">{t('canceled', 'Voice setup canceled. The previous voice is retained.')}</InlineAlert> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" tone="primary" disabled={busy || voice.phase === 'loading' || voice.phase === 'unavailable' || snapshot.availability.replaceAppearance.state !== 'available'} onClick={() => void run()}>
          {voice.phase === 'creating' ? t('creating', 'Creating voice…') : voice.phase === 'binding' ? t('binding', 'Saving voice…') : t('use', 'Use this voice')}
        </Button>
        {voice.phase === 'creating' ? <Button size="sm" tone="secondary" onClick={() => void session.appearance.cancelReferenceVoice?.().catch(() => setError(true))}>{t('cancel', 'Cancel')}</Button> : null}
        {setup ? <Button size="sm" tone="secondary" onClick={() => placementActions?.openReferenceVoiceSetup?.(setup)} disabled={!placementActions?.openReferenceVoiceSetup}>{t('setup', 'Open configuration')}</Button> : null}
        {!busy ? <Button size="sm" tone="ghost" onClick={() => { setError(false); void session.refresh(); }}>{t('refresh', 'Refresh')}</Button> : null}
      </div>
    </>}
  </div>;
}
