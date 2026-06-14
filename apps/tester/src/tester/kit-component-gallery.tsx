import { useMemo, useState } from 'react';
import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { Clipboard, Search } from 'lucide-react';
import {
  CATEGORIES,
  COLOR_TOKENS,
  FoundationsCanvas,
  RECIPES,
  RecipeCards,
  countFor,
  type CategoryId,
} from './kit-component-gallery-surface.js';

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
    <div className="kit-doc" data-testid="nimi-tester-ui-recipes">
      {/* Left — taxonomy + coverage */}
      <Surface as="aside" material="glass-regular" padding="none" elevation="raised" className="kit-doc__library" aria-label="Kit taxonomy">
        <div className="kit-doc__intro">
          <p className="eyebrow">Nimi Kit</p>
          <h1>UI Recipes</h1>
          <p className="kit-doc__lead">Industrial component library for third-party Nimi App developers. Every consumable primitive gets a live example, import path, props, and token evidence.</p>
        </div>
        <div className="kit-doc__search" aria-hidden="true">
          <Search size={14} />
          <span>Search component or token</span>
          <code>/</code>
        </div>
        <div className="kit-doc__coverage">
          <div className="kit-metric"><strong>{totalExports}</strong><span>exports</span></div>
          <div className="kit-metric"><strong>{CATEGORIES.length}</strong><span>categories</span></div>
          <div className="kit-metric"><strong>100%</strong><span>covered</span></div>
        </div>
        <nav className="kit-doc__taxonomy">
          {CATEGORIES.map((entry) => {
            const isActive = entry.id === category;
            return (
              <button
                key={entry.id}
                type="button"
                className={isActive ? 'kit-tax kit-tax--active' : 'kit-tax'}
                onClick={() => selectCategory(entry.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="kit-tax__symbol">{entry.symbol}</span>
                <span className="kit-tax__copy">
                  <strong>{entry.label}</strong>
                  <small>{entry.desc}</small>
                </span>
                <span className="kit-tax__count">{countFor(entry.id)}</span>
              </button>
            );
          })}
        </nav>
      </Surface>

      {/* Main — hero + canvas */}
      <section className="kit-doc__main">
        <Surface className="kit-doc__hero" material="glass-thin" tone="hero" elevation="base">
          <div>
            <p className="eyebrow">Developer design system</p>
            <h2>{activeCategory.label}</h2>
            <p>{activeCategory.desc}. Each recipe owns its live preview, import shape, props, accessibility, and token evidence.</p>
          </div>
          <div className="kit-doc__hero-actions">
            <StatusBadge tone="info" shape="soft">{countFor(category)} entries</StatusBadge>
            <Button tone="secondary" size="sm" leadingIcon={<Clipboard size={13} />} onClick={copyImport}>Copy</Button>
          </div>
        </Surface>

        <div className="kit-doc__canvas">
          {category === 'foundations' ? <FoundationsCanvas /> : <RecipeCards recipes={recipesInCategory} />}
        </div>
      </section>
    </div>
  );
}
