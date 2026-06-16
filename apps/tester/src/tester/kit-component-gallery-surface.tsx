import { useMemo, useState } from 'react';
import { AppCardSurface, CompactAction, IconToggleAction, ScrollShell, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { Check, Code2, ListChecks, Palette } from 'lucide-react';
import {
  CATEGORIES,
  CHECKLIST,
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

export function FoundationsCanvas() {
  return (
    <div className="kit-foundations grid grid-cols-2 gap-3 max-[980px]:grid-cols-1">
      <Surface className="kit-found-card grid content-start gap-3 p-3" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head flex items-start justify-between gap-3">
          <div>
            <strong>Semantic color tokens</strong>
            <span className="mt-1 block text-xs text-[var(--nimi-text-muted)]">Use CSS variables directly when composing app-owned surfaces.</span>
          </div>
          <StatusBadge tone="success" shape="soft">theme aware</StatusBadge>
        </div>
        <div className="kit-token-grid grid grid-cols-2 gap-2">
          {COLOR_TOKENS.map((entry) => (
            <div key={entry.token} className="kit-token overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)]">
              <span className="kit-token__chip block h-6" style={{ background: `var(${entry.token})` }} aria-hidden="true" />
              <b className="block px-2 pt-1 text-xs">{entry.label}</b>
              <code className="block truncate px-2 pb-2 text-[10px] text-[var(--nimi-text-muted)]">{entry.token}</code>
            </div>
          ))}
        </div>
      </Surface>
      <Surface className="kit-found-card grid content-start gap-3 p-3" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head flex items-start justify-between gap-3">
          <div>
            <strong>NimiText roles</strong>
            <span className="mt-1 block text-xs text-[var(--nimi-text-muted)]">Typography specimens map to role names.</span>
          </div>
          <StatusBadge tone="info" shape="soft">NimiText</StatusBadge>
        </div>
        <div className="kit-type-stack grid gap-2">
          {TYPE_ROLES.map((entry) => (
            <div key={entry.role} className="kit-type-row flex items-baseline justify-between gap-3 border-b border-[color-mix(in_srgb,var(--nimi-text-primary)_7%,transparent)] pb-1">
              <span className={entry.className}>{entry.sample}</span>
              <code className="shrink-0 text-[10px] text-[var(--nimi-text-muted)]">role=&quot;{entry.role}&quot;</code>
            </div>
          ))}
        </div>
        <div className="kit-scale-row flex flex-wrap gap-2">
          {SCALE_TOKENS.map((entry) => (
            <span key={entry.token} className="kit-scale-chip border border-[var(--nimi-border-strong)] px-3 py-1 text-xs text-[var(--nimi-text-secondary)]" style={{ borderRadius: `var(${entry.token})` }}>{entry.label}</span>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function RecipeModeContent({ recipe, mode }: { recipe: Recipe; mode: RecipeMode }) {
  if (mode === 'live') {
    return <span className="kit-card__stage grid min-h-32 place-items-center rounded-lg border border-[var(--nimi-border-subtle)] p-3">{recipe.stage}</span>;
  }

  if (mode === 'code') {
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

  if (mode === 'props') {
    return (
      <div className="kit-card__mode grid gap-2">
        <div className="kit-mode-panel__head flex items-center gap-2">
          <ListChecks size={15} aria-hidden="true" />
          <strong>Props contract</strong>
        </div>
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

  if (mode === 'a11y') {
    return (
      <div className="kit-card__mode grid gap-2">
        <div className="kit-mode-panel__head flex items-center gap-2">
          <Check size={15} aria-hidden="true" />
          <strong>Acceptance checks</strong>
        </div>
        <div className="kit-checklist kit-checklist--grid grid grid-cols-3 gap-2 max-[980px]:grid-cols-1">
          {CHECKLIST.map((rule) => (
            <div key={rule} className="kit-check grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2 text-xs text-[var(--nimi-text-secondary)]">
              <span className="kit-check__dot grid h-4 w-4 place-items-center rounded-full bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success)]"><Check size={11} /></span>
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="kit-card__mode grid gap-2">
      <div className="kit-mode-panel__head flex items-center gap-2">
        <Palette size={15} aria-hidden="true" />
        <strong>Recipe token footprint</strong>
      </div>
      <div className="kit-token-note grid gap-1 rounded-lg border border-[var(--nimi-border-subtle)] p-3">
        <strong>{recipe.exportsLabel}</strong>
        <span className="text-sm text-[var(--nimi-text-secondary)]">Uses shared Kit action, surface, text, focus, and status tokens through the imported primitive.</span>
      </div>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  const [mode, setMode] = useState<RecipeMode>('live');
  return (
    <AppCardSurface
      as="article"
      key={recipe.id}
      kind={recipe.wide ? 'promoted-glass' : 'operational-solid'}
      className={recipe.wide ? 'kit-card kit-card--wide grid gap-3 p-3' : 'kit-card grid gap-3 p-3'}
    >
      <div className="kit-card__head flex items-start justify-between gap-3">
        <div className="kit-card__title grid min-w-0 gap-1">
          <strong className="truncate">{recipe.name}</strong>
          <code className="truncate text-xs text-[var(--nimi-text-muted)]">{recipe.exportsLabel}</code>
        </div>
        <div className="kit-card__head-actions flex shrink-0 items-center gap-2">
          <StatusBadge tone={badgeTone(recipe.badge.tone)} shape="soft">{recipe.badge.label}</StatusBadge>
          <IconToggleAction
            aria-label={`${recipe.name} live preview`}
            icon={<Check size={13} />}
            active={mode === 'live'}
            onClick={() => setMode('live')}
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
    <div className="kit-cards grid gap-3">
      {recipes.map((recipe) => (
        <RecipeCard key={recipe.id} recipe={recipe} />
      ))}
    </div>
  );
}
