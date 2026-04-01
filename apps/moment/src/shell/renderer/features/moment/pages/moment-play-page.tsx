import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { MOMENT_MAX_BEATS, continueMoment, deriveMomentPlayState, deriveMomentRelationState } from '@renderer/features/moment/moment-engine.js';
import { useMomentStore } from '@renderer/features/moment/moment-store.js';

export default function MomentPlayPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useMomentStore((state) => state.session);
  const pending = useMomentStore((state) => state.pending);
  const error = useMomentStore((state) => state.error);
  const setSession = useMomentStore((state) => state.setSession);
  const setPending = useMomentStore((state) => state.setPending);
  const setError = useMomentStore((state) => state.setError);
  const clearSeed = useMomentStore((state) => state.clearSeed);
  const runtimeProbe = useAppStore((state) => state.runtimeProbe);
  const preferences = useAppStore((state) => state.preferences);
  const [draftLine, setDraftLine] = useState('');

  const textTarget = useMemo(
    () => runtimeProbe.textTargets.find((target) => target.key === (preferences.textTargetKey || runtimeProbe.textDefaultTargetKey)) || null,
    [preferences.textTargetKey, runtimeProbe.textDefaultTargetKey, runtimeProbe.textTargets],
  );

  if (!session) {
    return <Navigate to="/" replace />;
  }

  const activeSession = session;
  const isSealed = activeSession.sealed;
  const isInSealingWindow = !isSealed && activeSession.playState === 'sealing';
  const canContinue = !isSealed && activeSession.beatIndex < MOMENT_MAX_BEATS;

  async function handleContinue() {
    if (!canContinue) {
      return;
    }
    const line = String(draftLine || '').trim();
    if (!line) {
      setError(t('moment.inputMissing'));
      return;
    }
    if (!textTarget?.modelId) {
      setError(t('moment.runtimeMissingPlay'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const beat = await continueMoment({
        session: activeSession,
        userLine: line,
        textTarget,
      });
      const nextTurns = [...activeSession.turns, beat];
      const nextBeatIndex = nextTurns.length;
      const sealed = nextBeatIndex >= MOMENT_MAX_BEATS;
      const nextSession = {
        ...activeSession,
        turns: nextTurns,
        beatIndex: nextBeatIndex,
        relationState: beat.relationState,
        playState: deriveMomentPlayState(nextBeatIndex, sealed),
        sealed,
        ...(sealed ? { sealedAt: new Date().toISOString() } : {}),
      };
      setSession({
        ...nextSession,
      });
      setDraftLine('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPending(false);
    }
  }

  const latestActions = activeSession.turns.at(-1)?.actions || activeSession.opening.actions;

  function handleSealMoment() {
    if (activeSession.sealed) {
      return;
    }
    setSession({
      ...activeSession,
      relationState: deriveMomentRelationState(activeSession),
      playState: 'sealed',
      sealed: true,
      sealedAt: new Date().toISOString(),
    });
  }

  function handleRestartMoment() {
    clearSeed();
    setSession(null);
    navigate('/');
  }

  return (
    <section className="moment-play-card">
      <div className="moment-play-visual">
        <div className="moment-scene-frame moment-scene-frame-play">
          {activeSession.seed.mode === 'image' && activeSession.seed.imageDataUrl ? (
            <img src={activeSession.seed.imageDataUrl} alt={t('moment.seedImageAlt')} className="moment-scene-image" />
          ) : (
            <div className="moment-scene-placeholder moment-scene-placeholder-text">
              <div className="moment-text-seed-card">{activeSession.seed.phrase}</div>
            </div>
          )}
          <div className="moment-scene-dots">
            <span className="is-primary" />
            <span />
            <span />
          </div>
        </div>

        <div className="moment-play-reset">
          <Button
            tone="primary"
            size="lg"
            onClick={handleRestartMoment}
            className="moment-restart-action"
          >
            {t('moment.restartButton')}
          </Button>
        </div>
      </div>

      <div className="moment-play-copy">
        <div className="moment-opening-section">
          <div className="moment-opening-eyebrow">{t('moment.openingEyebrow')}</div>
          <h1 className="moment-opening-title">{activeSession.opening.title}</h1>
          <p className="moment-opening-body">{activeSession.opening.opening}</p>
        </div>

        {activeSession.turns.length > 0 ? (
          <div className="moment-history-section">
            <div className="moment-history-title">{t('moment.historyTitle')}</div>
            <div className="moment-history">
              {activeSession.turns.map((turn) => (
                <div key={`${turn.traceId || turn.storyBeat.slice(0, 12)}-${turn.userLine.slice(0, 8)}`} className="moment-history-entry">
                  <div className="moment-history-user">{turn.userLine}</div>
                  <div className="moment-history-story">{turn.storyBeat}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="moment-actions">
          {!isSealed ? (
            <>
              <div className="moment-actions-title">{isInSealingWindow ? t('moment.actionsTitleSealing') : t('moment.actionsTitle')}</div>
              <div className="moment-action-list">
                {latestActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="moment-action-chip"
                    onClick={() => setDraftLine(action)}
                  >
                    {action}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="moment-sealed-note">{t('moment.sealedNote')}</div>
          )}
        </div>
      </div>

      {!isSealed ? (
        <div className="moment-play-composer">
          <div className="moment-composer-label">{isInSealingWindow ? t('moment.customLineLabelSealing') : t('moment.customLineLabel')}</div>
          <div className="moment-composer-row">
            <input
              value={draftLine}
              onChange={(event) => setDraftLine(event.target.value)}
              placeholder={t('moment.customLinePlaceholder')}
              className="moment-composer-input"
            />
            <Button
              tone="primary"
              size="lg"
              onClick={() => void handleContinue()}
              disabled={pending || !canContinue}
              className="moment-primary-action"
            >
              {pending ? t('moment.continuing') : isInSealingWindow ? t('moment.oneMoreStepButton') : t('moment.continueButton')}
            </Button>
          </div>
          <div className="moment-play-footer">
            {isInSealingWindow ? (
              <Button
                tone="ghost"
                size="md"
                onClick={handleSealMoment}
                className="moment-stop-here-action"
              >
                {t('moment.stopHereButton')}
              </Button>
            ) : null}
            {error ? <div className="moment-inline-error">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
