/**
 * Music Studio Page (FG-CONTENT-006)
 *
 * AI music generation with prompt builder, lyrics editor, and audition queue.
 * Generation requires runtime AI client — stubbed until integration.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@runtime/platform-client.js';

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
  timestamp: number;
};

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
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const { runtime } = getPlatformClient();
      const result = await runtime.media.music.generate({
        model: 'auto',
        prompt: template ? `[${template}] ${prompt}` : prompt,
        title: title || undefined,
        lyrics: instrumental ? undefined : lyrics || undefined,
        style,
        durationSeconds: duration,
        instrumental,
      });
      const newTracks: GeneratedTrack[] = result.artifacts.map((a) => ({
        id: a.artifactId || crypto.randomUUID(),
        title: title || 'Untitled',
        prompt,
        style,
        duration,
        timestamp: Date.now(),
      }));
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
                <option value="">Custom</option>
                {MUSIC_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
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
                placeholder="Track title..."
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
                placeholder="Describe the mood and feel of the music..."
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
                  {instrumental ? 'Instrumental' : 'Vocal'}
                </button>
              </div>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={4}
                disabled={instrumental}
                placeholder={instrumental ? 'Instrumental mode — no lyrics needed' : 'Write or paste lyrics...'}
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
                        <button className="rounded bg-white px-3 py-1 text-xs font-medium text-black">
                          Save
                        </button>
                        <button
                          onClick={() => setTracks((t) => t.filter((i) => i.id !== track.id))}
                          className="rounded bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-400 hover:text-white"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                    {/* Waveform placeholder */}
                    <div className="mt-2 h-8 rounded bg-neutral-800 flex items-center justify-center">
                      <span className="text-[10px] text-neutral-600">Waveform preview</span>
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
