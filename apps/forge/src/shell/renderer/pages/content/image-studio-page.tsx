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
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState, ForgeErrorBanner } from '@renderer/components/page-layout.js';
import { LabeledTextareaField, LabeledSelectField, ToggleRow } from '@renderer/components/form-fields.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';

const STYLE_PRESETS = ['anime', 'realistic', 'painterly', 'pixel-art'] as const;
const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;
const TEMPLATES = [
  { id: 'cover', label: 'World Cover', target: 'world-banner' as ImageGenTarget },
  { id: 'portrait', label: 'Character Portrait', target: 'agent-avatar' as ImageGenTarget },
  { id: 'scene', label: 'Scene Illustration', target: 'custom' as ImageGenTarget },
  { id: 'item', label: 'Item / Object', target: 'custom' as ImageGenTarget },
  { id: 'environment', label: 'Environment', target: 'custom' as ImageGenTarget },
] as const;

const TEMPLATE_OPTIONS = [
  { value: '', label: 'Custom Prompt' },
  ...TEMPLATES.map((tmpl) => ({ value: tmpl.id, label: tmpl.label })),
];

const STYLE_OPTIONS = STYLE_PRESETS.map((s) => ({ value: s, label: s }));
const RATIO_OPTIONS = ASPECT_RATIOS.map((r) => ({ value: r, label: r }));

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
    <ForgePage maxWidth="max-w-5xl">
      <ForgePageHeader
        title={t('pages.imageStudio')}
        subtitle={
          hasEntityContext
            ? t('imageStudio.subtitleEntity', 'Generate images for {{name}}', {
              name: urlAgentName || urlWorldName || 'entity',
            })
            : t('imageStudio.subtitle', 'Generate AI images for your worlds and agents')
        }
      />

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Controls */}
        <div className="col-span-1 space-y-5">
          {/* AI Prompt Toggle */}
          <ToggleRow
            label={t('imageStudio.aiPrompt', 'AI-Assisted Prompt')}
            checked={useAiPrompt}
            onChange={setUseAiPrompt}
          />

          {/* Template */}
          <LabeledSelectField
            label={t('imageStudio.template', 'Template')}
            value={template}
            options={TEMPLATE_OPTIONS}
            onChange={setTemplate}
          />

          {/* Prompt */}
          <LabeledTextareaField
            label={
              useAiPrompt
                ? t('imageStudio.promptAi', 'Additional Instructions')
                : t('imageStudio.prompt', 'Prompt')
            }
            value={prompt}
            onChange={setPrompt}
            rows={4}
            placeholder={
              useAiPrompt
                ? t('imageStudio.promptAiPlaceholder', 'Optional: describe specific details to include...')
                : t('imageStudio.promptPlaceholder', 'Describe the image you want to generate...')
            }
          />

          {/* Negative prompt (direct mode only) */}
          {!useAiPrompt ? (
            <LabeledTextareaField
              label={t('imageStudio.negativePrompt', 'Negative Prompt')}
              value={negativePrompt}
              onChange={setNegativePrompt}
              rows={2}
              placeholder={t('imageStudio.negativePromptPlaceholder', 'Things to avoid...')}
            />
          ) : null}

          {/* Style */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
              {t('imageStudio.style', 'Style')}
            </label>
            <ForgeSegmentControl
              options={STYLE_OPTIONS}
              value={style}
              onChange={setStyle}
              className="grid grid-cols-2"
            />
          </div>

          {/* Aspect ratio */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
              {t('imageStudio.aspectRatio', 'Aspect Ratio')}
            </label>
            <ForgeSegmentControl
              options={RATIO_OPTIONS}
              value={ratio}
              onChange={setRatio}
            />
          </div>

          {/* Generate */}
          <Button
            tone="primary"
            size="md"
            fullWidth
            onClick={() => void handleGenerate()}
            disabled={busy || (!prompt.trim() && !useAiPrompt)}
          >
            {busy
              ? (useAiPrompt && imageGen.phase !== 'idle'
                  ? PHASE_LABELS[imageGen.phase] || imageGen.phase
                  : t('imageStudio.generating', 'Generating...'))
              : t('imageStudio.generate', 'Generate Image')}
          </Button>

          {/* Composed prompt preview (AI mode) */}
          {useAiPrompt && imageGen.composedPrompt ? (
            <Surface tone="card" padding="sm">
              <p className="text-[10px] uppercase tracking-wider text-[var(--nimi-text-muted)] mb-1">Composed Prompt</p>
              <p className="text-xs text-[var(--nimi-text-secondary)] line-clamp-4">{imageGen.composedPrompt}</p>
            </Surface>
          ) : null}

        </div>

        {/* Right: Gallery */}
        <div className="col-span-2">
          {(saveError || imageGen.error) && (
            <ForgeErrorBanner message={saveError || imageGen.error || ''} className="mb-3" />
          )}
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)] mb-3">
            {t('imageStudio.gallery', 'Gallery')}
            {gallery.length > 0 && (
              <span className="ml-2 text-xs font-normal text-[var(--nimi-text-muted)]">
                ({gallery.length})
              </span>
            )}
          </h3>
          {gallery.length === 0 ? (
            <ForgeEmptyState message={t('imageStudio.emptyGallery', 'Generated images will appear here')} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {gallery.map((img) => (
                <Surface
                  key={img.id}
                  tone="card"
                  padding="none"
                  className="group relative overflow-hidden"
                >
                  <img src={img.url} alt="" className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-[var(--nimi-surface-overlay)] opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        tone="primary"
                        size="sm"
                        onClick={() => void handleSaveToLibrary(img)}
                      >
                        {t('imageStudio.save', 'Save')}
                      </Button>
                      {urlAgentId ? (
                        <Button
                          tone="secondary"
                          size="sm"
                          onClick={() => void imageGen.useAsAgentAvatar(urlAgentId, {
                            id: img.id,
                            url: img.url,
                            prompt: img.prompt,
                            negativePrompt: '',
                            timestamp: img.timestamp,
                          })}
                          disabled={imageGen.busy}
                        >
                          {t('imageStudio.useAsAvatar', 'Use as Avatar')}
                        </Button>
                      ) : null}
                      {urlWorldId ? (
                        <>
                          <Button
                            tone="secondary"
                            size="sm"
                            onClick={() => void imageGen.useAsWorldBanner(urlWorldId, {
                              id: img.id,
                              url: img.url,
                              prompt: img.prompt,
                              negativePrompt: '',
                              timestamp: img.timestamp,
                            })}
                            disabled={imageGen.busy}
                          >
                            {t('imageStudio.useAsBanner', 'Set as Banner')}
                          </Button>
                          <Button
                            tone="secondary"
                            size="sm"
                            onClick={() => void imageGen.useAsWorldIcon(urlWorldId, {
                              id: img.id,
                              url: img.url,
                              prompt: img.prompt,
                              negativePrompt: '',
                              timestamp: img.timestamp,
                            })}
                            disabled={imageGen.busy}
                          >
                            {t('imageStudio.useAsIcon', 'Set as Icon')}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => setGallery((g) => g.filter((i) => i.id !== img.id))}
                      >
                        {t('imageStudio.delete', 'Delete')}
                      </Button>
                    </div>
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
