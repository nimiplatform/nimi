import { useEffect, useRef, useState, type RefObject } from 'react';
import { AppCardSurface, Button, IconButton, NimiText, ScrollShell, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  Check,
  Code2,
  Copy,
  X,
} from 'lucide-react';
import {
  COLOR_TOKENS,
  RECIPES,
  SCALE_TOKENS,
  TYPE_ROLES,
  type CategoryId,
  type Recipe,
} from './kit-component-gallery-recipes.js';

export function countFor(category: CategoryId): number {
  if (category === 'foundations') return COLOR_TOKENS.length + TYPE_ROLES.length + SCALE_TOKENS.length;
  return RECIPES.filter((recipe) => recipe.category === category).length;
}

const fallbackAccessChecks = [
  'Use the exported Kit primitive instead of app-local visual copies.',
  'Preserve caller-owned labels, names, and state instead of hiding them behind local wrappers.',
  'Do not treat this recipe as Runtime or Realm readiness evidence.',
];

function fallbackTokenFootprint(recipe: Recipe): NonNullable<Recipe['tokenFootprint']> {
  return [
    { token: '--nimi-text-primary', role: `${recipe.exportsLabel} text color`, source: 'tables/nimi-ui-tokens.yaml' },
    { token: '--nimi-border-subtle', role: `${recipe.exportsLabel} boundary treatment`, source: 'tables/nimi-ui-tokens.yaml' },
    { token: '--nimi-surface-card', role: `${recipe.exportsLabel} host surface`, source: 'tables/nimi-ui-themes.yaml' },
  ];
}

function recipeAccessChecks(recipe: Recipe): string[] {
  return recipe.accessChecks ?? fallbackAccessChecks;
}

function recipeTokenFootprint(recipe: Recipe): NonNullable<Recipe['tokenFootprint']> {
  return recipe.tokenFootprint ?? fallbackTokenFootprint(recipe);
}

function recipeImportBlock(recipe: Recipe): string {
  return [
    `import {\n  ${recipe.importNames.join(',\n  ')}\n} from '@nimiplatform/kit/ui';`,
    ...(recipe.extraImports ?? []),
  ].join('\n');
}

function recipeCopyText(recipe: Recipe): string {
  return `${recipeImportBlock(recipe)}\n\n${recipe.snippet}`;
}

function copyTextToClipboard(text: string) {
  if (typeof navigator === 'undefined') return;
  void navigator.clipboard?.writeText(text);
}

function RecipePreview({ recipe, compact = false }: { recipe: Recipe; compact?: boolean }) {
  return (
    <div
      className={[
        'kit-recipe-preview grid min-w-0 place-items-center overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)]',
        'bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)_1px,transparent_0)] bg-[length:18px_18px]',
        compact ? 'min-h-36 h-full p-4' : 'min-h-64 p-7',
      ].join(' ')}
      data-recipe-preview={recipe.id}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-3">
        {recipe.stage}
      </div>
    </div>
  );
}

function RecipeTile({
  recipe,
  active,
  onInspect,
}: {
  recipe: Recipe;
  active: boolean;
  onInspect: () => void;
}) {
  return (
    <AppCardSurface
      as="article"
      kind="operational-solid"
      active={active}
      className="kit-recipe-tile grid h-full min-w-0 grid-rows-[auto_minmax(9rem,1fr)] gap-4 p-4 min-[1700px]:grid-cols-[minmax(0,1fr)_184px]"
    >
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <strong className="min-w-0 truncate text-base">{recipe.name}</strong>
          <Button
            tone="secondary"
            size="sm"
            active={active}
            aria-pressed={active}
            leadingIcon={<Code2 size={14} strokeWidth={2.2} aria-hidden="true" />}
            aria-label={`Inspect ${recipe.name}`}
            className="kit-recipe-inspect-action min-h-10 rounded-full border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_44%,var(--nimi-border-strong))] bg-[var(--nimi-surface-card)] px-4 text-[var(--nimi-text-primary)] shadow-[0_10px_22px_rgba(15,23,42,0.10)] hover:border-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] hover:shadow-[0_12px_26px_rgba(44,184,154,0.18)] data-[active]:border-[var(--nimi-action-primary-bg)] data-[active]:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,var(--nimi-surface-card))] data-[active]:text-[var(--nimi-text-primary)]"
            onClick={onInspect}
          >
            Inspect
          </Button>
        </div>
      </div>
      <RecipePreview recipe={recipe} compact />
    </AppCardSurface>
  );
}

