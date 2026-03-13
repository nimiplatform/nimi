/**
 * Image Studio Page (FG-CONTENT-001)
 *
 * AI image generation with prompt builder, style presets, and staging gallery.
 * Generation requires runtime AI client — stubbed until integration.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContentMutations } from '@renderer/hooks/use-content-mutations.js';
import { getPlatformClient } from '@runtime/platform-client.js';

const STYLE_PRESETS = ['anime', 'realistic', 'painterly', 'pixel-art'] as const;
const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;
const TEMPLATES = [
  { id: 'cover', label: 'World Cover' },
  { id: 'portrait', label: 'Character Portrait' },
  { id: 'scene', label: 'Scene Illustration' },
  { id: 'item', label: 'Item / Object' },
  { id: 'environment', label: 'Environment' },
] as const;

type GeneratedImage = {
  id: string;
  url: string;
  prompt: string;
  style: string;
  ratio: string;
  timestamp: number;
};

export default function ImageStudioPage() {
  const { t } = useTranslation();
  const mutations = useContentMutations();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [style, setStyle] = useState<(typeof STYLE_PRESETS)[number]>('anime');
  const [ratio, setRatio] = useState<(typeof ASPECT_RATIOS)[number]>('1:1');
  const [template, setTemplate] = useState('');
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const { runtime } = getPlatformClient();
      const result = await runtime.media.image.generate({
        model: 'auto',
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
      const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
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

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">{t('pages.imageStudio')}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {t('imageStudio.subtitle', 'Generate AI images for your worlds and agents')}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Left: Controls */}
          <div className="col-span-1 space-y-5">
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
                {t('imageStudio.prompt', 'Prompt')}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder={t('imageStudio.promptPlaceholder', 'Describe the image you want to generate...')}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
              />
            </div>

            {/* Negative prompt */}
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
              disabled={generating || !prompt.trim()}
              className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {generating
                ? t('imageStudio.generating', 'Generating...')
                : t('imageStudio.generate', 'Generate Image')}
            </button>

          </div>

          {/* Right: Gallery */}
          <div className="col-span-2">
            {saveError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 mb-3">
                <p className="text-xs text-red-400">{saveError}</p>
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
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleSaveToLibrary(img)}
                          className="rounded bg-white px-3 py-1 text-xs font-medium text-black"
                        >
                          {t('imageStudio.save', 'Save')}
                        </button>
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
