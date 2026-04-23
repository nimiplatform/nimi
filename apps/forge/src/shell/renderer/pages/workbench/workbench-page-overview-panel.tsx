import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEmptyState, ForgeErrorBanner, ForgeStatCard } from '@renderer/components/page-layout.js';
import { ForgeActionCard } from '@renderer/components/card-list.js';
import { LabeledTextField, LabeledTextareaField } from '@renderer/components/form-fields.js';
import { useImageGeneration } from '@renderer/hooks/use-image-generation.js';
import type { WorldDraftState } from '@renderer/features/workbench/types.js';
import { VISUAL_PHASE_LABELS, type WorkbenchPageSnapshot, type WorkbenchPanel } from './workbench-page-shared.js';

type WorkbenchPageOverviewPanelProps = {
  snapshot: WorkbenchPageSnapshot;
  imageGen: ReturnType<typeof useImageGeneration>;
  visualPrompt: string;
  onVisualPromptChange: (value: string) => void;
  onPatchWorldDraft: (patch: Partial<WorldDraftState>) => void;
  onOpenPanel: (panel: WorkbenchPanel) => void;
  onOpenCharacterCardImport: () => void;
  onOpenNovelImport: () => void;
  buildWorldImageContext: (target: 'world-banner' | 'world-icon') => Parameters<ReturnType<typeof useImageGeneration>['generate']>[0];
};

export function WorkbenchPageOverviewPanel({
  snapshot,
  imageGen,
  visualPrompt,
  onVisualPromptChange,
  onPatchWorldDraft,
  onOpenPanel,
  onOpenCharacterCardImport,
  onOpenNovelImport,
  buildWorldImageContext,
}: WorkbenchPageOverviewPanelProps) {
  return (
    <section className="mx-auto max-w-6xl p-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Surface tone="card" material="glass-regular" padding="md">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Workspace Overview</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <LabeledTextField
              label="World Name"
              value={snapshot.worldDraft.name}
              onChange={(value) => onPatchWorldDraft({ name: value })}
            />
            <LabeledTextField
              label="Tagline"
              value={snapshot.worldDraft.tagline}
              onChange={(value) => onPatchWorldDraft({ tagline: value })}
            />
            <LabeledTextField
              label="Source Type"
              value={snapshot.worldDraft.sourceType}
              readOnly
            />
          </div>
          <LabeledTextField
            label="Genre"
            value={snapshot.worldDraft.genre}
            onChange={(value) => onPatchWorldDraft({ genre: value })}
            className="mt-4"
          />
          <LabeledTextField
            label="Themes"
            value={snapshot.worldDraft.themes.join(', ')}
            onChange={(value) => onPatchWorldDraft({
              themes: value.split(',').map((item) => item.trim()).filter(Boolean),
            })}
            className="mt-4"
          />
          <LabeledTextField
            label="Era"
            value={snapshot.worldDraft.era}
            onChange={(value) => onPatchWorldDraft({ era: value })}
            className="mt-4"
          />
          <LabeledTextareaField
            label="Overview"
            value={snapshot.worldDraft.overview}
            onChange={(value) => onPatchWorldDraft({ overview: value })}
            rows={3}
            className="mt-4"
          />
          <LabeledTextareaField
            label="Description"
            value={snapshot.worldDraft.description}
            onChange={(value) => onPatchWorldDraft({ description: value })}
            rows={4}
            className="mt-4"
          />

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <ForgeStatCard label="World Rules" value={snapshot.reviewState.worldRules.length} />
            <ForgeStatCard label="Agent Bundles" value={snapshot.reviewState.agentBundles.length} />
            <ForgeStatCard label="Import Sessions" value={snapshot.importSessions.length} />
            <ForgeStatCard label="Conflicts" value={snapshot.reviewState.conflicts.length} />
          </div>
        </Surface>

        <Surface tone="card" material="glass-thin" padding="md">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Next Action</h2>
          <div className="mt-5 space-y-3">
            <ForgeActionCard title="Continue World Truth" onClick={() => onOpenPanel('WORLD_TRUTH')} />
            <ForgeActionCard title="Run Enrichment" onClick={() => onOpenPanel('ENRICHMENT')} />
            <ForgeActionCard title="Import Character Card" onClick={onOpenCharacterCardImport} />
            <ForgeActionCard title="Import Novel" onClick={onOpenNovelImport} />
            <ForgeActionCard title="Review Truth Draft" onClick={() => onOpenPanel('REVIEW')} />
          </div>
        </Surface>
      </div>

      <Surface tone="card" material="glass-regular" padding="md" className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">World Visuals</h2>
          <div className="flex gap-2">
            <Button
              tone="primary"
              size="sm"
              onClick={() => void imageGen.generate(buildWorldImageContext('world-banner'))}
              disabled={imageGen.busy}
            >
              {imageGen.busy ? (VISUAL_PHASE_LABELS[imageGen.phase] || imageGen.phase) : 'Generate Banner'}
            </Button>
            <Button
              tone="secondary"
              size="sm"
              onClick={() => void imageGen.generate(buildWorldImageContext('world-icon'))}
              disabled={imageGen.busy}
            >
              Generate Icon
            </Button>
          </div>
        </div>

        <div className="mt-3">
          <LabeledTextField
            label=""
            value={visualPrompt}
            onChange={onVisualPromptChange}
            placeholder="Additional prompt instructions (optional)..."
          />
        </div>

        {imageGen.error ? (
          <div className="mt-3">
            <ForgeErrorBanner message={imageGen.error} />
            <Button tone="ghost" size="sm" onClick={imageGen.clearError} className="mt-1 text-xs text-[var(--nimi-status-danger)]">
              Dismiss
            </Button>
          </div>
        ) : null}

        {imageGen.candidates.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {imageGen.candidates.map((candidate) => (
              <div
                key={candidate.id}
                className="group relative overflow-hidden rounded-[var(--nimi-radius-card)] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_45%,transparent)]"
              >
                <img src={candidate.url} alt="" className="aspect-video w-full object-cover" />
                <div className="absolute inset-0 flex items-end bg-black/60 p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex w-full gap-1.5">
                    {snapshot.worldDraft.worldId ? (
                      <>
                        <Button
                          tone="primary"
                          size="sm"
                          onClick={() => void imageGen.useAsWorldBanner(snapshot.worldDraft.worldId!, candidate)}
                          disabled={imageGen.busy}
                          className="flex-1"
                        >
                          Set as Banner
                        </Button>
                        <Button
                          tone="secondary"
                          size="sm"
                          onClick={() => void imageGen.useAsWorldIcon(snapshot.worldDraft.worldId!, candidate)}
                          disabled={imageGen.busy}
                          className="flex-1"
                        >
                          Set as Icon
                        </Button>
                      </>
                    ) : null}
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => void imageGen.saveToLibrary(candidate)}
                      disabled={imageGen.busy}
                    >
                      Save
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => imageGen.removeCandidate(candidate.id)}
                    >
                      &times;
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!snapshot.worldDraft.worldId && imageGen.candidates.length > 0 ? (
          <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
            Publish the world first to bind images as banner or icon.
          </p>
        ) : null}
      </Surface>
    </section>
  );
}
