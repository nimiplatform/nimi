import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import {
  Button,
  NimiThemeProvider,
  SearchField,
  SelectField,
  SettingsCard,
  SettingsPageShell,
  SettingsSectionTitle,
  SidebarItem,
  SidebarShell,
  StatusBadge,
  Surface,
  cn,
} from '../src/index.js';

test('shared primitives render sidebar structure', () => {
  const html = renderToStaticMarkup(
    <SidebarShell data-testid="sidebar">
      <SidebarItem kind="nav-row" label="Settings" />
    </SidebarShell>,
  );

  expect(html).toMatch(/aside/);
  expect(html).toMatch(/Settings/);
  expect(html).toMatch(/button/);
});

test('surface, button, field, and status primitives render', () => {
  const html = renderToStaticMarkup(
    <div>
      <Surface tone="card">card</Surface>
      <SettingsCard>settings-card</SettingsCard>
      <SettingsPageShell contentClassName="px-2 py-2">
        <SettingsSectionTitle description="Shared settings section">Preferences</SettingsSectionTitle>
      </SettingsPageShell>
      <Button tone="primary">save</Button>
      <SearchField placeholder="Search" />
      <StatusBadge tone="success">ready</StatusBadge>
    </div>,
  );

  expect(html).toMatch(/card/);
  expect(html).toMatch(/settings-card/);
  expect(html).toMatch(/Preferences/);
  expect(html).toMatch(/Shared settings section/);
  expect(html).toMatch(/save/);
  expect(html).toMatch(/Search/);
  expect(html).toMatch(/ready/);
});

test('select field ignores empty option values reserved by Radix', () => {
  expect(() => renderToStaticMarkup(
    <SelectField
      value=""
      placeholder="Select a connector"
      options={[
        { value: '', label: 'Invalid empty option' },
        { value: 'connector.openai', label: 'OpenAI' },
      ]}
    />,
  )).not.toThrow();
});

test('theme provider renders children', () => {
  const html = renderToStaticMarkup(
    <NimiThemeProvider accentPack="relay-accent" defaultScheme="dark">
      <Surface tone="panel">theme</Surface>
    </NimiThemeProvider>,
  );

  expect(html).toMatch(/theme/);
});

test('cn utility merges classes correctly', () => {
  expect(cn('foo', 'bar')).toBe('foo bar');
  expect(cn('p-4', false, null, 'text-sm')).toBe('p-4 text-sm');
  expect(cn('p-4', 'p-6')).toBe('p-6');
});
