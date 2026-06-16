import { useMemo, useState } from 'react';
import { Button, IconButton, OverlayShell, ProgressIndicator, StatusBadge, Surface, TooltipProvider } from '@nimiplatform/kit/ui';
import { Clipboard, Search } from 'lucide-react';
import {
  CATEGORIES,
  COLOR_TOKENS,
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
  const totalExports = useMemo(() => RECIPES.reduce((sum, recipe) => sum + recipe.importNames.length, 0) + COLOR_TOKENS.length, []);

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
      <div className="kit-doc grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3 p-3 max-[880px]:grid-cols-1" data-testid="nimi-tester-ui-recipes">
      {/* Left — taxonomy + coverage */}
      <Surface as="aside" material="glass-regular" padding="none" elevation="raised" className="kit-doc__library grid min-h-0 content-start gap-3 p-3" aria-label="Kit taxonomy">
        <div className="kit-doc__intro min-w-0">
          <p className="eyebrow">Nimi Kit</p>
          <h1 className="m-0 text-xl font-bold">UI Recipes</h1>
          <p className="kit-doc__lead mt-1 text-sm leading-5 text-[var(--nimi-text-secondary)]">Industrial component library for third-party Nimi App developers. Every consumable primitive gets a live example, import path, props, and token evidence.</p>
        </div>
        <div className="kit-doc__search flex min-h-9 items-center gap-2 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] px-3 text-xs text-[var(--nimi-text-muted)]" aria-hidden="true">
          <Search size={14} />
          <span className="min-w-0 flex-1 truncate">Search component or token</span>
          <code className="shrink-0">/</code>
        </div>
        <div className="kit-doc__coverage grid grid-cols-3 gap-2">
          <div className="kit-metric rounded-lg border border-[var(--nimi-border-subtle)] p-2"><strong className="block text-lg">{totalExports}</strong><span className="text-[10px] uppercase text-[var(--nimi-text-muted)]">exports</span></div>
          <div className="kit-metric rounded-lg border border-[var(--nimi-border-subtle)] p-2"><strong className="block text-lg">{CATEGORIES.length}</strong><span className="text-[10px] uppercase text-[var(--nimi-text-muted)]">categories</span></div>
          <div className="kit-metric rounded-lg border border-[var(--nimi-border-subtle)] p-2"><strong className="block text-lg">100%</strong><span className="text-[10px] uppercase text-[var(--nimi-text-muted)]">covered</span></div>
          <ProgressIndicator className="kit-doc__coverage-progress col-span-full" value={totalExports} max={totalExports} showValue aria-label="Kit gallery coverage" />
        </div>
        <nav className="kit-doc__taxonomy grid min-h-0 gap-2 overflow-auto">
          {CATEGORIES.map((entry) => {
            const isActive = entry.id === category;
            return (
              <button
                key={entry.id}
                type="button"
                className={`kit-tax grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2 text-left transition-colors ${isActive ? 'kit-tax--active border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]' : 'border-[var(--nimi-border-subtle)] bg-transparent hover:bg-[var(--nimi-action-ghost-hover)]'}`}
                onClick={() => selectCategory(entry.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="kit-tax__symbol grid h-8 w-8 place-items-center rounded-md bg-[var(--nimi-surface-active)] text-sm font-bold">{entry.symbol}</span>
                <span className="kit-tax__copy grid min-w-0">
                  <strong className="truncate text-sm">{entry.label}</strong>
                  <small className="truncate text-xs text-[var(--nimi-text-muted)]">{entry.desc}</small>
                </span>
                <span className="kit-tax__count rounded-full bg-[var(--nimi-surface-active)] px-2 py-1 text-xs font-bold text-[var(--nimi-text-secondary)]">{countFor(entry.id)}</span>
              </button>
            );
          })}
        </nav>
      </Surface>

      {/* Main — hero + canvas */}
      <section className="kit-doc__main grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <Surface className="kit-doc__hero flex items-center justify-between gap-3 p-4 max-[720px]:items-stretch max-[720px]:flex-col" material="glass-thin" tone="hero" elevation="base">
          <div>
            <p className="eyebrow">Developer design system</p>
            <h2 className="m-0 text-xl font-bold">{activeCategory.label}</h2>
            <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{activeCategory.desc}. Each recipe owns its live preview, import shape, props, accessibility, and token evidence.</p>
          </div>
          <div className="kit-doc__hero-actions flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge tone="info" shape="soft">{countFor(category)} entries</StatusBadge>
            <IconButton tone="secondary" size="sm" icon={<Clipboard size={13} />} aria-label="Copy imports" onClick={copyImport} />
            <Button tone="secondary" size="sm" leadingIcon={<Clipboard size={13} />} onClick={copyImport}>Copy</Button>
            <Button tone="secondary" size="sm" onClick={() => setOverlayPreviewOpen(true)}>Overlay</Button>
          </div>
        </Surface>

        <div className="kit-doc__canvas min-h-0 overflow-auto">
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
