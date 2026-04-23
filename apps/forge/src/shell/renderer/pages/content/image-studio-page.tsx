/**
 * Image Studio Page (FG-CONTENT-001)
 *
 * AI image generation with prompt builder, style presets, and staging gallery.
 * Supports entity context via URL search params for contextual generation.
 *
 * URL params:
 *   ?target=agent-avatar|agent-portrait|world-banner|world-icon|world-background|world-scene
 *   &agentId=...&agentName=...&worldId=...&worldName=...
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPlatformClient } from '@nimiplatform/sdk';
import { getResolvedAiParams } from '@renderer/hooks/use-ai-config.js';
import { useImageGeneration } from '@renderer/hooks/use-image-generation.js';
import type { ImageGenCandidate, ImageGenTarget, ImageGenEntityContext } from '@renderer/data/image-gen-client.js';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeEmptyState,
  ForgeErrorBanner,
} from '@renderer/components/page-layout.js';
import { LabeledTextareaField, LabeledSelectField, ToggleRow } from '@renderer/components/form-fields.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';

const STYLE_PRESETS = ['anime', 'realistic', 'painterly', 'pixel-art'] as const;
const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;
const TEMPLATES = [
  { id: 'cover', label: 'World Cover', target: 'world-banner' as ImageGenTarget },
  { id: 'background', label: 'World Background', target: 'world-background' as ImageGenTarget },
  { id: 'scene', label: 'World Scene', target: 'world-scene' as ImageGenTarget },
  { id: 'portrait', label: 'Character Portrait', target: 'agent-avatar' as ImageGenTarget },
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
    urlTarget === 'world-banner' || urlTarget === 'world-background' || urlTarget === 'world-scene'
      ? '16:9'
      : urlTarget === 'agent-portrait'
        ? '9:16'
        : '1:1',
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

  function toCandidate(image: GeneratedImage): ImageGenCandidate {
    return {
      id: image.id,
      url: image.url,
      prompt: image.prompt,
      negativePrompt: '',
      timestamp: image.timestamp,
    };
  }

  async function handleSaveToLibrary(image: GeneratedImage) {
    setSaveError(null);
    try {
      await imageGen.saveToLibrary(toCandidate(image));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function handleSendWorldCandidateToReview(
    image: GeneratedImage,
    family: 'world-icon' | 'world-cover' | 'world-background' | 'world-scene',
  ) {
    if (!urlWorldId) {
      return;
    }
    setSaveError(null);
    try {
      const result = family === 'world-cover'
        ? await imageGen.sendToWorldCoverReview(urlWorldId, toCandidate(image))
        : family === 'world-icon'
          ? await imageGen.sendToWorldIconReview(urlWorldId, toCandidate(image))
          : family === 'world-background'
            ? await imageGen.sendToWorldBackgroundReview(urlWorldId, toCandidate(image))
            : await imageGen.sendToWorldSceneReview(urlWorldId, toCandidate(image));
      navigate(`/worlds/${urlWorldId}/assets/${family}?candidateResourceId=${encodeURIComponent(result.resourceId)}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Review handoff failed');
    }
  }

  async function handleSendAgentAvatarCandidateToReview(image: GeneratedImage) {
    if (!urlAgentId) {
      return;
    }
    setSaveError(null);
    try {
      const result = await imageGen.sendToAgentAvatarReview(urlAgentId, toCandidate(image));
      navigate(`/agents/${urlAgentId}/assets/agent-avatar?candidateResourceId=${encodeURIComponent(result.resourceId)}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Review handoff failed');
    }
  }

  async function handleSendAgentCoverCandidateToReview(image: GeneratedImage) {
    if (!urlAgentId) {
      return;
    }
    setSaveError(null);
    try {
      const result = await imageGen.sendToAgentCoverReview(urlAgentId, toCandidate(image));
      navigate(`/agents/${urlAgentId}/assets/agent-cover?candidateResourceId=${encodeURIComponent(result.resourceId)}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Review handoff failed');
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <ForgeSection className="space-y-5 xl:col-span-1" material="glass-regular">
          <ForgeSectionHeading
            eyebrow={t('pages.imageStudio')}
            title={t('imageStudio.controls', 'Prompt Controls')}
            description={t('imageStudio.controlsDesc', 'Compose a prompt, choose ratio and style, then generate into the current staging gallery.')}
          />
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
            <Surface tone="card" material="glass-thin" padding="sm">
              <p className="text-[10px] uppercase tracking-wider text-[var(--nimi-text-muted)] mb-1">Composed Prompt</p>
              <p className="text-xs text-[var(--nimi-text-secondary)] line-clamp-4">{imageGen.composedPrompt}</p>
            </Surface>
          ) : null}
        </ForgeSection>

        <ForgeSection className="space-y-4 xl:col-span-2">
          <ForgeSectionHeading
            eyebrow={t('pages.imageStudio')}
            title={t('imageStudio.gallery', 'Gallery')}
            description={t('imageStudio.galleryDesc', 'Generated images stay local in the staging gallery until you save them into the content library or hand them off into the relevant review flow.')}
          />
          {(saveError || imageGen.error) && (
            <ForgeErrorBanner message={saveError || imageGen.error || ''} className="mb-3" />
          )}
          {gallery.length === 0 ? (
            <ForgeEmptyState message={t('imageStudio.emptyGallery', 'Generated images will appear here')} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {gallery.map((img) => (
                <Surface
                  key={img.id}
                  tone="card"
                  material="glass-thin"
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
                        <>
                          {(urlTarget === 'agent-avatar' || !urlTarget) ? (
                            <Button
                              tone="secondary"
                              size="sm"
                              onClick={() => void handleSendAgentAvatarCandidateToReview(img)}
                              disabled={imageGen.busy}
                            >
                              {t('imageStudio.sendToAvatarReview', 'Send to Avatar Review')}
                            </Button>
                          ) : null}
                          {(urlTarget === 'agent-portrait' || !urlTarget) ? (
                            <Button
                              tone="secondary"
                              size="sm"
                              onClick={() => void handleSendAgentCoverCandidateToReview(img)}
                              disabled={imageGen.busy}
                            >
                              {t('imageStudio.sendToCoverReviewAgent', 'Send to Cover Review')}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {urlWorldId ? (
                        <>
                          {(urlTarget === 'world-banner' || !urlTarget) ? (
                            <Button
                              tone="secondary"
                              size="sm"
                              onClick={() => void handleSendWorldCandidateToReview(img, 'world-cover')}
                              disabled={imageGen.busy}
                            >
                              {t('imageStudio.sendToCoverReview', 'Send to Cover Review')}
                            </Button>
                          ) : null}
                          {(urlTarget === 'world-icon' || !urlTarget) ? (
                            <Button
                              tone="secondary"
                              size="sm"
                              onClick={() => void handleSendWorldCandidateToReview(img, 'world-icon')}
                              disabled={imageGen.busy}
                            >
                              {t('imageStudio.sendToIconReview', 'Send to Icon Review')}
                            </Button>
                          ) : null}
                          {(urlTarget === 'world-background' || !urlTarget) ? (
                            <Button
                              tone="secondary"
                              size="sm"
                              onClick={() => void handleSendWorldCandidateToReview(img, 'world-background')}
                              disabled={imageGen.busy}
                            >
                              Send to Background Review
                            </Button>
                          ) : null}
                          {(urlTarget === 'world-scene' || !urlTarget) ? (
                            <Button
                              tone="secondary"
                              size="sm"
                              onClick={() => void handleSendWorldCandidateToReview(img, 'world-scene')}
                              disabled={imageGen.busy}
                            >
                              Send to Scene Review
                            </Button>
                          ) : null}
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
        </ForgeSection>
      </div>
    </ForgePage>
  );
}
