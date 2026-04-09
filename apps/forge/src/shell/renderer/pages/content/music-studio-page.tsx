/**
 * Music Studio Page (FG-CONTENT-006)
 *
 * AI music generation with prompt builder, lyrics editor, and audition queue.
 * Generation requires runtime AI client — stubbed until integration.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import { getResolvedAiParams } from '@renderer/hooks/use-ai-config.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import { useContentMutations } from '@renderer/hooks/use-content-mutations.js';
import { finalizeResource } from '@renderer/data/content-data-client.js';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState, ForgeErrorBanner } from '@renderer/components/page-layout.js';
import { LabeledTextField, LabeledTextareaField, LabeledSelectField, ToggleRow } from '@renderer/components/form-fields.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';

const MUSIC_TEMPLATES = [
  { id: 'opening', label: 'Opening Theme' },
  { id: 'character', label: 'Character Song' },
  { id: 'battle', label: 'Battle Track' },
  { id: 'ambient', label: 'Ambient Loop' },
  { id: 'trailer', label: 'Trailer Music' },
] as const;

const TEMPLATE_OPTIONS = [
  { value: '', label: 'Custom' },
  ...MUSIC_TEMPLATES.map((tmpl) => ({ value: tmpl.id, label: tmpl.label })),
];

const MUSIC_STYLES = ['pop', 'orchestral', 'electronic', 'folk', 'cinematic', 'lo-fi'] as const;
const STYLE_OPTIONS = MUSIC_STYLES.map((s) => ({ value: s, label: s }));

const DURATIONS = [
  { value: '30', label: '30s' },
  { value: '60', label: '1 min' },
  { value: '120', label: '2 min' },
] as const;
const DURATION_OPTIONS = DURATIONS.map((d) => ({ value: d.value, label: d.label }));

type GeneratedTrack = {
  id: string;
  title: string;
  prompt: string;
  style: string;
  duration: number;
  audioUrl: string;
  mimeType: string;
  timestamp: number;
};

function revokeObjectUrl(url: string) {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export default function MusicStudioPage() {
  const { t } = useTranslation();

  const [template, setTemplate] = useState('');
  const [prompt, setPrompt] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [style, setStyle] = useState<(typeof MUSIC_STYLES)[number]>('cinematic');
  const [duration, setDuration] = useState(60);
  const [instrumental, setInstrumental] = useState(false);
  const [title, setTitle] = useState('');
  const [tracks, setTracks] = useState<GeneratedTrack[]>([]);
  const [generating, setGenerating] = useState(false);
  const [savingTrackId, setSavingTrackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { audioUploadMutation, createPostMutation } = useContentMutations();
  const trackUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    trackUrlsRef.current = tracks.map((track) => track.audioUrl);
  }, [tracks]);

  useEffect(() => () => {
    trackUrlsRef.current.forEach((url) => revokeObjectUrl(url));
  }, []);

  function removeTrack(trackId: string) {
    setTracks((prev) => {
      const track = prev.find((item) => item.id === trackId);
      if (track) {
        revokeObjectUrl(track.audioUrl);
      }
      return prev.filter((item) => item.id !== trackId);
    });
  }

  async function handleSaveTrack(trackId: string) {
    setSavingTrackId(trackId);
    setError(null);
    try {
      const track = tracks.find((item) => item.id === trackId);
      if (!track) {
        throw new Error('Track not found');
      }

      const upload = await audioUploadMutation.mutateAsync({
        mimeType: track.mimeType,
        filename: `${track.title || track.id}.${track.mimeType === 'audio/wav' ? 'wav' : track.mimeType === 'audio/flac' ? 'flac' : track.mimeType === 'audio/ogg' ? 'ogg' : 'mp3'}`,
        title: track.title,
        style: track.style,
        lyricsSource: lyrics || undefined,
        instrumental,
      });
      const record: JsonObject = upload && typeof upload === 'object' && !Array.isArray(upload)
        ? upload as JsonObject
        : {};
      const uploadUrl = String(record.uploadUrl || '');
      const resourceId = String(record.resourceId || '');

      if (!uploadUrl || !resourceId) {
        throw new Error('Audio upload credentials are incomplete');
      }

      const sourceResponse = await fetch(track.audioUrl);
      const audioBlob = await sourceResponse.blob();
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: audioBlob,
        headers: {
          'Content-Type': track.mimeType || audioBlob.type || 'audio/mpeg',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }

      await finalizeResource(resourceId, {
        mimeType: track.mimeType || audioBlob.type || 'audio/mpeg',
        durationSec: track.duration,
        title: track.title,
        style: track.style,
        lyricsSource: instrumental ? undefined : lyrics || undefined,
        instrumental,
      });

      const audioPostInput = {
        caption: track.title || track.prompt,
        attachments: [
          {
            targetType: 'RESOURCE',
            targetId: resourceId,
          },
        ],
        tags: [track.style],
      } as Parameters<typeof createPostMutation.mutateAsync>[0];

      await createPostMutation.mutateAsync(audioPostInput);

      removeTrack(trackId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingTrackId(null);
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const { runtime } = getPlatformClient();
      const musicParams = getResolvedAiParams('music');
      const result = await runtime.media.music.generate({
        model: musicParams.model,
        connectorId: musicParams.connectorId,
        route: musicParams.route,
        prompt: template ? `[${template}] ${prompt}` : prompt,
        title: title || undefined,
        lyrics: instrumental ? undefined : lyrics || undefined,
        style,
        durationSeconds: duration,
        instrumental,
      });
      const createdUrls: string[] = [];
      const newTracks: GeneratedTrack[] = [];
      try {
        for (const artifact of result.artifacts) {
          let audioUrl = artifact.uri || '';
          const mimeType = artifact.mimeType || 'audio/mpeg';
          if (!audioUrl && artifact.bytes && artifact.bytes.length > 0) {
            const audioBytes = Uint8Array.from(artifact.bytes);
            audioUrl = URL.createObjectURL(new Blob([audioBytes], { type: mimeType }));
            createdUrls.push(audioUrl);
          }
          if (!audioUrl) {
            throw new Error('Generated track is missing playable audio data');
          }

          newTracks.push({
            id: artifact.artifactId || crypto.randomUUID(),
            title: title || 'Untitled',
            prompt,
            style,
            duration: artifact.durationMs ? Math.max(1, Math.round(Number(artifact.durationMs) / 1000)) : duration,
            audioUrl,
            mimeType,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        createdUrls.forEach((url) => revokeObjectUrl(url));
        throw err;
      }
      setTracks((prev) => [...newTracks, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <ForgePage maxWidth="max-w-5xl">
      <ForgePageHeader
        title={t('pages.musicStudio')}
        subtitle={t('musicStudio.subtitle', 'Generate AI music for your worlds and characters')}
      />

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Composer */}
        <div className="col-span-1 space-y-5">
          {/* Template */}
          <LabeledSelectField
            label={t('musicStudio.template', 'Template')}
            value={template}
            options={TEMPLATE_OPTIONS}
            onChange={setTemplate}
          />

          {/* Title */}
          <LabeledTextField
            label={t('musicStudio.title', 'Title')}
            value={title}
            onChange={setTitle}
            placeholder={t('musicStudio.titlePlaceholder', 'Track title...')}
          />

          {/* Prompt */}
          <LabeledTextareaField
            label={t('musicStudio.prompt', 'Prompt')}
            value={prompt}
            onChange={setPrompt}
            rows={3}
            placeholder={t('musicStudio.promptPlaceholder', 'Describe the mood and feel of the music...')}
          />

          {/* Lyrics / Instrumental toggle */}
          <div>
            <ToggleRow
              label={t('musicStudio.instrumental', 'Instrumental')}
              description={instrumental
                ? t('musicStudio.instrumentalHint', 'No lyrics needed')
                : t('musicStudio.vocalHint', 'Vocal mode — add lyrics below')}
              checked={instrumental}
              onChange={setInstrumental}
            />
            <LabeledTextareaField
              label={t('musicStudio.lyrics', 'Lyrics')}
              value={lyrics}
              onChange={setLyrics}
              rows={4}
              placeholder={instrumental
                ? t('musicStudio.instrumentalPlaceholder', 'Instrumental mode — no lyrics needed')
                : t('musicStudio.lyricsPlaceholder', 'Write or paste lyrics...')}
            />
          </div>

          {/* Style */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
              {t('musicStudio.style', 'Style')}
            </label>
            <ForgeSegmentControl
              options={STYLE_OPTIONS}
              value={style}
              onChange={setStyle}
              className="grid grid-cols-3"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
              {t('musicStudio.duration', 'Duration')}
            </label>
            <ForgeSegmentControl
              options={DURATION_OPTIONS}
              value={String(duration)}
              onChange={(v) => setDuration(Number(v))}
            />
          </div>

          {/* Generate */}
          <Button
            tone="primary"
            size="md"
            fullWidth
            onClick={() => void handleGenerate()}
            disabled={generating || !prompt.trim()}
          >
            {generating
              ? t('musicStudio.generating', 'Generating...')
              : t('musicStudio.generate', 'Generate Track')}
          </Button>

          {error && (
            <ForgeErrorBanner message={error} />
          )}
        </div>

        {/* Right: Audition Queue */}
        <div className="col-span-2">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)] mb-3">
            {t('musicStudio.auditionQueue', 'Audition Queue')}
            {tracks.length > 0 && (
              <span className="ml-2 text-xs font-normal text-[var(--nimi-text-muted)]">
                ({tracks.length})
              </span>
            )}
          </h3>
          {tracks.length === 0 ? (
            <ForgeEmptyState message={t('musicStudio.emptyQueue', 'Generated tracks will appear here')} />
          ) : (
            <div className="space-y-2">
              {tracks.map((track) => (
                <Surface
                  key={track.id}
                  tone="card"
                  padding="sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{track.title || 'Untitled'}</p>
                      <p className="text-xs text-[var(--nimi-text-muted)]">
                        {track.style} · {track.duration}s · {new Date(track.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        tone="primary"
                        size="sm"
                        onClick={() => void handleSaveTrack(track.id)}
                        disabled={savingTrackId === track.id}
                      >
                        {savingTrackId === track.id ? t('musicStudio.saving', 'Saving...') : t('musicStudio.save', 'Save')}
                      </Button>
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => removeTrack(track.id)}
                      >
                        {t('musicStudio.discard', 'Discard')}
                      </Button>
                    </div>
                  </div>
                  {/* Waveform placeholder */}
                  <div className="mt-2 h-8 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-canvas)] flex items-center justify-center">
                    <span className="text-[10px] text-[var(--nimi-text-muted)]">{t('musicStudio.waveformPreview', 'Waveform preview')}</span>
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </div>
      </div>
    </ForgePage>
  );
}
