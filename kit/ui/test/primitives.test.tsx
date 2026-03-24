import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import {
  Button,
  NIMI_PRIMITIVE_CONTRACT,
  NimiThemeProvider,
  SearchField,
  SidebarItem,
  SidebarShell,
  StatusBadge,
  Surface,
  TYPOGRAPHY_TOKEN_CLASS,
} from '../src/index.js';

test('shared primitives render stable family classes', () => {
  const html = renderToStaticMarkup(
    <SidebarShell data-testid="sidebar">
      <SidebarItem kind="nav-row" label="Settings" />
    </SidebarShell>,
  );

  expect(html).toMatch(/nimi-sidebar-shell/);
  expect(html).toMatch(/nimi-sidebar-item/);
  expect(html).toMatch(/nav-row/);
});

test('surface, button, field, and status primitives render semantic classes', () => {
  const html = renderToStaticMarkup(
    <div>
      <Surface tone="card">card</Surface>
      <Button tone="primary">save</Button>
      <SearchField placeholder="Search" />
      <StatusBadge tone="success">ready</StatusBadge>
    </div>,
  );

  expect(html).toMatch(/nimi-surface--card/);
  expect(html).toMatch(/nimi-action--primary/);
  expect(html).toMatch(/nimi-field--search/);
  expect(html).toMatch(/nimi-status--success/);
});

test('theme provider renders children under shared runtime API', () => {
  const html = renderToStaticMarkup(
    <NimiThemeProvider accentPack="relay-accent" defaultScheme="dark">
      <Surface tone="panel">theme</Surface>
    </NimiThemeProvider>,
  );

  expect(html).toMatch(/nimi-surface--panel/);
});

test('generated primitive contract and typography classes are exported', () => {
  expect(NIMI_PRIMITIVE_CONTRACT['primitive.action']).toBeTruthy();
  expect(TYPOGRAPHY_TOKEN_CLASS.pageTitle).toBe('nimi-type--page-title');
  expect(TYPOGRAPHY_TOKEN_CLASS.bodySm).toBe('nimi-type--body-sm');
});
