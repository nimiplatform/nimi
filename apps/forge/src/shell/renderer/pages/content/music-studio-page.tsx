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
import { finalizeMediaAsset } from '@renderer/data/content-data-client.js';

const MUSIC_TEMPLATES = [
  { id: 'opening', label: 'Opening Theme' },
  { id: 'character', label: 'Character Song' },
  { id: 'battle', label: 'Battle Track' },
  { id: 'ambient', label: 'Ambient Loop' },
  { id: 'trailer', label: 'Trailer Music' },
] as const;

const MUSIC_STYLES = ['pop', 'orchestral', 'electronic', 'folk', 'cinematic', 'lo-fi'] as const;
const DURATIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
] as const;

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
      const assetId = String(record.assetId || '');

      if (!uploadUrl || !assetId) {
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

      await finalizeMediaAsset(assetId, {
        mimeType: track.mimeType || audioBlob.type || 'audio/mpeg',
        durationSec: track.duration,
        title: track.title,
        style: track.style,
        lyricsSource: instrumental ? undefined : lyrics || undefined,
        instrumental,
      });

      const audioPostInput = {
        caption: track.title || track.prompt,
        media: [
          {
            type: 'AUDIO',
            assetId,
            duration: track.duration,
          },
        ],
        tags: [track.style],
      } as unknown as Parameters<typeof createPostMutation.mutateAsync>[0];

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
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">{t('pages.musicStudio')}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {t('musicStudio.subtitle', 'Generate AI music for your worlds and characters')}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Left: Composer */}
          <div className="col-span-1 space-y-5">
            {/* Template */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('musicStudio.template', 'Template')}
              </label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none"
              >
                <option value="">{t('musicStudio.customTemplate', 'Custom')}</option>
                {MUSIC_TEMPLATES.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>{t(`musicStudio.template${tmpl.id.charAt(0).toUpperCase()}${tmpl.id.slice(1)}`, tmpl.label)}</option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('musicStudio.title', 'Title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('musicStudio.titlePlaceholder', 'Track title...')}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
              />
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('musicStudio.prompt', 'Prompt')}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={t('musicStudio.promptPlaceholder', 'Describe the mood and feel of the music...')}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
              />
            </div>

            {/* Lyrics */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-neutral-400">
                  {t('musicStudio.lyrics', 'Lyrics')}
                </label>
                <button
                  onClick={() => setInstrumental(!instrumental)}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    instrumental
                      ? 'bg-white text-black'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {instrumental ? t('musicStudio.instrumental', 'Instrumental') : t('musicStudio.vocal', 'Vocal')}
                </button>
              </div>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={4}
                disabled={instrumental}
                placeholder={instrumental ? t('musicStudio.instrumentalPlaceholder', 'Instrumental mode — no lyrics needed') : t('musicStudio.lyricsPlaceholder', 'Write or paste lyrics...')}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none disabled:opacity-50"
              />
            </div>

            {/* Style */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('musicStudio.style', 'Style')}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {MUSIC_STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                      style === s
                        ? 'bg-white text-black'
                        : 'bg-neutral-800 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('musicStudio.duration', 'Duration')}
              </label>
              <div className="flex gap-1.5">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      duration === d.value
                        ? 'bg-white text-black'
                        : 'bg-neutral-800 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate */}
            <button
              onClick={() => void handleGenerate()}
              disabled={generating || !prompt.trim()}
              className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {generating
                ? t('musicStudio.generating', 'Generating...')
                : t('musicStudio.generate', 'Generate Track')}
            </button>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* Right: Audition Queue */}
          <div className="col-span-2">
            <h3 className="text-sm font-semibold text-white mb-3">
              {t('musicStudio.auditionQueue', 'Audition Queue')}
              {tracks.length > 0 && (
                <span className="ml-2 text-xs font-normal text-neutral-500">
                  ({tracks.length})
                </span>
              )}
            </h3>
            {tracks.length === 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 flex items-center justify-center h-96">
                <div className="text-center">
                  <div className="text-4xl text-neutral-700 mb-2">🎵</div>
                  <p className="text-sm text-neutral-500">
                    {t('musicStudio.emptyQueue', 'Generated tracks will appear here')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">{track.title || 'Untitled'}</p>
                        <p className="text-xs text-neutral-500">
                          {track.style} · {track.duration}s · {new Date(track.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleSaveTrack(track.id)}
                          disabled={savingTrackId === track.id}
                          className="rounded bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
                        >
                          {savingTrackId === track.id ? t('musicStudio.saving', 'Saving...') : t('musicStudio.save', 'Save')}
                        </button>
                        <button
                          onClick={() => removeTrack(track.id)}
                          className="rounded bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-400 hover:text-white"
                        >
                          {t('musicStudio.discard', 'Discard')}
                        </button>
                      </div>
                    </div>
                    {/* Waveform placeholder */}
                    <div className="mt-2 h-8 rounded bg-neutral-800 flex items-center justify-center">
                      <span className="text-[10px] text-neutral-600">{t('musicStudio.waveformPreview', 'Waveform preview')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
