import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ArrowUpRight, Globe, MoreHorizontal, Pause, Play } from 'lucide-react';
import { PartnerArtwork } from '../agents/partner-media.js';
import type { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';

type Profile = Awaited<ReturnType<typeof resolveCurrentPartnerSource>>;

export function PartnerCardContent({ name, avatarUrl, profile, active, available, loading, failed, onRetry, onOpen, onWorld }: {
  name: string; avatarUrl?: string | null; profile?: Profile;
  active: boolean; available: boolean; loading: boolean; failed: boolean;
  onRetry: () => void; onOpen: (section?: 'cognition' | 'overview') => void; onWorld: () => void;
}) {
  const { t } = useTranslation();
  const topics = profile?.preview.topics?.slice(0, 2) ?? [];
  const role = profile?.preview.role?.trim();
  const summary = profile?.summary?.trim();
  // A short authored role is often the strongest introduction. Avoid repeating
  // the same role in a second, longer discovery summary.
  const introduction = role || summary;
  return <div className="partner-preview-layout" data-testid="partner-preview-content">
    <div className="partner-preview-art"><PartnerArtwork source={profile} avatarUrl={avatarUrl || undefined} name={name} /></div>
    <div className="partner-preview-copy">
      <details className="partner-preview-more">
        <summary aria-label={t('Chat.partnerCard.more')}><MoreHorizontal aria-hidden size={19} /></summary>
        <div className="partner-preview-menu">
          <button type="button" disabled={!available} onClick={() => onOpen('overview')}>{t('runtimeConfig.partners.settings')}</button>
          {failed ? <button type="button" onClick={onRetry}>{t('Common.retry')}</button> : null}
        </div>
      </details>
      <h3>{name}</h3>
      {profile?.preview.species ? <p className="partner-preview-identity">{profile.preview.species}</p> : null}
      {profile?.preview.voice ? <PartnerVoicePreview key={profile.preview.voice.url} voice={profile.preview.voice} active={active} /> : null}
      {introduction ? <p className="partner-preview-introduction">{introduction}</p> : null}
      {profile?.worldName ? <button type="button" onClick={onWorld} className="partner-preview-world">
        <Globe aria-hidden size={14} /><span>{profile.worldName}</span><ArrowUpRight aria-hidden size={13} />
      </button> : null}
      {topics.length ? <div className="partner-preview-topics"><span>{t('Chat.partnerCard.topics')}</span>
        <ul>{topics.map(topic => <li key={topic}>{topic}</li>)}</ul>
      </div> : null}
      {!available ? <p role="status" className="partner-preview-status">{t(loading ? 'Common.loading' : 'runtimeConfig.partners.unavailable')}</p> : null}
      {failed && !available ? <button type="button" className="partner-preview-retry" onClick={onRetry}>{t('Common.retry')}</button> : null}
      <div className="partner-preview-actions">
        <button type="button" disabled={!available} onClick={() => onOpen()}>{t('Chat.partnerCard.viewProfile')}<ArrowRight aria-hidden size={17} /></button>
        <button type="button" disabled={!available} onClick={() => onOpen('cognition')}>{t('Chat.partnerCard.memories')}</button>
      </div>
    </div>
  </div>;
}

export function PartnerVoicePreview({ voice, active }: { voice: NonNullable<Profile['preview']['voice']>; active: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const audio = ref.current;
    if (!active) { audio?.pause(); setPlaying(false); }
    return () => { audio?.pause(); };
  }, [active]);
  const label = t(playing ? 'Chat.partnerCard.pauseVoice' : 'Chat.partnerCard.listenVoice');
  return <div className="partner-preview-voice">
    <button type="button" aria-label={label} aria-pressed={playing} onClick={() => {
      const audio = ref.current;
      if (!audio || !active) return;
      setFailed(false);
      if (!audio.paused) audio.pause();
      else void audio.play().then(() => { if (!ref.current || !active) audio.pause(); }).catch(() => setFailed(true));
    }}>
      <span>{playing ? <Pause aria-hidden size={12} fill="currentColor" /> : <Play aria-hidden size={12} fill="currentColor" />}</span>
      {label}{voice.durationSec != null ? <small>· {t('Chat.partnerCard.voiceSeconds', { seconds: Math.round(voice.durationSec) })}</small> : null}
    </button>
    {failed ? <span role="status" className="partner-preview-status">{t('Chat.partnerCard.voiceFailed')}</span> : null}
    <audio ref={ref} src={voice.url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
  </div>;
}
