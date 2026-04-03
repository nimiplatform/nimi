/**
 * Image Studio Page (FG-CONTENT-001)
 *
 * AI image generation with prompt builder, style presets, and staging gallery.
 * Supports entity context via URL search params for contextual generation.
 *
 * URL params:
 *   ?target=agent-avatar|agent-portrait|world-banner|world-icon
 *   &agentId=...&agentName=...&worldId=...&worldName=...
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useContentMutations } from '@renderer/hooks/use-content-mutations.js';
import { type JsonObject } from '@renderer/bridge/types.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { getResolvedAiParams } from '@renderer/hooks/use-ai-config.js';
import { useImageGeneration } from '@renderer/hooks/use-image-generation.js';
import type { ImageGenTarget, ImageGenEntityContext } from '@renderer/data/image-gen-client.js';

const STYLE_PRESETS = ['anime', 'realistic', 'painterly', 'pixel-art'] as const;
const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;
const TEMPLATES = [
  { id: 'cover', label: 'World Cover', target: 'world-banner' as ImageGenTarget },
  { id: 'portrait', label: 'Character Portrait', target: 'agent-avatar' as ImageGenTarget },
  { id: 'scene', label: 'Scene Illustration', target: 'custom' as ImageGenTarget },
  { id: 'item', label: 'Item / Object', target: 'custom' as ImageGenTarget },
  { id: 'environment', label: 'Environment', target: 'custom' as ImageGenTarget },
] as const;

type GeneratedImage = {
  id: string;
  url: string;
  prompt: string;
  style: string;
  ratio: string;
  timestamp: number;
};

const PHASE_LABELS: Record<string, string> = {
  composing_prompt: 'Composing prompt...',
  generating: 'Generating...',
  uploading: 'Uploading...',
  binding: 'Binding...',
};

export default function ImageStudioPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const mutations = useContentMutations();
  const imageGen = useImageGeneration();

  // Entity context from URL params
  const urlTarget = searchParams.get('target') as ImageGenTarget | null;
  const urlAgentId = searchParams.get('agentId') || '';
  const urlAgentName = searchParams.get('agentName') || '';
  const urlWorldId = searchParams.get('worldId') || '';
  const urlWorldName = searchParams.get('worldName') || '';
  const hasEntityContext = Boolean(urlTarget);

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [style, setStyle] = useState<(typeof STYLE_PRESETS)[number]>('anime');
  const [ratio, setRatio] = useState<(typeof ASPECT_RATIOS)[number]>(
    urlTarget === 'world-banner' ? '16:9' : urlTarget === 'agent-portrait' ? '9:16' : '1:1',
  );
  const [template, setTemplate] = useState(urlTarget ? (TEMPLATES.find((t) => t.target === urlTarget)?.id || '') : '');
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [useAiPrompt, setUseAiPrompt] = useState(hasEntityContext);

  async function handleGenerate() {
    if (!prompt.trim() && !useAiPrompt) return;
    if (useAiPrompt) {
      // Two-stage AI-assisted generation via prompt engine
      const selectedTemplate = TEMPLATES.find((t) => t.id === template);
      const target: ImageGenTarget = selectedTemplate?.target || urlTarget || 'custom';
      const ctx: ImageGenEntityContext = {
        target,
        agentName: urlAgentName || undefined,
        worldName: urlWorldName || undefined,
        userPrompt: prompt.trim() || undefined,
        style,
        aspectRatio: ratio,
      };
      try {
        const result = await imageGen.generate(ctx);
        const newImages: GeneratedImage[] = result.candidates.map((c) => ({
          id: c.id,
          url: c.url,
          prompt: result.composedPrompt,
          style,
          ratio,
          timestamp: c.timestamp,
        }));
        setGallery((prev) => [...newImages, ...prev]);
      } catch {
        // Error handled by imageGen.error state
      }
      return;
    }

    // Direct generation (original mode)
    setGenerating(true);
    try {
      const { runtime } = getPlatformClient();
      const imageParams = getResolvedAiParams('image');
      const result = await runtime.media.image.generate({
        model: imageParams.model,
        connectorId: imageParams.connectorId,
        route: imageParams.route,
        prompt: template ? `[${template}] ${prompt}` : prompt,
        negativePrompt: negativePrompt || undefined,
        aspectRatio: ratio,
        style,
        n: 1,
        responseFormat: 'url',
      });
      const newImages: GeneratedImage[] = result.artifacts.map((a) => {
        let imageUrl = a.uri || '';
        if (!imageUrl && a.bytes && a.bytes.length > 0) {
          const b64 = btoa(String.fromCharCode(...a.bytes));
          imageUrl = `data:${a.mimeType || 'image/png'};base64,${b64}`;
        }
        return {
          id: a.artifactId || crypto.randomUUID(),
          url: imageUrl,
          prompt,
          style,
          ratio,
          timestamp: Date.now(),
        };
      });
      setGallery((prev) => [...newImages, ...prev]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSaveToLibrary(image: GeneratedImage) {
    setSaveError(null);
    try {
      const result = await mutations.imageUploadMutation.mutateAsync(undefined);
      const record: JsonObject = result && typeof result === 'object' && !Array.isArray(result)
        ? result as JsonObject
        : {};
      const uploadUrl = String(record.uploadUrl || '');

      if (!uploadUrl) {
        throw new Error('No upload URL returned from server');
      }

      // Fetch the image blob from the local object URL or data URL
      const response = await fetch(image.url);
      const blob = await response.blob();

      // Upload to Cloudflare via FormData (fallback to PUT)
      const formData = new FormData();
      formData.append('file', blob, `${image.id}.png`);
      let uploadResponse = await fetch(uploadUrl, { method: 'POST', body: formData });
      if (!uploadResponse.ok) {
        uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': blob.type || 'image/png' },
        });
      }

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }

      // Remove from gallery after successful save
      setGallery((g) => g.filter((i) => i.id !== image.id));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  const busy = generating || imageGen.busy;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">{t('pages.imageStudio')}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {hasEntityContext
              ? t('imageStudio.subtitleEntity', 'Generate images for {{name}}', {
                name: urlAgentName || urlWorldName || 'entity',
              })
              : t('imageStudio.subtitle', 'Generate AI images for your worlds and agents')}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Left: Controls */}
          <div className="col-span-1 space-y-5">
            {/* AI Prompt Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-xs text-neutral-400">
                {t('imageStudio.aiPrompt', 'AI-Assisted Prompt')}
              </label>
              <button
                onClick={() => setUseAiPrompt((v) => !v)}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  useAiPrompt ? 'bg-white' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform ${
                    useAiPrompt ? 'translate-x-4 bg-black' : 'translate-x-0.5 bg-neutral-400'
                  }`}
                />
              </button>
            </div>

            {/* Template */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('imageStudio.template', 'Template')}
              </label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none"
              >
                <option value="">{t('imageStudio.customPrompt', 'Custom Prompt')}</option>
                {TEMPLATES.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>{t(`imageStudio.template${tmpl.id.charAt(0).toUpperCase()}${tmpl.id.slice(1)}`, tmpl.label)}</option>
                ))}
              </select>
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {useAiPrompt
                  ? t('imageStudio.promptAi', 'Additional Instructions')
                  : t('imageStudio.prompt', 'Prompt')}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder={useAiPrompt
                  ? t('imageStudio.promptAiPlaceholder', 'Optional: describe specific details to include...')
                  : t('imageStudio.promptPlaceholder', 'Describe the image you want to generate...')}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
              />
            </div>

            {/* Negative prompt (direct mode only) */}
            {!useAiPrompt ? (
              <div>
                <label className="block text-xs text-neutral-400 mb-1.5">
                  {t('imageStudio.negativePrompt', 'Negative Prompt')}
                </label>
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={2}
                  placeholder={t('imageStudio.negativePromptPlaceholder', 'Things to avoid...')}
                  className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
                />
              </div>
            ) : null}

            {/* Style */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('imageStudio.style', 'Style')}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {STYLE_PRESETS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
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

            {/* Aspect ratio */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">
                {t('imageStudio.aspectRatio', 'Aspect Ratio')}
              </label>
              <div className="flex gap-1.5">
                {ASPECT_RATIOS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRatio(r)}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      ratio === r
                        ? 'bg-white text-black'
                        : 'bg-neutral-800 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate */}
            <button
              onClick={() => void handleGenerate()}
              disabled={busy || (!prompt.trim() && !useAiPrompt)}
              className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {busy
                ? (useAiPrompt && imageGen.phase !== 'idle'
                    ? PHASE_LABELS[imageGen.phase] || imageGen.phase
                    : t('imageStudio.generating', 'Generating...'))
                : t('imageStudio.generate', 'Generate Image')}
            </button>

            {/* Composed prompt preview (AI mode) */}
            {useAiPrompt && imageGen.composedPrompt ? (
              <div className="rounded border border-neutral-800 bg-neutral-900/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Composed Prompt</p>
                <p className="text-xs text-neutral-400 line-clamp-4">{imageGen.composedPrompt}</p>
              </div>
            ) : null}

          </div>

          {/* Right: Gallery */}
          <div className="col-span-2">
            {(saveError || imageGen.error) && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 mb-3">
                <p className="text-xs text-red-400">{saveError || imageGen.error}</p>
              </div>
            )}
            <h3 className="text-sm font-semibold text-white mb-3">
              {t('imageStudio.gallery', 'Gallery')}
              {gallery.length > 0 && (
                <span className="ml-2 text-xs font-normal text-neutral-500">
                  ({gallery.length})
                </span>
              )}
            </h3>
            {gallery.length === 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 flex items-center justify-center h-96">
                <div className="text-center">
                  <div className="text-4xl text-neutral-700 mb-2">🎨</div>
                  <p className="text-sm text-neutral-500">
                    {t('imageStudio.emptyGallery', 'Generated images will appear here')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {gallery.map((img) => (
                  <div
                    key={img.id}
                    className="group relative rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden"
                  >
                    <img src={img.url} alt="" className="w-full aspect-square object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => void handleSaveToLibrary(img)}
                          className="rounded bg-white px-3 py-1 text-xs font-medium text-black"
                        >
                          {t('imageStudio.save', 'Save')}
                        </button>
                        {urlAgentId ? (
                          <button
                            onClick={() => void imageGen.useAsAgentAvatar(urlAgentId, {
                              id: img.id,
                              url: img.url,
                              prompt: img.prompt,
                              negativePrompt: '',
                              timestamp: img.timestamp,
                            })}
                            disabled={imageGen.busy}
                            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {t('imageStudio.useAsAvatar', 'Use as Avatar')}
                          </button>
                        ) : null}
                        {urlWorldId ? (
                          <>
                            <button
                              onClick={() => void imageGen.useAsWorldBanner(urlWorldId, {
                                id: img.id,
                                url: img.url,
                                prompt: img.prompt,
                                negativePrompt: '',
                                timestamp: img.timestamp,
                              })}
                              disabled={imageGen.busy}
                              className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              {t('imageStudio.useAsBanner', 'Set as Banner')}
                            </button>
                            <button
                              onClick={() => void imageGen.useAsWorldIcon(urlWorldId, {
                                id: img.id,
                                url: img.url,
                                prompt: img.prompt,
                                negativePrompt: '',
                                timestamp: img.timestamp,
                              })}
                              disabled={imageGen.busy}
                              className="rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              {t('imageStudio.useAsIcon', 'Set as Icon')}
                            </button>
                          </>
                        ) : null}
                        <button
                          onClick={() => setGallery((g) => g.filter((i) => i.id !== img.id))}
                          className="rounded bg-neutral-700 px-3 py-1 text-xs font-medium text-white"
                        >
                          {t('imageStudio.delete', 'Delete')}
                        </button>
                      </div>
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
