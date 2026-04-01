/**
 * Pre-authored character encounter scripts — SJ-SHELL-009:7
 *
 * Each script is tied to a primaryAgentId from world-catalog.yaml.
 * Opening lines are dilemmas/questions, NOT self-introductions — SJ-SHELL-009:2
 * Preview tags: era + theme direction — SJ-SHELL-009:3
 */

export type EncounterScript = {
  /** Matches world-catalog.yaml primaryAgentIds */
  agentId: string;
  worldId: string;
  /** Opening line — must be a dilemma, not self-introduction */
  openingLine: string;
  /** 1-2 preview tags: era + theme direction */
  previewTags: [string] | [string, string];
  /** Display name of the historical figure */
  characterName: string;
};

export const ENCOUNTER_SCRIPTS: EncounterScript[] = [
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
    openingLine: '他们说女子不能称帝。我想听听你的看法——你觉得，规矩是用来遵守的，还是用来打破的？',
    previewTags: ['大唐', '宫廷风云'],
    characterName: '武则天',
  },
  {
    agentId: 'agent-su-dongpo',
    worldId: 'world-northern-song',
    openingLine: '被贬到黄州来，什么都没有了。可我竟然写了《赤壁赋》。你有没有过这种感觉——越是绝境，越能看清楚什么是真正重要的？',
    previewTags: ['北宋', '文学人生'],
    characterName: '苏轼',
  },
];

/** Maximum number of encounters to show in the first-visit sequence — SJ-SHELL-009:5 */
export const MAX_ENCOUNTER_COUNT = 3;
