/* Pre-seeded scenario — the "simulated memory" of the cradle.
 *
 * Decision (locked with the product owner): the prototype does not persist
 * anything. Continuity is faked honestly — the scenario pre-seeds prior
 * history (conversations, grants, footprints) so the base agent appears to
 * remember you. Every byte below is fictional demo content.
 */

import type { Scenario } from './types';

export const SCENARIO: Scenario = {
  persona: {
    name: '林澈',
    id: 'u_7f3a',
    role: '生态居民 · 早期体验者',
  },
  agent: {
    name: 'Nimi',
    kind: '基座伴侣 agent',
  },
  worlds: [
    {
      id: 'starport',
      name: '星港',
      en: 'Starport',
      kind: '社交场景',
      presence: '12 位居民在场',
      hue: '#45b8d6',
      blurb: '生态居民的公共停泊港。大厅、集市与临时聚会的默认集合点。',
    },
    {
      id: 'echo-vale',
      name: '回声谷',
      en: 'Echo Vale',
      kind: '游戏世界',
      presence: '赛季进行中',
      hue: '#8b7cf6',
      blurb: '声音即地形的探索世界。上季你完成了「低语回廊」的三段回声解谜。',
    },
    {
      id: 'atelier',
      name: '工坊',
      en: 'Atelier',
      kind: '服务场所',
      presence: '预约制',
      hue: '#d97706',
      blurb: '把想法做成实物的协作空间。你预约的「头像实体化」服务排期中。',
    },
  ],
  seededGrants: [
    {
      id: 'g-world-write',
      title: '生态足迹写入',
      scope: 'Desktop → 生态共享 · 可写足迹、可被其他应用读取',
      from: 'Desktop',
      to: '生态共享',
      status: 'active',
      seeded: true,
    },
    {
      id: 'g-presence-read',
      title: '在场状态读取',
      scope: 'Zhiyu → 生态共享 · 只读你在各世界的在场状态',
      from: 'Zhiyu',
      to: '生态共享',
      status: 'active',
      seeded: true,
    },
    {
      id: 'g-context-carry',
      title: 'context 携带',
      scope: 'Nimi · Desktop → Zhiyu · 仅本次会话摘要的只读投影，可撤销',
      from: 'Nimi (基座 agent)',
      to: 'Zhiyu',
      status: 'revoked',
      seeded: false,
    },
  ],
  seededLedger: [
    {
      id: '1:op:003',
      epoch: 1,
      kind: 'system',
      title: '基座会话建立',
      detail: '身份 u_7f3a 载入，基座 agent Nimi 进入在场状态。',
      actors: ['林澈', 'Nimi'],
      result: 'info',
      at: 'T+00:03',
      history: true,
    },
    {
      id: '1:op:005',
      epoch: 1,
      kind: 'delegation',
      title: '授权 · 生态足迹写入',
      detail: '你允许 Desktop 向生态共享写入足迹，其他应用可按授权读取。',
      actors: ['林澈', 'Desktop'],
      result: 'committed',
      at: 'T+00:05',
      history: true,
    },
    {
      id: '1:op:008',
      epoch: 1,
      kind: 'flow',
      title: '足迹 · 星港',
      detail: 'Desktop 提交了一条生态足迹：抵达星港大厅。',
      actors: ['Desktop', '生态共享'],
      result: 'committed',
      at: 'T+00:08',
      history: true,
    },
    {
      id: '1:op:011',
      epoch: 1,
      kind: 'delegation',
      title: '授权 · 在场状态读取',
      detail: '你允许 Zhiyu 只读你在各世界的在场状态。',
      actors: ['林澈', 'Zhiyu'],
      result: 'committed',
      at: 'T+00:11',
      history: true,
    },
  ],
  seededChat: [
    {
      id: 'm1',
      who: 'agent',
      text: '欢迎回来。上次我们在回声谷的「低语回廊」停下——第三段回声还差最后一步。',
      at: 'T+00:04',
    },
    {
      id: 'm2',
      who: 'user',
      text: '我记得。那个谜题的提示是不是藏在星港的集市里？',
      at: 'T+00:06',
    },
    {
      id: 'm3',
      who: 'agent',
      text: '对，集市的回声商贩。我建议先把回声谷收录进你的生态足迹，这样 Tester 的世界巡游也能看到它。',
      at: 'T+00:07',
    },
    {
      id: 'm4',
      who: 'user',
      text: '好主意。另外等会儿我想在 Zhiyu 里整理一下解谜思路。',
      at: 'T+00:09',
    },
  ],
  seededFootprints: [
    { worldId: 'starport', note: '抵达星港大厅', at: 'T+00:08' },
  ],
  carrySummary: {
    title: '会话摘要 · 回声谷解谜计划',
    body: '目标：完成「低语回廊」第三段回声。线索：星港集市的回声商贩。下一步：把谷内地形按声源方位重排，再回星港核对提示。',
  },
  openingOpSeq: 12,
};
