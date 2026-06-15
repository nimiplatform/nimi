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
    <div className="kit-foundations">
      <Surface className="kit-found-card" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head">
          <div>
            <strong>Semantic color tokens</strong>
            <span>Use CSS variables directly when composing app-owned surfaces.</span>
          </div>
          <StatusBadge tone="success" shape="soft">theme aware</StatusBadge>
        </div>
        <div className="kit-token-grid">
          {COLOR_TOKENS.map((entry) => (
            <div key={entry.token} className="kit-token">
              <span className="kit-token__chip" style={{ background: `var(${entry.token})` }} aria-hidden="true" />
              <b>{entry.label}</b>
              <code>{entry.token}</code>
            </div>
          ))}
        </div>
      </Surface>
      <Surface className="kit-found-card" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head">
          <div>
            <strong>NimiText roles</strong>
            <span>Typography specimens map to role names.</span>
          </div>
          <StatusBadge tone="info" shape="soft">NimiText</StatusBadge>
        </div>
        <div className="kit-type-stack">
          {TYPE_ROLES.map((entry) => (
            <div key={entry.role} className="kit-type-row">
              <span className={entry.className}>{entry.sample}</span>
              <code>role=&quot;{entry.role}&quot;</code>
            </div>
          ))}
        </div>
        <div className="kit-scale-row">
          {SCALE_TOKENS.map((entry) => (
            <span key={entry.token} className="kit-scale-chip" style={{ borderRadius: `var(${entry.token})` }}>{entry.label}</span>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function RecipeModeContent({ recipe, mode }: { recipe: Recipe; mode: RecipeMode }) {
  if (mode === 'live') {
    return <span className="kit-card__stage">{recipe.stage}</span>;
  }

  if (mode === 'code') {
    const importBlock = [
      `import {\n  ${recipe.importNames.join(',\n  ')}\n} from '@nimiplatform/kit/ui';`,
      ...(recipe.extraImports ?? []),
    ].join('\n');
    return (
      <div className="kit-card__mode kit-card__mode--code">
        <div className="kit-mode-panel__head">
          <Code2 size={15} aria-hidden="true" />
          <strong>Import and usage</strong>
        </div>
        <ScrollShell className="kit-code-scroll">
          <pre className="kit-code-block">{`${importBlock}\n\n${recipe.snippet}`}</pre>
        </ScrollShell>
      </div>
    );
  }

  if (mode === 'props') {
    return (
      <div className="kit-card__mode">
        <div className="kit-mode-panel__head">
          <ListChecks size={15} aria-hidden="true" />
          <strong>Props contract</strong>
        </div>
        <div className="kit-props">
          {recipe.props.map((row) => (
            <div key={row.name} className="kit-prop">
              <b>{row.name}</b>
              <span>{row.desc}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'a11y') {
    return (
      <div className="kit-card__mode">
        <div className="kit-mode-panel__head">
          <Check size={15} aria-hidden="true" />
          <strong>Acceptance checks</strong>
        </div>
        <div className="kit-checklist kit-checklist--grid">
          {CHECKLIST.map((rule) => (
            <div key={rule} className="kit-check">
              <span className="kit-check__dot"><Check size={11} /></span>
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="kit-card__mode">
      <div className="kit-mode-panel__head">
        <Palette size={15} aria-hidden="true" />
        <strong>Recipe token footprint</strong>
      </div>
      <div className="kit-token-note">
        <strong>{recipe.exportsLabel}</strong>
        <span>Uses shared Kit action, surface, text, focus, and status tokens through the imported primitive.</span>
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
      className={recipe.wide ? 'kit-card kit-card--wide' : 'kit-card'}
    >
      <div className="kit-card__head">
        <div className="kit-card__title">
          <strong>{recipe.name}</strong>
          <code>{recipe.exportsLabel}</code>
        </div>
        <div className="kit-card__head-actions">
          <StatusBadge tone={badgeTone(recipe.badge.tone)} shape="soft">{recipe.badge.label}</StatusBadge>
          <IconToggleAction
            aria-label={`${recipe.name} live preview`}
            icon={<Check size={13} />}
            active={mode === 'live'}
            onClick={() => setMode('live')}
          />
        </div>
      </div>
      <div className="kit-card__tabs" role="tablist" aria-label={`${recipe.name} recipe view`}>
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
    <div className="kit-cards">
      {recipes.map((recipe) => (
        <RecipeCard key={recipe.id} recipe={recipe} />
      ))}
    </div>
  );
}
