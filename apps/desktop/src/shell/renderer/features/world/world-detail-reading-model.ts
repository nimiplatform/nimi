import type { WorldDetailData, WorldHistoryBundle, WorldSemanticData } from './world-detail-types.js';

export type WorldReadingEntry = {
  id: string;
  section: 'description' | 'rules' | 'systems' | 'levels' | 'taboos' | 'topology' | 'causality' | 'languages' | 'history';
  text: string[];
};

const texts = (...values: (string | null | undefined)[]) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];

// @nimi-authority: rule.nimi.desktop.shell-ui.r013
// The public projection can repeat a full paragraph as both name and description.
// Preserve its prose once, as body text, rather than interpreting it as a heading.
export function worldReadingEntries(world: WorldDetailData, semantic: WorldSemanticData, history: WorldHistoryBundle): WorldReadingEntry[] {
  const entries: WorldReadingEntry[] = [];
  const add = (section: WorldReadingEntry['section'], id: string, text: string[]) => {
    if (text.length) entries.push({ id, section, text });
  };
  add('description', 'description', texts(world.tagline, world.motto, world.overview, world.description, world.setting));
  const overview = texts(world.name, world.tagline, world.motto, world.overview, world.description);
  add('rules', 'operation', texts(semantic.operationTitle, semantic.operationDescription).filter((text) => !overview.includes(text)));
  const systemPrinciples = new Set(semantic.powerSystems.flatMap((system) => system.rules.map((rule) => rule.trim())));
  semantic.operationRules.forEach((rule, index) => add('rules', `rule-${index}`,
    texts(rule.title, rule.value).filter((text) => !systemPrinciples.has(text))));
  semantic.powerSystems.forEach((system, index) => add('systems', `system-${index}`, texts(
    system.name, system.description, ...system.rules,
    ...system.levels.map((level) => texts(level.name, level.description, level.extra).join('\n')),
  )));
  semantic.standaloneLevels.forEach((level, index) => add('levels', `level-${index}`, texts(level.name, level.description, level.extra)));
  semantic.taboos.forEach((taboo, index) => add('taboos', `taboo-${index}`, texts(taboo.name, taboo.description, taboo.severity)));
  if (semantic.topology) {
    const topology = semantic.topology;
    add('topology', 'topology', texts(topology.type, topology.boundary, topology.dimensions,
      ...topology.realms.map((realm) => texts(realm.name, realm.description, realm.accessibility).join('\n'))));
  }
  // Boolean/number causality fields have localized labels in the reader itself.
  add('causality', 'causality', texts(semantic.causality?.type));
  semantic.languages.forEach((language, index) => add('languages', `language-${index}`, texts(
    language.name, language.category, language.description, language.writingSample, language.spokenSample,
  )));
  history.items.forEach((event) => add('history', `event-${event.id}`, texts(
    event.time, event.title, event.summary, event.description, event.cause, event.process, event.result,
  )));
  semantic.worldviewEvents.forEach((event) => add('history', `worldview-${event.id}`, texts(event.title, event.summary, event.createdAt)));
  semantic.worldviewSnapshots.forEach((snapshot) => add('history', `snapshot-${snapshot.id}`, texts(snapshot.versionLabel, snapshot.summary, snapshot.createdAt)));
  return entries;
}
