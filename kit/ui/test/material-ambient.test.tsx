import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AmbientBackground, Surface } from '../src/index.js';

test('Surface without material prop defaults to solid (emits solid marker, no glass class)', () => {
  const html = renderToStaticMarkup(<Surface tone="card">plain</Surface>);
  expect(html).toMatch(/class="[^"]*\bnimi-material-solid\b[^"]*"/u);
  expect(html).not.toMatch(/nimi-material-glass-regular/);
  expect(html).not.toMatch(/nimi-material-glass-thick/);
});

test('Surface material="solid" emits solid marker explicitly', () => {
  const html = renderToStaticMarkup(
    <Surface tone="card" material="solid">plain</Surface>,
  );
  expect(html).toMatch(/class="[^"]*\bnimi-material-solid\b[^"]*"/u);
});

test('Surface material="glass-regular" applies the regular glass class', () => {
  const html = renderToStaticMarkup(
    <Surface tone="card" material="glass-regular">regular</Surface>,
  );
  expect(html).toMatch(/nimi-material-glass-regular/);
  expect(html).not.toMatch(/nimi-material-glass-thick/);
});

test('Surface material="glass-thick" applies the thick glass class', () => {
  const html = renderToStaticMarkup(
    <Surface tone="card" material="glass-thick">thick</Surface>,
  );
  expect(html).toMatch(/nimi-material-glass-thick/);
  expect(html).not.toMatch(/nimi-material-glass-regular/);
});

test('Surface material does not regress tone/elevation/padding classes', () => {
  const html = renderToStaticMarkup(
    <Surface tone="hero" elevation="floating" padding="lg" material="glass-thick">
      combo
    </Surface>,
  );
  // tone card var
  expect(html).toMatch(/var\(--nimi-surface-hero\)/);
  // elevation shadow var
  expect(html).toMatch(/var\(--nimi-elevation-floating\)/);
  // padding utility
  expect(html).toMatch(/p-6/);
  // material class
  expect(html).toMatch(/nimi-material-glass-thick/);
});

// Helpers: match only class-attribute membership, not token names embedded
// in inline style attributes (e.g. `var(--nimi-ambient-mesh-color-1)`).
const hasClass = (html: string, name: string) =>
  new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`, 'u').test(html);
const countClass = (html: string, name: string) =>
  (html.match(new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`, 'gu')) ?? []).length;

test('AmbientBackground variant="none" emits primitive contract classes but no ambient layers', () => {
  const html = renderToStaticMarkup(
    <AmbientBackground variant="none">
      <span>content</span>
    </AmbientBackground>,
  );
  expect(html).toMatch(/content/);
  // Primitive contract: root slot and variant marker are always present.
  expect(hasClass(html, 'nimi-ambient-root')).toBe(true);
  expect(hasClass(html, 'nimi-ambient-variant-none')).toBe(true);
  // No ambient visual layers for "none".
  expect(hasClass(html, 'nimi-ambient-mesh')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-minimal')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-halo')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-variant-mesh')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-variant-minimal')).toBe(false);
});

test('AmbientBackground variant="minimal" renders the gradient layer and minimal variant marker', () => {
  const html = renderToStaticMarkup(
    <AmbientBackground variant="minimal">
      <span>content</span>
    </AmbientBackground>,
  );
  expect(hasClass(html, 'nimi-ambient-root')).toBe(true);
  expect(hasClass(html, 'nimi-ambient-variant-minimal')).toBe(true);
  expect(hasClass(html, 'nimi-ambient-minimal')).toBe(true);
  expect(hasClass(html, 'nimi-ambient-mesh')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-halo')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-variant-mesh')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-variant-none')).toBe(false);
  expect(html).toMatch(/content/);
});

test('AmbientBackground variant="mesh" renders mesh layer, three halos, and mesh variant marker', () => {
  const html = renderToStaticMarkup(
    <AmbientBackground variant="mesh">
      <span>content</span>
    </AmbientBackground>,
  );
  expect(hasClass(html, 'nimi-ambient-root')).toBe(true);
  expect(hasClass(html, 'nimi-ambient-variant-mesh')).toBe(true);
  expect(hasClass(html, 'nimi-ambient-mesh')).toBe(true);
  expect(hasClass(html, 'nimi-ambient-minimal')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-variant-minimal')).toBe(false);
  expect(hasClass(html, 'nimi-ambient-variant-none')).toBe(false);
  expect(countClass(html, 'nimi-ambient-halo')).toBe(3);
  expect(html).toMatch(/content/);
});

test('AmbientBackground passes className through on container', () => {
  const html = renderToStaticMarkup(
    <AmbientBackground variant="mesh" className="host-class">
      <span>content</span>
    </AmbientBackground>,
  );
  expect(html).toMatch(/host-class/);
  expect(hasClass(html, 'nimi-ambient-root')).toBe(true);
});

test('AmbientBackground user style cannot overwrite positioning / isolation', () => {
  // Consumer passes a style prop; the component must preserve
  // position: relative + isolation: isolate on the root so that the
  // absolute-positioned mesh / halo layers stay anchored to the
  // AmbientBackground container and not to an ancestor.
  const html = renderToStaticMarkup(
    <AmbientBackground
      variant="mesh"
      style={{ position: 'static', isolation: 'auto', padding: '24px' }}
    >
      <span>content</span>
    </AmbientBackground>,
  );
  expect(html).toMatch(/position:\s*relative/);
  expect(html).toMatch(/isolation:\s*isolate/);
  expect(html).not.toMatch(/position:\s*static/);
  expect(html).not.toMatch(/isolation:\s*auto/);
  // Consumer-provided properties that do not collide with the contract
  // are preserved.
  expect(html).toMatch(/padding:\s*24px/);
});
