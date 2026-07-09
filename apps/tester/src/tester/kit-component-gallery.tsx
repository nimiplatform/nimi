import { useMemo, useState } from 'react';
import { Button, IconButton, Surface } from '@nimiplatform/kit/ui';
import {
  CheckSquare,
  Copy,
  Database,
  FormInput,
  Layers,
  PanelsTopLeft,
  Search,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  CATEGORIES,
  RECIPES,
  type CategoryId,
} from './kit-component-gallery-recipes.js';
import {
  FoundationsCanvas,
  RecipeWorkspace,
  countFor,
} from './kit-component-gallery-surface.js';

const foundationCode = `@import "@nimiplatform/kit/ui/styles.css";
@import "@nimiplatform/kit/ui/themes/light.css";
@import "@nimiplatform/kit/ui/themes/nimi-accent.css";

.surface {
  color: var(--nimi-text-primary);
  background: var(--nimi-material-glass-thin-bg);
  border: 1px solid var(--nimi-material-glass-thin-border);
}`;

const categoryIcons: Record<CategoryId, LucideIcon> = {
  foundations: Layers,
  actions: Zap,
  inputs: FormInput,
  selection: CheckSquare,
  overlays: Layers,
  layouts: PanelsTopLeft,
  data: Database,
};

export function KitComponentGallery(_props: { onOpenSection?: (target: string) => void }) {
  const [category, setCategory] = useState<CategoryId>('foundations');

  const recipesInCategory = useMemo(() => RECIPES.filter((recipe) => recipe.category === category), [category]);
  const activeCategory = CATEGORIES.find((entry) => entry.id === category) ?? CATEGORIES[0];

  const categoryCopyText = useMemo(() => {
    if (category === 'foundations') return foundationCode;
    const imports = Array.from(new Set(recipesInCategory.flatMap((recipe) => recipe.importNames))).sort();
    return `import {\n  ${imports.join(',\n  ')}\n} from '@nimiplatform/kit/ui';`;
  }, [category, recipesInCategory]);

  function selectCategory(nextCategory: CategoryId) {
    setCategory(nextCategory);
  }

  function copyImport() {
    if (typeof navigator === 'undefined') return;
    void navigator.clipboard?.writeText(categoryCopyText);
  }

  return (
    <div className="kit-doc grid h-full min-h-0 min-w-0 grid-cols-[260px_minmax(0,1fr)] items-stretch gap-4 overflow-x-hidden overflow-y-auto p-4 max-[880px]:grid-cols-1" data-testid="nimi-tester-ui-recipes">
      {/* Left — library nav. Sticky while the canvas to its right scrolls. */}
      <Surface as="aside" material="glass-regular" padding="none" elevation="raised" className="kit-doc__library sticky top-0 flex h-[calc(100vh-2rem)] min-h-0 max-h-none flex-col gap-4 self-stretch overflow-hidden p-4 max-[880px]:static max-[880px]:h-auto max-[880px]:overflow-visible" aria-label="Kit library navigation">
        <div className="kit-doc__intro min-w-0">
          <p className="eyebrow">Nimi UI Kit</p>
          <h1 className="m-0 text-2xl font-bold tracking-tight">UI Recipes</h1>
        </div>
        <div className="kit-doc__search flex min-h-10 items-center gap-2 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_55%,transparent)] px-3 text-xs text-[var(--nimi-text-muted)]" aria-hidden="true">
          <Search size={14} />
          <span className="min-w-0 flex-1 truncate">Search the kit</span>
          <kbd className="shrink-0 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-1.5 py-0.5 font-mono text-[10px]">/</kbd>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <p className="kit-doc__browse-label px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--nimi-text-muted)]">Browse</p>
          <nav className="kit-doc__taxonomy grid min-h-0 flex-1 content-start gap-1.5 overflow-auto" aria-label="Recipe categories">
            {CATEGORIES.map((entry) => {
              const isActive = entry.id === category;
              return (
                <Button
                  key={entry.id}
                  type="button"
                  tone="ghost"
                  size="sm"
                  className={`kit-tax grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-2 text-left transition-all ${isActive ? 'kit-tax--active border-transparent bg-[var(--nimi-sidebar-item-active)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]' : 'border-transparent bg-transparent text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-sidebar-item-hover)] hover:text-[var(--nimi-text-primary)]'}`}
                  onClick={() => selectCategory(entry.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className={`kit-tax__symbol grid h-10 w-10 place-items-center rounded-xl border text-sm font-bold transition-colors ${isActive ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_34%,transparent)] bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]'}`}>
                    {(() => {
                      const Icon = categoryIcons[entry.id];
                      return <Icon size={18} strokeWidth={1.8} aria-hidden="true" />;
                    })()}
                  </span>
                  <span className="kit-tax__copy min-w-0">
                    <strong className="truncate text-sm">{entry.label}</strong>
                  </span>
                  <span className={`kit-tax__count rounded-full px-2 py-0.5 text-xs font-bold ${isActive ? 'bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]' : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]'}`}>{countFor(entry.id)}</span>
                </Button>
              );
            })}
          </nav>
        </div>
      </Surface>

      {/* Main — hero + canvas. Flows in natural height so the whole column scrolls. */}
      <section className="kit-doc__main grid min-w-0 content-start gap-4">
        <div className="kit-doc__header flex min-w-0 items-center justify-between gap-4 px-1 py-1 max-[720px]:flex-col max-[720px]:items-stretch">
          <div className="grid min-w-0 gap-2">
            <h2 className="m-0 truncate text-3xl font-bold tracking-tight">{activeCategory.label}</h2>
          </div>
          <div className="kit-doc__header-actions flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            <IconButton
              tone="ghost"
              size="sm"
              aria-label={category === 'foundations' ? 'Copy CSS setup' : 'Copy imports'}
              className="kit-doc__copy-action bg-[color-mix(in_srgb,var(--nimi-surface-card)_32%,transparent)] border-[color-mix(in_srgb,var(--nimi-border-subtle)_45%,transparent)] shadow-none hover:bg-[var(--nimi-action-primary-bg)] hover:border-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-action-primary-text)] hover:shadow-none"
              icon={<Copy size={14} aria-hidden="true" />}
              onClick={copyImport}
            />
          </div>
        </div>

        <div className="kit-doc__canvas min-w-0">
          {category === 'foundations' ? (
            <FoundationsCanvas />
          ) : (
            <RecipeWorkspace recipes={recipesInCategory} />
          )}
        </div>
      </section>
    </div>
  );
}
