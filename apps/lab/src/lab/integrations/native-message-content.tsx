import { Button } from '@nimiplatform/kit/ui';
import { useTranslation } from '../../shell/i18n/index.js';
import type { NativeEvent } from './native-message-model.js';

// Text and mentions stay inline in supplied segment order; media retains its
// own action without adding line breaks inside an ordinary text message.
export function NativeMessageContent({ event, mediaDisabled, fetchMedia }: { event: NativeEvent; mediaDisabled: boolean; fetchMedia?: (mediaRef: string) => void }) {
  const { t } = useTranslation();
  return <div className="mt-2 whitespace-pre-wrap">{event.segments.map((segment, index) => segment.kind === 'text'
    ? <span key={index}>{segment.origin === 'platform-transcription' ? <span className="block text-xs">{t('Integrations.platformTranscription')}</span> : null}{segment.text}</span>
    : segment.kind === 'mention' ? <span key={index}>@{segment.displayName || segment.id}</span>
      : <div key={index} className="my-2 flex flex-wrap items-center gap-2"><span>{segment.fileName || segment.kind}</span><Button tone="secondary" size="sm" disabled={mediaDisabled || !fetchMedia} onClick={() => fetchMedia?.(segment.mediaRef || '')}>{t('Integrations.saveMedia')}</Button></div>)}</div>;
}

// @nimi-authority: rule.nimi.runtime.integration.media-handoff
export function NativeMessageReferences({ event, mediaDisabled = true, fetchMedia }: { event: NativeEvent; mediaDisabled?: boolean; fetchMedia?: (mediaRef: string) => void }) {
  const { t } = useTranslation();
  return <>{event.references?.map((reference, index) => <blockquote key={index} className="mt-3 border-l-2 border-[var(--nimi-border-subtle)] pl-3">
    <p className="font-medium">{t(reference.relation ? `Integrations.referenceRelation.${reference.relation}` : 'Integrations.quotedMessage')}</p>
    <p className="text-xs">{reference.messageId ? t('Integrations.referenceId', { id: reference.messageId }) : t('Integrations.referenceLocationMissing')}</p>
    {reference.title ? <p className="mt-1 whitespace-pre-wrap">{reference.title}</p> : null}
    {reference.origin === 'platform-transcription' ? <p className="mt-1 text-xs">{t('Integrations.platformTranscription')}</p> : null}
    {reference.text ? <p className="mt-1 whitespace-pre-wrap">{reference.text}</p> : null}
    {reference.contentStatus !== 'text-provided' ? <p className="mt-1 text-xs">{t(`Integrations.referenceContent.${reference.contentStatus}`)}</p> : null}
    {reference.media?.length ? reference.media.map((media, mediaIndex) => <div key={mediaIndex} className="my-2 flex flex-wrap items-center gap-2">
      <span>{media.fileName || media.kind}</span>
      {media.mediaRef ? <Button tone="secondary" size="sm" disabled={mediaDisabled || !fetchMedia} onClick={() => fetchMedia?.(media.mediaRef)}>{t('Integrations.saveReferenceMedia')}</Button>
        : <span className="text-xs">{t(`Integrations.referenceMediaReason.${media.unavailableReason}`)}</span>}
    </div>) : reference.mediaKind ? <p className="mt-1 text-xs">{reference.fileName || reference.mediaKind} · {t('Integrations.referenceMediaUnavailable')}</p> : null}
    {reference.partialText ? <details className="mt-1 text-xs"><summary>{t('Integrations.referenceSelection')}</summary><p className="whitespace-pre-wrap">{reference.partialText.start} … {reference.partialText.end}</p><p>{reference.partialText.startIndex}–{reference.partialText.endIndex}</p><p className="break-all">{reference.partialText.quoteMD5}</p></details> : null}
  </blockquote>)}</>;
}
