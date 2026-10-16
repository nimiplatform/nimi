import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';

export type WorldReadingSection = 'description' | 'rules' | 'systems' | 'levels' | 'taboos' | 'topology' | 'causality' | 'languages' | 'history';

export type WorldReadingEntry = {
  id: string;
  section: WorldReadingSection;
  /** Canonical flattened content in source order, deduplicated. */
  text: string[];
  /** Dated history events expose their explicit time node for the timeline layout. */
  time?: string;
  /** A short heading-like label promoted out of the flattened content. */
  title?: string;
  /** The flattened content minus the promoted time node and title. */
  body: string[];
};

export type WorldReadingBlock = {
  kind: 'heading' | 'paragraph';
  text: string;
};

const texts = (...values: (string | null | undefined)[]) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];

const HEADING_MAX_LENGTH = 32;
const HEADING_TAIL_PUNCTUATION = /[。！？!?；;：:，,、.…]$/;

// Only short single-line labels without sentence punctuation read as headings;
// a lone label with no following prose stays body text.
const looksLikeHeading = (value: string): boolean => (
  value.length > 0
  && value.length <= HEADING_MAX_LENGTH
  && !/[\r\n]/.test(value)
  && !HEADING_TAIL_PUNCTUATION.test(value)
);

// Long-form prose keeps its own line structure: an isolated short line that
// introduces a following paragraph renders as a content heading, everything
// else stays a paragraph. No text is added, reordered or removed.
export function worldReadingProseBlocks(text: string): WorldReadingBlock[] {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.map((line, index) => {
    const prev = index > 0 ? lines[index - 1] : undefined;
    const next = index < lines.length - 1 ? lines[index + 1] : undefined;
    const isHeading = looksLikeHeading(line)
      && (prev === undefined || !looksLikeHeading(prev))
      && next !== undefined
      && !looksLikeHeading(next);
    return { kind: isHeading ? 'heading' : 'paragraph', text: line };
  });
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r013
// The public projection can repeat a full paragraph as both name and description.
// Such prose always stays body text: only heading-like labels are promoted to
// titles, and the flattened text keeps every supplied content exactly once.
const buildEntry = (
  section: WorldReadingSection,
  id: string,
  text: string[],
  options?: { time?: string; allowTitle?: boolean },
): WorldReadingEntry | null => {
  if (!text.length) return null;
  let body = text;
  let time: string | undefined;
  let title: string | undefined;
  if (options?.time && body[0] === options.time) {
    time = body[0];
    body = body.slice(1);
  }
  if (options?.allowTitle !== false && body.length > 1 && looksLikeHeading(body[0] ?? '')) {
    title = body[0];
    body = body.slice(1);
  }
  return { id, section, text, time, title, body };
};

export function worldReadingEntries(world: WorldDetailData, semantic: WorldSemanticData, history: WorldHistoryBundle): WorldReadingEntry[] {
  const entries: WorldReadingEntry[] = [];
  const add = (entry: WorldReadingEntry | null) => {
    if (entry) entries.push(entry);
  };
  add(buildEntry('description', 'description', texts(world.tagline, world.motto, world.overview, world.description, world.setting), { allowTitle: false }));
  const overview = texts(world.name, world.tagline, world.motto, world.overview, world.description);
  add(buildEntry('rules', 'operation', texts(semantic.operationTitle, semantic.operationDescription).filter((text) => !overview.includes(text))));
  const systemPrinciples = new Set(semantic.powerSystems.flatMap((system) => system.rules.map((rule) => rule.trim())));
  semantic.operationRules.forEach((rule, index) => add(buildEntry('rules', `rule-${index}`,
    texts(rule.title, rule.value).filter((text) => !systemPrinciples.has(text)))));
  semantic.powerSystems.forEach((system, index) => add(buildEntry('systems', `system-${index}`, texts(
    system.name, system.description, ...system.rules,
    ...system.levels.map((level) => texts(level.name, level.description, level.extra).join('\n')),
  ))));
  semantic.standaloneLevels.forEach((level, index) => add(buildEntry('levels', `level-${index}`, texts(level.name, level.description, level.extra))));
  semantic.taboos.forEach((taboo, index) => add(buildEntry('taboos', `taboo-${index}`, texts(taboo.name, taboo.description, taboo.severity))));
  if (semantic.topology) {
    const topology = semantic.topology;
    add(buildEntry('topology', 'topology', texts(topology.type, topology.boundary, topology.dimensions,
      ...topology.realms.map((realm) => texts(realm.name, realm.description, realm.accessibility).join('\n')))));
  }
  // Boolean/number causality fields have localized labels in the reader itself.
  add(buildEntry('causality', 'causality', texts(semantic.causality?.type)));
  semantic.languages.forEach((language, index) => add(buildEntry('languages', `language-${index}`, texts(
    language.name, language.category, language.description, language.writingSample, language.spokenSample,
  ))));
  history.items.forEach((event) => add(buildEntry('history', `event-${event.id}`, texts(
    event.time, event.title, event.summary, event.description, event.cause, event.process, event.result,
  ), { time: event.time.trim() || undefined })));
  semantic.worldviewEvents.forEach((event) => add(buildEntry('history', `worldview-${event.id}`, texts(event.title, event.summary, event.createdAt))));
  semantic.worldviewSnapshots.forEach((snapshot) => add(buildEntry('history', `snapshot-${snapshot.id}`, texts(snapshot.versionLabel, snapshot.summary, snapshot.createdAt))));
  return entries;
}
