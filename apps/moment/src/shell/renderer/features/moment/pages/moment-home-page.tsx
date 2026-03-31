import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { createMomentSession, generateStoryOpening } from '@renderer/features/moment/moment-engine.js';
import { useMomentStore } from '@renderer/features/moment/moment-store.js';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('MOMENT_FILE_READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

export default function MomentHomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const runtimeProbe = useAppStore((state) => state.runtimeProbe);
  const runtimeStatus = useAppStore((state) => state.runtimeStatus);
  const preferences = useAppStore((state) => state.preferences);
  const setRouteSettingsOpen = useAppStore((state) => state.setRouteSettingsOpen);
  const seed = useMomentStore((state) => state.seed);
  const pending = useMomentStore((state) => state.pending);
  const error = useMomentStore((state) => state.error);
  const setSeed = useMomentStore((state) => state.setSeed);
  const setSession = useMomentStore((state) => state.setSession);
  const setPending = useMomentStore((state) => state.setPending);
  const setError = useMomentStore((state) => state.setError);

  const textTarget = useMemo(
    () => runtimeProbe.textTargets.find((target) => target.key === (preferences.textTargetKey || runtimeProbe.textDefaultTargetKey)) || null,
    [preferences.textTargetKey, runtimeProbe.textDefaultTargetKey, runtimeProbe.textTargets],
  );
  const visionTarget = useMemo(
    () => runtimeProbe.visionTargets.find((target) => target.key === (preferences.visionTargetKey || runtimeProbe.visionDefaultTargetKey)) || null,
    [preferences.visionTargetKey, runtimeProbe.visionDefaultTargetKey, runtimeProbe.visionTargets],
  );

  const canGeneratePhrase = Boolean(textTarget?.modelId);
  const canGenerateImage = Boolean(textTarget?.modelId && visionTarget?.modelId);
  const hasRuntimeIssues = runtimeStatus === 'degraded' || runtimeStatus === 'unavailable' || runtimeProbe.issues.length > 0;

  async function handleFileChange(file: File | null) {
    if (!file) {
      return;
    }
    const imageDataUrl = await readFileAsDataUrl(file);
    setSeed({
      mode: 'image',
      imageDataUrl,
      imageName: file.name,
      phrase: '',
    });
  }

  async function handleStart() {
    const normalizedPhrase = String(seed.phrase || '').trim();
    if (seed.mode === 'phrase' && !normalizedPhrase) {
      setError(t('moment.inputMissing'));
      return;
    }
    if (seed.mode === 'image' && !seed.imageDataUrl) {
      setError(t('moment.inputMissing'));
      return;
    }
    if (!textTarget?.modelId) {
      setError(t('moment.runtimeMissingText'));
      return;
    }
    if (seed.mode === 'image' && !visionTarget?.modelId) {
      setError(t('moment.runtimeMissingVision'));
      return;
    }

    setPending(true);
    setError(null);
    try {
      const { opening } = await generateStoryOpening({
        seed: {
          ...seed,
          phrase: normalizedPhrase,
        },
        textTarget,
        visionTarget: seed.mode === 'image' ? visionTarget || undefined : undefined,
      });
      const session = createMomentSession({
        seed: {
          ...seed,
          phrase: normalizedPhrase,
        },
        opening,
        textTarget,
        visionTarget: seed.mode === 'image' ? visionTarget || undefined : undefined,
      });
      setSession(session);
      navigate('/play');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPending(false);
    }
  }

  const imagePreview = seed.mode === 'image' && seed.imageDataUrl
    ? seed.imageDataUrl
    : '';

  return (
    <section className="moment-hero-card">
      <div className="moment-start-pane">
        <div className="moment-start-copy">
          <h1>{t('moment.startTitle')}</h1>
          <p>{t('moment.startSubtitle')}</p>
        </div>

        <div className="moment-mode-switch">
          <button
            type="button"
            className={seed.mode === 'image' ? 'is-active' : ''}
            onClick={() => setSeed({ mode: 'image', phrase: '' })}
          >
            {t('moment.imageTab')}
          </button>
          <button
            type="button"
            className={seed.mode === 'phrase' ? 'is-active' : ''}
            onClick={() => setSeed({ mode: 'phrase', imageDataUrl: '', imageName: '' })}
          >
            {t('moment.phraseTab')}
          </button>
        </div>

        {seed.mode === 'image' ? (
          <button
            type="button"
            className={`moment-drop-zone ${dragActive ? 'is-drag-active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void handleFileChange(event.dataTransfer.files?.[0] || null);
            }}
          >
            <div className="moment-drop-title">
              {seed.imageName ? t('moment.selectedImageTitle') : t('moment.dropTitle')}
            </div>
            <div className="moment-drop-copy">
              {seed.imageName
                ? seed.imageName
                : t('moment.dropExamples')}
            </div>
            <div className="moment-drop-hint">
              {seed.imageName ? t('moment.replaceImageHint') : t('moment.dropHint')}
            </div>
          </button>
        ) : (
          <label className="moment-phrase-field">
            <textarea
              value={seed.phrase || ''}
              onChange={(event) => setSeed({ phrase: event.target.value, mode: 'phrase' })}
              placeholder={t('moment.phrasePlaceholder')}
            />
          </label>
        )}

        {hasRuntimeIssues ? (
          <div className="moment-runtime-note">
            <div>
              <div className="moment-runtime-note-title">{t('moment.runtimeNoteTitle')}</div>
              <div className="moment-runtime-note-copy">
                {!textTarget?.modelId
                  ? t('moment.runtimeNoteMissingText')
                  : !visionTarget?.modelId && seed.mode === 'image'
                    ? t('moment.runtimeNoteMissingVision')
                    : t('moment.runtimeNoteIssues', { count: runtimeProbe.issues.length })}
              </div>
            </div>
            <Button tone="ghost" size="sm" onClick={() => setRouteSettingsOpen(true)}>
              {t('shell.settings')}
            </Button>
          </div>
        ) : null}

        <div className="moment-start-actions">
          <Button
            tone="primary"
            size="lg"
            onClick={() => void handleStart()}
            disabled={pending || (seed.mode === 'image' ? !canGenerateImage : !canGeneratePhrase)}
            className="moment-primary-action"
          >
            {pending ? t('moment.generating') : t('moment.startButton')}
          </Button>
        </div>

        {error ? <div className="moment-inline-error">{error}</div> : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            void handleFileChange(event.target.files?.[0] || null);
          }}
        />
      </div>

      <div className="moment-preview-pane">
        <div className="moment-scene-frame">
          {imagePreview ? (
            <img src={imagePreview} alt={t('moment.seedImageAlt')} className="moment-scene-image" />
          ) : (
            <div className="moment-scene-placeholder">
              <div className="moment-scene-glow" />
            </div>
          )}
          <div className="moment-scene-dots">
            <span className="is-primary" />
            <span />
            <span />
          </div>
        </div>

        <div className="moment-example">
          <div className="moment-example-label">{t('moment.exampleLabel')}</div>
          <div className="moment-example-title">{t('moment.exampleTitle')}</div>
          <div className="moment-example-subtitle">{t('moment.exampleSubtitle')}</div>
        </div>
      </div>
    </section>
  );
}
