import { getActiveCatalogEntries } from '@renderer/data/world-catalog.js';

export type EncounterScript = {
  agentId: string;
  worldId: string;
  openingLine: string;
  previewTags: [string] | [string, string];
  characterName: string;
};

const ENCOUNTER_SCRIPT_CANDIDATES: EncounterScript[] = [
  {
    agentId: 'agent-zhuge-liang',
    worldId: 'world-three-kingdoms',
    openingLine: '三拨人来请我出山了。你说，我该不该去？',
    previewTags: ['三国', '军事谋略'],
    characterName: '诸葛亮',
  },
  {
    agentId: 'agent-wu-zetian',
    worldId: 'world-tang-dynasty',
    openingLine: '他们说女子不能称帝。我想听听你的看法，你觉得规矩是用来遵守的，还是用来打破的？',
    previewTags: ['大唐', '宫廷风云'],
    characterName: '武则天',
  },
  {
    agentId: 'agent-su-dongpo',
    worldId: 'world-northern-song',
    openingLine: '被贬到黄州来，什么都没有了。可我竟然写出了《赤壁赋》。你有没有过这种感觉，越是绝境，越能看清什么是真正重要的？',
    previewTags: ['北宋', '文学人生'],
    characterName: '苏轼',
  },
];

export const MAX_ENCOUNTER_COUNT = 3;

export function getAvailableEncounterScripts(): EncounterScript[] {
  const catalogEntries = getActiveCatalogEntries();
  if (catalogEntries.length === 0) {
    return [];
  }

  return ENCOUNTER_SCRIPT_CANDIDATES.filter((script) => {
    const world = catalogEntries.find((entry) => entry.worldId === script.worldId);
    return Boolean(world && world.primaryAgentIds.includes(script.agentId));
  }).slice(0, MAX_ENCOUNTER_COUNT);
}
