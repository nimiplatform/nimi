import { useMemo, useState } from 'react';
import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { Check, Search } from 'lucide-react';
import {
  CATEGORIES,
  CHECKLIST,
  COLOR_TOKENS,
  FoundationsCanvas,
  RECIPES,
  RecipeCards,
  countFor,
  type CategoryId,
} from './kit-component-gallery-surface.js';

export function KitComponentGallery(_props: { onOpenSection?: (target: string) => void }) {
  const [category, setCategory] = useState<CategoryId>('foundations');
  const [selectedId, setSelectedId] = useState<string>('button');

  const recipesInCategory = useMemo(() => RECIPES.filter((recipe) => recipe.category === category), [category]);
  const selected = useMemo(() => RECIPES.find((recipe) => recipe.id === selectedId) ?? RECIPES[0], [selectedId]);
  const activeCategory = CATEGORIES.find((entry) => entry.id === category) ?? CATEGORIES[0];
  const totalExports = useMemo(() => RECIPES.reduce((sum, recipe) => sum + recipe.importNames.length, 0) + COLOR_TOKENS.length, []);

  const importLine = `import { ${selected.importNames.join(', ')} } from '@nimiplatform/kit/ui'`;

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
                onClick={() => {
                  setCategory(entry.id);
                  const first = RECIPES.find((recipe) => recipe.category === entry.id);
                  if (first) setSelectedId(first.id);
                }}
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

      {/* Middle — hero + canvas */}
      <section className="kit-doc__main">
        <Surface className="kit-doc__hero" material="glass-thin" tone="hero" elevation="base">
          <div>
            <p className="eyebrow">Developer design system</p>
            <h2>Build a Nimi App from canonical kit primitives</h2>
            <p>Recipes are grouped by ontology, not implementation chronology — what exists, how it looks, and how to import it.</p>
          </div>
          <div className="kit-doc__hero-actions">
            <Button tone="primary" size="sm">Open recipe</Button>
            <Button tone="secondary" size="sm">Copy import</Button>
          </div>
        </Surface>

        <Surface className="kit-doc__modebar" material="glass-thin" tone="panel" elevation="base">
          <div className="kit-doc__modetabs" role="tablist" aria-label="Recipe view">
            {['Live canvas', 'Code', 'Props', 'A11y', 'Tokens'].map((label, index) => (
              <span key={label} className={index === 0 ? 'kit-modetab kit-modetab--active' : 'kit-modetab'} role="tab" aria-selected={index === 0}>{label}</span>
            ))}
          </div>
          <code className="kit-doc__import">{importLine}</code>
        </Surface>

        <div className="kit-doc__canvas">
          <header className="kit-doc__canvas-head">
            <div>
              <p className="eyebrow">{activeCategory.label}</p>
              <h3>{activeCategory.desc}</h3>
            </div>
            <StatusBadge tone="neutral" shape="outline">{countFor(category)} entries</StatusBadge>
          </header>
          {category === 'foundations' ? <FoundationsCanvas /> : <RecipeCards recipes={recipesInCategory} selectedId={selectedId} onSelect={setSelectedId} />}
        </div>
      </section>

      {/* Right — inspector */}
      <aside className="kit-doc__inspector" aria-label="Recipe inspector">
        <Surface className="kit-insp" material="glass-thin" tone="panel" elevation="base">
          <div className="kit-insp__head">
            <div>
              <p className="eyebrow">Selected recipe</p>
              <strong>{selected.name}</strong>
            </div>
            <StatusBadge tone="success" shape="soft">stable</StatusBadge>
          </div>
          <pre className="kit-insp__code">{`import {\n  ${selected.importNames.join(',\n  ')}\n} from '@nimiplatform/kit/ui';\n\n${selected.snippet}`}</pre>
        </Surface>

        <Surface className="kit-insp" material="glass-thin" tone="panel" elevation="base">
          <h4>Props snapshot</h4>
          <div className="kit-props">
            {selected.props.map((row) => (
              <div key={row.name} className="kit-prop">
                <b>{row.name}</b>
                <span>{row.desc}</span>
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="kit-insp" material="glass-thin" tone="panel" elevation="base">
          <div className="kit-insp__head">
            <div>
              <p className="eyebrow">Coverage map</p>
              <strong>Every category has live examples</strong>
            </div>
            <StatusBadge tone="info" shape="soft">{RECIPES.length + 1} recipes</StatusBadge>
          </div>
          <div className="kit-covmap">
            {CATEGORIES.map((entry) => (
              <div key={entry.id} className="kit-covrow">
                <span>{entry.label}</span>
                <span className="kit-covbar"><span style={{ width: '100%' }} /></span>
                <b>{countFor(entry.id)}</b>
              </div>
            ))}
          </div>
          <div className="kit-checklist">
            {CHECKLIST.map((rule) => (
              <div key={rule} className="kit-check">
                <span className="kit-check__dot"><Check size={11} /></span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </Surface>
      </aside>
    </div>
  );
}
