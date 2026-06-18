import { useMemo, useState } from 'react';
import { Button, IconButton, OverlayShell, ProgressIndicator, StatusBadge, Surface, Tooltip, TooltipProvider } from '@nimiplatform/kit/ui';
import { Clipboard, Maximize2, Search } from 'lucide-react';
import {
  CATEGORIES,
  RECIPES,
  type CategoryId,
} from './kit-component-gallery-recipes.js';
import { FoundationsCanvas, RecipeCards, countFor } from './kit-component-gallery-surface.js';

const foundationCode = `@import "@nimiplatform/kit/ui/styles.css";
@import "@nimiplatform/kit/ui/themes/light.css";
@import "@nimiplatform/kit/ui/themes/nimi-accent.css";

.surface {
  color: var(--nimi-text-primary);
  background: var(--nimi-material-glass-thin-bg);
  border: 1px solid var(--nimi-material-glass-thin-border);
}`;

export function KitComponentGallery(_props: { onOpenSection?: (target: string) => void }) {
  const [category, setCategory] = useState<CategoryId>('foundations');
  const [overlayPreviewOpen, setOverlayPreviewOpen] = useState(false);

  const recipesInCategory = useMemo(() => RECIPES.filter((recipe) => recipe.category === category), [category]);
  const activeCategory = CATEGORIES.find((entry) => entry.id === category) ?? CATEGORIES[0];
  const activeCategoryCount = countFor(category);

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
    <TooltipProvider>
      <div className="kit-doc grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] items-start gap-4 overflow-y-auto p-4 max-[880px]:grid-cols-1" data-testid="nimi-tester-ui-recipes">
      {/* Left — library nav. Sticky while the canvas to its right scrolls. */}
      <Surface as="aside" material="glass-regular" padding="none" elevation="raised" className="kit-doc__library sticky top-0 flex max-h-[calc(100vh-2rem)] flex-col gap-4 self-start overflow-hidden p-4 max-[880px]:static max-[880px]:max-h-none max-[880px]:overflow-visible" aria-label="Kit library navigation">
        <div className="kit-doc__intro min-w-0">
          <p className="eyebrow">Nimi UI Kit</p>
          <h1 className="m-0 text-2xl font-bold tracking-tight">UI Recipes</h1>
          <p className="kit-doc__lead mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">Every primitive ships with a live preview, a copy-paste import, its props, and the exact design tokens it uses.</p>
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
                <button
                  key={entry.id}
                  type="button"
                  className={`kit-tax grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-2 text-left transition-all ${isActive ? 'kit-tax--active border-transparent bg-[var(--nimi-surface-card)] shadow-[0_8px_24px_rgba(36,54,82,0.10)]' : 'border-transparent bg-transparent hover:bg-[var(--nimi-action-ghost-hover)]'}`}
                  onClick={() => selectCategory(entry.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className={`kit-tax__symbol grid h-9 w-9 place-items-center rounded-lg text-sm font-bold transition-colors ${isActive ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-secondary)]'}`}>{entry.symbol}</span>
                  <span className="kit-tax__copy grid min-w-0">
                    <strong className="truncate text-sm">{entry.label}</strong>
                    <small className="truncate text-xs text-[var(--nimi-text-muted)]">{entry.desc}</small>
                  </span>
                  <span className="kit-tax__count rounded-full bg-[var(--nimi-surface-active)] px-2 py-0.5 text-xs font-bold text-[var(--nimi-text-secondary)]">{countFor(entry.id)}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </Surface>

      {/* Main — hero + canvas. Flows in natural height so the whole column scrolls. */}
      <section className="kit-doc__main grid content-start gap-4">
        <Surface className="kit-doc__hero flex items-start justify-between gap-4 p-5 max-[720px]:flex-col max-[720px]:items-stretch" material="glass-thin" tone="hero" elevation="base">
          <div className="min-w-0">
            <p className="eyebrow">Nimi UI Kit · Reference</p>
            <h2 className="m-0 text-2xl font-bold tracking-tight">{activeCategory.label}</h2>
            <p className="mt-2 max-w-prose text-sm leading-6 text-[var(--nimi-text-secondary)]">
              {category === 'foundations'
                ? 'The visual primitives every component is built on — color, type, and radius. Reference these tokens directly when you compose your own surfaces.'
                : `${activeCategory.desc}. Each recipe owns its live preview, import shape, props, accessibility, and token evidence.`}
            </p>
          </div>
          <div className="kit-doc__hero-actions flex shrink-0 flex-wrap items-center gap-2">
            <ProgressIndicator
              value={activeCategoryCount}
              max={Math.max(activeCategoryCount, 10)}
              className="w-24"
              aria-label="Visible recipe coverage"
            />
            <StatusBadge tone="info" shape="soft">{activeCategoryCount} entries</StatusBadge>
            <Button tone="secondary" size="sm" leadingIcon={<Clipboard size={13} />} onClick={copyImport}>{category === 'foundations' ? 'Copy tokens' : 'Copy imports'}</Button>
            <Tooltip content="Preview overlay shell" placement="top">
              <IconButton
                tone="ghost"
                size="sm"
                aria-label="Preview overlay shell"
                icon={<Maximize2 size={14} aria-hidden="true" />}
                onClick={() => setOverlayPreviewOpen(true)}
              />
            </Tooltip>
          </div>
        </Surface>

        <div className="kit-doc__canvas min-w-0">
          {category === 'foundations' ? <FoundationsCanvas /> : <RecipeCards recipes={recipesInCategory} />}
        </div>
      </section>
      <OverlayShell
        open={overlayPreviewOpen}
        onClose={() => setOverlayPreviewOpen(false)}
        title="Kit overlay"
        footer={<Button tone="primary" size="sm" onClick={() => setOverlayPreviewOpen(false)}>Close</Button>}
      >
        <p className="kit-overlay-preview-copy">OverlayShell renders dialog, drawer, and popover shells with the same app chrome.</p>
      </OverlayShell>
    </div>
    </TooltipProvider>
  );
}