function RecipeInspector({
  recipe,
  onClose,
  panelRef,
}: {
  recipe: Recipe;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const importBlock = recipeImportBlock(recipe);
  const checks = recipeAccessChecks(recipe);
  const tokenFootprint = recipeTokenFootprint(recipe);
  return (
    <div ref={panelRef} className="min-w-0">
      <Surface
        as="aside"
        material="glass-regular"
        tone="panel"
        elevation="floating"
        padding="none"
        className="kit-doc__inspector sticky top-0 grid max-h-[calc(100vh-2rem)] min-w-0 content-start gap-5 overflow-y-auto rounded-3xl p-5"
        aria-label={`${recipe.name} Recipe Inspector`}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <p className="m-0 text-[10px] font-bold uppercase tracking-wider text-[var(--nimi-text-muted)]">Recipe Inspector</p>
            <h3 className="m-0 truncate text-xl font-bold">{recipe.name}</h3>
          </div>
          <IconButton
            type="button"
            aria-label="Close recipe inspector"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]"
            onClick={onClose}
            icon={<X size={18} strokeWidth={2.2} aria-hidden="true" />}
          />
        </div>

        <div className="h-px bg-[var(--nimi-border-subtle)]" />

        <section className="grid min-w-0 gap-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="m-0 text-sm font-bold">Use</h4>
            <IconButton
              tone="ghost"
              size="sm"
              aria-label="Copy recipe imports"
              icon={<Copy size={14} aria-hidden="true" />}
              onClick={() => copyTextToClipboard(importBlock)}
            />
          </div>
          <ScrollShell className="max-h-44 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
            <pre className="m-0 whitespace-pre-wrap text-[11px] leading-5 text-[var(--nimi-text-secondary)]">{importBlock}</pre>
          </ScrollShell>
        </section>

        <div className="h-px bg-[var(--nimi-border-subtle)]" />

        <section className="grid min-w-0 gap-3">
          <h4 className="m-0 text-sm font-bold">Key props</h4>
          <div className="overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)]">
            {recipe.props.map((row) => (
              <div key={row.name} className="grid grid-cols-[112px_minmax(0,1fr)] border-b border-[color-mix(in_srgb,var(--nimi-text-primary)_7%,transparent)] last:border-b-0">
                <b className="bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] p-3 text-[11px]">{row.name}</b>
                <span className="p-3 text-[11px] leading-5 text-[var(--nimi-text-secondary)]">{row.desc}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="h-px bg-[var(--nimi-border-subtle)]" />

        <section className="grid min-w-0 gap-3">
          <h4 className="m-0 text-sm font-bold">Access</h4>
          <div className="grid gap-3">
            {checks.map((rule) => (
              <div key={rule} className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-3 text-xs leading-5 text-[var(--nimi-text-secondary)]">
                <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]">
                  <Check size={12} aria-hidden="true" />
                </span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="h-px bg-[var(--nimi-border-subtle)]" />

        <section className="grid min-w-0 gap-3">
          <h4 className="m-0 text-sm font-bold">Design tokens</h4>
          <div className="flex min-w-0 flex-wrap gap-2">
            {tokenFootprint.map((row) => (
              <code key={`${row.token}-${row.role}`} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-info-soft-bg)_72%,var(--nimi-surface-card))] px-3 py-2 text-[11px] text-[var(--nimi-text-secondary)]">
                {row.token}
              </code>
            ))}
          </div>
        </section>

        <Button tone="primary" fullWidth leadingIcon={<Copy size={15} aria-hidden="true" />} onClick={() => copyTextToClipboard(recipeCopyText(recipe))}>
          Copy selected recipe
        </Button>
      </Surface>
    </div>
  );
}

export function RecipeWorkspace({ recipes }: { recipes: Recipe[] }) {
  const [selectedRecipeId, setSelectedRecipeId] = useState(recipes[0]?.id ?? '');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorPanelRef = useRef<HTMLDivElement | null>(null);
  const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId) ?? recipes[0];

  useEffect(() => {
    if (!inspectorOpen || typeof document === 'undefined') return;
    function closeInspectorOnOutsideMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (inspectorPanelRef.current?.contains(target)) return;
      setInspectorOpen(false);
    }
    document.addEventListener('mousedown', closeInspectorOnOutsideMouseDown);
    return () => document.removeEventListener('mousedown', closeInspectorOnOutsideMouseDown);
  }, [inspectorOpen]);

  if (!selectedRecipe) return null;

  function closeInspector() {
    setInspectorOpen(false);
  }

  function inspectRecipe(recipe: Recipe) {
    setSelectedRecipeId(recipe.id);
    setInspectorOpen(true);
  }

  return (
    <div className={inspectorOpen ? 'kit-recipe-workspace grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]' : 'kit-recipe-workspace grid min-w-0 gap-5'}>
      <div className="grid min-w-0 content-start gap-4">
        <div className={inspectorOpen ? 'grid min-w-0 items-stretch gap-4 2xl:grid-cols-2' : 'grid min-w-0 items-stretch gap-4 lg:grid-cols-2'}>
          {recipes.map((recipe) => (
            <RecipeTile
              key={recipe.id}
              recipe={recipe}
              active={recipe.id === selectedRecipe.id}
              onInspect={() => inspectRecipe(recipe)}
            />
          ))}
        </div>
      </div>

      {inspectorOpen ? (
        <RecipeInspector
          recipe={selectedRecipe}
          onClose={closeInspector}
          panelRef={inspectorPanelRef}
        />
      ) : null}
    </div>
  );
}

