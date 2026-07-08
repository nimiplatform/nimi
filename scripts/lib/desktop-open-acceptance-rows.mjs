export const DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH =
  '.nimi/local/plan/2026-07-08-desktop-running-open-intent-standard/acceptance-matrix.md';

const SECTION_TABLE_SLUGS = new Map([
  ['Product Acceptance', 'product'],
  ['State Acceptance', 'state'],
  ['Target Acceptance', 'target'],
  ['Unsupported V1 Target Acceptance', 'unsupported-v1'],
  ['Descriptor And Bridge Acceptance', 'descriptor-bridge'],
  ['Owner Acceptance', 'owner'],
  ['Failure Acceptance', 'failure'],
]);

const HEADER_LABELS = new Set([
  'Desktop State',
  'Failure',
  'Field Family',
  'Input Intent',
  'Requirement',
  'Target',
]);

export function desktopOpenAcceptanceRowId(tableSlug, label) {
  return `${tableSlug}.${slugFirstColumn(label)}`;
}

export function extractDesktopOpenAcceptanceRows(markdown) {
  const rows = [];
  let currentTableSlug = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentTableSlug = SECTION_TABLE_SLUGS.get(heading[1]) || null;
      continue;
    }

    if (!currentTableSlug || !line.trim().startsWith('|')) {
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length === 0 || isSeparatorRow(cells) || HEADER_LABELS.has(cells[0])) {
      continue;
    }

    const label = stripMarkdown(cells[0]).trim();
    if (!label) {
      continue;
    }

    rows.push({
      rowId: desktopOpenAcceptanceRowId(currentTableSlug, label),
      tableSlug: currentTableSlug,
      label,
      cells,
    });
  }

  return rows;
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => stripMarkdown(cell).trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function slugFirstColumn(value) {
  return stripMarkdown(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/<[^>]*>/g, '')
    .replace(/['"{}[\]().,:;/\\]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
