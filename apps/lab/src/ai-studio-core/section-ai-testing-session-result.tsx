import { useAIStudioHost } from './host-context.js';
import type { StudioFaceSwap, StudioTypedOutput } from './runtime-types.js';

type SessionOutput = Extract<StudioTypedOutput, { kind: 'session' }>;

// A Session summary records what was observed while it was open. It cannot
// restore the Session; running it again opens a new one.
export function SessionSummaryView({ output }: { readonly output: SessionOutput }) {
  const { translate: t } = useAIStudioHost();
  const started = new Date(output.startedAt);
  const ended = new Date(output.endedAt);
  const seconds = Math.max(0, (ended.valueOf() - started.valueOf()) / 1000);
  const counters = Object.entries(output.observed).filter(([, count]) => count > 0);
  return (
    <section className="studio-result__rich" aria-label={t('StudioResults.session.title')}>
      <p className="studio-result__plain">
        {t(output.ending === 'closed' ? 'StudioResults.session.closed' : 'StudioResults.session.terminated', {
          contract: output.capabilityContract,
          reason: output.terminalReason,
        })}
      </p>
      <dl className="studio-diag__grid">
        <div><dt>{t('StudioResults.session.started')}</dt><dd><time dateTime={output.startedAt}>{output.startedAt}</time></dd></div>
        <div><dt>{t('StudioResults.session.duration')}</dt><dd>{t('StudioResults.session.seconds', { seconds: seconds.toFixed(1) })}</dd></div>
        <div><dt>{t('StudioResults.session.terminalReason')}</dt><dd><code>{output.terminalReason}</code></dd></div>
      </dl>
      {counters.length > 0 ? (
        <ul className="studio-voice-list">
          {counters.map(([name, count]) => (
            <li key={name}><strong>{name}</strong><span>{count}</span></li>
          ))}
        </ul>
      ) : <p className="studio-result__hint">{t('StudioResults.session.nothingObserved')}</p>}
      <p className="studio-result__hint">{t('StudioResults.session.notRestorable')}</p>
    </section>
  );
}

export function FaceSwapNotice({ value }: { readonly value?: StudioFaceSwap }) {
  const { translate: t } = useAIStudioHost();
  if (!value) return null;
  return (
    <section className="space-y-2 text-sm" aria-label={t('StudioResults.faceSwap.inputs')}>
      <ul className="studio-voice-list">
        {value.inputs.map((input) => (
          <li key={input.role}>
            <strong>{t(`StudioResults.faceSwap.role.${input.role}`)}</strong>
            <span>{`${input.name} · ${input.mediaType} · ${input.sizeBytes} B · ${input.sha256.slice(0, 19)}…`}</span>
          </li>
        ))}
      </ul>
      {value.noFacePolicy ? <p>{t('StudioResults.faceSwap.policy', { policy: t(`StudioResults.faceSwap.policies.${value.noFacePolicy}`) })}</p> : null}
      {value.video ? (
        <p>{t('StudioResults.faceSwap.videoSummary', {
          total: value.video.totalFrames,
          transformed: value.video.transformedFrames,
          preserved: value.video.preservedFrames,
          seconds: (value.video.durationUs / 1_000_000).toFixed(2),
          fps: value.video.frameRate,
          audio: t(value.video.audioPreserved ? 'StudioResults.faceSwap.audioPreserved' : 'StudioResults.faceSwap.noAudio'),
        })}</p>
      ) : null}
      <p className="studio-result__hint">{t('StudioResults.faceSwap.rerunHint')}</p>
    </section>
  );
}
