import { useMemo, useState } from 'react';
import { AppCardSurface, CompactAction, IconToggleAction, NimiText, ScrollShell, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { Check, Code2, ListChecks, Palette } from 'lucide-react';
import {
  CATEGORIES,
  COLOR_TOKENS,
  RECIPE_MODES,
  RECIPES,
  SCALE_TOKENS,
  TYPE_ROLES,
  type CategoryId,
  type Recipe,
  type RecipeMode,
} from './kit-component-gallery-recipes.js';

export function countFor(category: CategoryId): number {
  if (category === 'foundations') return COLOR_TOKENS.length + TYPE_ROLES.length + SCALE_TOKENS.length;
  return RECIPES.filter((recipe) => recipe.category === category).length;
}

function badgeTone(tone: Recipe['badge']['tone']): 'success' | 'info' | 'warning' | 'neutral' {
  return tone;
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

function RecipeModeContent({ recipe, mode }: { recipe: Recipe; mode: RecipeMode }) {
  if (mode === 'preview') {
    return (
      <span className="kit-card__stage grid min-h-32 place-items-center gap-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-canvas)_55%,transparent)] p-4">
        {recipe.stage}
      </span>
    );
  }

  if (mode === 'use') {
    const importBlock = [
      `import {\n  ${recipe.importNames.join(',\n  ')}\n} from '@nimiplatform/kit/ui';`,
      ...(recipe.extraImports ?? []),
    ].join('\n');
    return (
      <div className="kit-card__mode kit-card__mode--code grid gap-2">
        <div className="kit-mode-panel__head flex items-center gap-2">
          <Code2 size={15} aria-hidden="true" />
          <strong>Import and usage</strong>
        </div>
        <ScrollShell className="kit-code-scroll max-h-56 rounded-lg bg-[var(--nimi-surface-canvas)] p-3">
          <pre className="kit-code-block m-0 whitespace-pre-wrap text-xs text-[var(--nimi-text-secondary)]">{`${importBlock}\n\n${recipe.snippet}`}</pre>
        </ScrollShell>
      </div>
    );
  }

  if (mode === 'key-props') {
    return (
      <div className="kit-card__mode grid gap-2">
        <div className="kit-mode-panel__head flex items-center gap-2">
          <ListChecks size={15} aria-hidden="true" />
          <strong>Key props</strong>
        </div>
        <span className="text-xs text-[var(--nimi-text-muted)]">Selected consumer props. Full API remains the TypeScript source contract.</span>
        <div className="kit-props overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)]">
          {recipe.props.map((row) => (
            <div key={row.name} className="kit-prop grid grid-cols-[112px_minmax(0,1fr)] border-b border-[color-mix(in_srgb,var(--nimi-text-primary)_7%,transparent)] last:border-b-0">
              <b className="bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] p-2 text-xs">{row.name}</b>
              <span className="p-2 text-xs text-[var(--nimi-text-secondary)]">{row.desc}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'access') {
    const checks = recipe.accessChecks ?? fallbackAccessChecks;
    return (
      <div className="kit-card__mode grid gap-2">
        <div className="kit-mode-panel__head flex items-center gap-2">
          <Check size={15} aria-hidden="true" />
          <strong>Access checks</strong>
        </div>
        <div className="kit-checklist kit-checklist--grid grid grid-cols-3 gap-2 max-[980px]:grid-cols-1">
          {checks.map((rule) => (
            <div key={rule} className="kit-check grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2 text-xs text-[var(--nimi-text-secondary)]">
              <span className="kit-check__dot grid h-4 w-4 place-items-center rounded-full bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success)]"><Check size={11} /></span>
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const tokenFootprint = recipe.tokenFootprint ?? fallbackTokenFootprint(recipe);
  return (
    <div className="kit-card__mode grid gap-2">
      <div className="kit-mode-panel__head flex items-center gap-2">
        <Palette size={15} aria-hidden="true" />
        <strong>Design token footprint</strong>
      </div>
      <div className="kit-props overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)]">
        {tokenFootprint.map((row) => (
          <div key={`${row.token}-${row.role}`} className="kit-prop grid grid-cols-[minmax(128px,0.9fr)_minmax(0,1.2fr)_minmax(120px,0.9fr)] border-b border-[color-mix(in_srgb,var(--nimi-text-primary)_7%,transparent)] last:border-b-0 max-[720px]:grid-cols-1">
            <code className="bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,transparent)] p-2 text-xs">{row.token}</code>
            <span className="p-2 text-xs text-[var(--nimi-text-secondary)]">{row.role}</span>
            <span className="p-2 text-xs text-[var(--nimi-text-muted)]">{row.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  const [mode, setMode] = useState<RecipeMode>('preview');
  return (
    <AppCardSurface
      as="article"
      key={recipe.id}
      kind={recipe.wide ? 'promoted-glass' : 'operational-solid'}
      className={`kit-card grid content-start gap-3 p-4${recipe.wide ? ' kit-card--wide col-span-2 max-[980px]:col-span-1' : ''}`}
    >
      <div className="kit-card__head flex items-start justify-between gap-3">
        <div className="kit-card__title min-w-0">
          <strong className="truncate">{recipe.name}</strong>
        </div>
        <div className="kit-card__head-actions flex shrink-0 items-center gap-2">
          <StatusBadge tone={badgeTone(recipe.badge.tone)} shape="soft">{recipe.badge.label}</StatusBadge>
          <IconToggleAction
            aria-label={`${recipe.name} preview`}
            icon={<Check size={13} />}
            active={mode === 'preview'}
            onClick={() => setMode('preview')}
          />
        </div>
      </div>
      <div className="kit-card__tabs flex flex-wrap gap-2" role="tablist" aria-label={`${recipe.name} recipe view`}>
        {RECIPE_MODES.map((item) => (
          <CompactAction
            key={item.id}
            type="button"
            className={mode === item.id ? 'kit-card-tab kit-card-tab--active' : 'kit-card-tab'}
            tone={mode === item.id ? 'primary' : 'neutral'}
            role="tab"
            aria-selected={mode === item.id}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </CompactAction>
        ))}
      </div>
      <RecipeModeContent recipe={recipe} mode={mode} />
    </AppCardSurface>
  );
}

export function RecipeCards({ recipes }: { recipes: Recipe[] }) {
  return (
    <div className="kit-cards grid grid-cols-2 items-start gap-4 max-[980px]:grid-cols-1">
      {recipes.map((recipe) => (
        <RecipeCard key={recipe.id} recipe={recipe} />
      ))}
    </div>
  );
}