export function FoundationsCanvas() {
  return (
    <div className="kit-foundations grid min-w-0 grid-cols-2 gap-4 overflow-hidden max-[980px]:grid-cols-1">
      {/* Color roles */}
      <Surface className="kit-found-card grid min-w-0 overflow-hidden content-start gap-4 p-5" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <strong className="text-base">Color roles</strong>
          </div>
          <StatusBadge tone="success" shape="soft">Theme-aware</StatusBadge>
        </div>
        <div className="kit-token-grid grid grid-cols-3 gap-3 max-[520px]:grid-cols-2">
          {COLOR_TOKENS.map((entry) => (
            <div key={entry.token} className="kit-token grid min-w-0 gap-1.5">
              <span
                className="kit-token__chip block h-14 rounded-xl border border-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)]"
                style={{ background: `var(${entry.token})` }}
                aria-hidden="true"
              />
              <b className="block truncate text-xs">{entry.label}</b>
            </div>
          ))}
        </div>
      </Surface>

      {/* Text roles */}
      <Surface className="kit-found-card grid min-w-0 overflow-hidden content-start gap-4 p-5" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <strong className="text-base">Text roles</strong>
          </div>
          <StatusBadge tone="info" shape="soft">NimiText</StatusBadge>
        </div>
        <div className="kit-type-stack grid gap-3">
          {TYPE_ROLES.map((entry) => (
            <div key={entry.role} className="kit-type-row flex min-w-0 overflow-hidden border-b border-[color-mix(in_srgb,var(--nimi-text-primary)_7%,transparent)] pb-2 last:border-b-0 last:pb-0">
              <NimiText role={entry.role} className="min-w-0 break-words">{entry.sample}</NimiText>
            </div>
          ))}
        </div>
      </Surface>

      {/* Corner radius */}
      <Surface className="kit-found-card col-span-2 grid min-w-0 overflow-hidden content-start gap-4 p-5 max-[980px]:col-span-1" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head grid gap-1">
          <strong className="text-base">Corner radius</strong>
        </div>
        <div className="kit-scale-row flex flex-wrap items-end gap-5">
          {SCALE_TOKENS.map((entry) => (
            <div key={entry.token} className="grid justify-items-center gap-2">
              <span
                className="kit-scale-chip grid h-16 w-16 place-items-center border border-[var(--nimi-border-strong)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]"
                style={{ borderRadius: `var(${entry.token})` }}
                aria-hidden="true"
              />
              <b className="text-xs">{entry.label}</b>
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
}
