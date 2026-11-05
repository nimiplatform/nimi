import assert from 'node:assert/strict';
import test from 'node:test';
import { extractI18nCandidates } from '../scripts/lib/i18n-audit-source.mjs';

const codeOnlyCases = [
  ['heading filter',
    'const headings = nodes.filter((node) => Number(node.dataset.worldHeading) <= 3);'],
  ['meeting scene',
    'const view = <>{multiple ? <div /> : scene ? <h3>{scene.title}</h3> : null}</>;'],
  ['contact tabs',
    "const view = <>{tab === 'friends' ? <></> : tab === 'received' ? <></> : null}</>;"],
  ['readonly return type',
    'export type Resolver = (displayName: string) => Readonly<{ appId: string }> | null;'],
  ['explore sections',
    "const view = <>{section === 'partners' ? <PartnerDirectory /> : characters ? <CharacterDiscovery /> : <WorldDiscovery />}</>;"],
  ['attachment picker',
    "const view = <Composer attachmentAdapter={{ openPicker: async () => admission !== 'allowed' ? null : new Promise<readonly Attachment[] | null>(resolve => { resolve(null); }) }} />;"],
  ['gallery filters',
    "const view = <EmptyState action={empty ? <Button /> : filter !== 'all' ? <Button /> : undefined} />;"],
];

for (const [name, source] of codeOnlyCases) {
  test(`i18n audit does not mistake ${name} for interface copy`, () => {
    assert.deepEqual(extractI18nCandidates(source, 'fixture.tsx'), []);
  });
}

test('i18n audit finds actual JSX text and all audited attributes beside translated content', () => {
  const source = [
    "const view = <><h1>{t('Page.heading')}</h1><button>Save as draft</button>",
    '  <Input placeholder="@handle" aria-label="Account handle" title="Find a friend"',
    '    label="Account" description="Enter a complete handle" />',
    "  <p>{t('Page.copy', { defaultValue: 'Localized fallback' })} Untranslated sibling</p>",
    '</>;',
  ].join('\n');
  assert.deepEqual(extractI18nCandidates(source, 'fixture.tsx'), [
    { text: 'Save as draft', line: 1 },
    { text: '@handle', line: 2 },
    { text: 'Account handle', line: 2 },
    { text: 'Find a friend', line: 2 },
    { text: 'Account', line: 3 },
    { text: 'Enter a complete handle', line: 3 },
    { text: 'Untranslated sibling', line: 4 },
  ]);
});

test('i18n audit preserves multiline copy and reports its first visible line', () => {
  const source = 'const view = <p>\n  Follow-up\n  chain\n</p>;';
  assert.deepEqual(extractI18nCandidates(source, 'fixture.tsx'), [
    { text: 'Follow-up chain', line: 2 },
  ]);
});

test('i18n audit ignores comments, ordinary source strings and translated JSX expressions', () => {
  const source = [
    '// <button title="Not a title">Not copy</button>',
    'const example = \'<input placeholder="Not a placeholder" />\';',
    'const view = <>{/* Internal comment */}<Input placeholder={t("Relationship.handlePlaceholder")} />',
    "  <p>{i18n.t('Page.message')}</p></>;",
  ].join('\n');
  assert.deepEqual(extractI18nCandidates(source, 'fixture.tsx'), []);
  assert.deepEqual(extractI18nCandidates('const label = "Internal name";', 'fixture.ts'), []);
});

test('i18n audit retains quoted HTML attribute checks', () => {
  assert.deepEqual(extractI18nCandidates('<input\n placeholder="Your name" aria-label="Name">', 'index.html'), [
    { text: 'Your name', line: 2 },
    { text: 'Name', line: 2 },
  ]);
});

test('i18n audit fails on invalid TSX instead of silently passing an unparsed file', () => {
  assert.throws(() => extractI18nCandidates('const view = <div><span></div>;', 'broken.tsx'), /broken\.tsx:\d+:/u);
});
