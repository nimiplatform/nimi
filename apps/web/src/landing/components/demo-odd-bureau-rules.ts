/**
 * Landing-owned port of the Odd Bureau (奇物局) fixed play rules
 * (nimiapp-odd-bureau src/odd-bureau/play-rules.ts + game.ts hitProp). The
 * app executes these locally too; the preview replays the same rules on
 * authored plans so machine runs, promises, and accusations behave exactly as
 * in the app. Only the AI-generated inputs (plans, mysteries, replies) are
 * mock content here.
 */

export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Prop = { id: string; label: string; box: Box };

export type MachineOp = 'source' | 'echo' | 'reverse' | 'raise' | 'slow' | 'store';
export type Note = { pitch: number; beats: number };
export type MachineNode = { objectId: string; op: MachineOp; melody: number[]; line: string };
export type MachinePlan = { title: string; invitation: string; nodes: MachineNode[] };
export type MachineTrace = { objectId: string; notes: Note[] };
export type MachineRun = { path: string[]; notes: Note[]; trace: MachineTrace[]; cost: number; receiver: string };
export type MachineState = { path: string[]; stored: Record<string, Note[]>; runs: number; solved: boolean; lastRun: MachineRun | null };
export type MachineRound = { kind: 'machine'; plan: MachinePlan; state: MachineState };

export const NOTE_NAMES = ['咚', '叮', '铃', '啵', '铛'] as const;
export const OP_COPY: Record<MachineOp, { name: string; rule: string }> = {
  source: { name: '发声', rule: '每次启动，送出自己的小旋律' },
  echo: { name: '回声', rule: '把收到的旋律完整重复一次' },
  reverse: { name: '倒放', rule: '把收到的声音按相反顺序送出' },
  raise: { name: '变亮', rule: '每个音向上走两级，到顶后从头开始' },
  slow: { name: '慢长', rule: '每个声音的时长翻倍，最多四拍' },
  store: { name: '装起来', rule: '保存收到的声音；最多装 32 个音' },
};

export function initialMachine(): MachineState {
  return { path: [], stored: {}, runs: 0, solved: false, lastRun: null };
}

export function editMachinePath(plan: MachinePlan, path: readonly string[], id: string): string[] {
  const node = plan.nodes.find((n) => n.objectId === id);
  if (!node) throw new Error('没有这个器件。');
  if (node.op === 'source') return [id];
  if (!path.length) throw new Error('先点一个「发声」物品作为起点。');
  const existing = path.indexOf(id);
  if (existing >= 0) return path.slice(0, existing + 1);
  const previous = plan.nodes.find((n) => n.objectId === path[path.length - 1]);
  return [...(previous?.op === 'store' ? path.slice(0, -1) : path), id];
}

export function lineCost(path: readonly string[], props: readonly Prop[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const a = props.find((p) => p.id === path[i - 1])?.box;
    const b = props.find((p) => p.id === path[i])?.box;
    if (!a || !b) throw new Error('线路经过了照片之外的物品。');
    cost += Math.max(1, Math.round(Math.hypot((a.x1 + a.x2 - b.x1 - b.x2) / 2, (a.y1 + a.y2 - b.y1 - b.y2) / 2) * 10));
  }
  return cost;
}

export function simulateMachine(plan: MachinePlan, props: readonly Prop[], path: readonly string[]): MachineRun {
  if (path.length < 2 || path.length > plan.nodes.length || new Set(path).size !== path.length) throw new Error('连接发声器和容器，每件物品只经过一次。');
  const nodes = path.map((id) => {
    const node = plan.nodes.find((n) => n.objectId === id);
    if (!node) throw new Error('线路包含未知物品。');
    return node;
  });
  if (nodes[0]!.op !== 'source' || nodes.at(-1)!.op !== 'store') throw new Error('线路需要从「发声」出发，以「装起来」结束。');
  let notes: Note[] = [];
  const trace: MachineTrace[] = [];
  nodes.forEach((node, i) => {
    if (i > 0 && node.op === 'source') throw new Error('一条线只能有一个发声起点。');
    if (i < nodes.length - 1 && node.op === 'store') throw new Error('容器是这一条线的终点。');
    if (node.op === 'source') notes = node.melody.map((pitch) => ({ pitch, beats: 1 }));
    if (node.op === 'echo') notes = [...notes, ...notes].map((n) => ({ ...n }));
    if (node.op === 'reverse') notes = [...notes].reverse();
    if (node.op === 'raise') notes = notes.map((n) => ({ ...n, pitch: (n.pitch + 2) % 5 }));
    if (node.op === 'slow') notes = notes.map((n) => ({ ...n, beats: Math.min(4, n.beats * 2) }));
    if (notes.length > 32) throw new Error('声音太多啦，这条线一次最多传递 32 个音。');
    trace.push({ objectId: node.objectId, notes: notes.map((n) => ({ ...n })) });
  });
  return { path: [...path], notes, trace, cost: lineCost(path, props), receiver: path.at(-1)! };
}

export function sameNotes(a: readonly Note[], b: readonly Note[]): boolean {
  return a.length === b.length && a.every((n, i) => n.pitch === b[i]!.pitch && n.beats === b[i]!.beats);
}

export function machineChallenge(plan: MachinePlan, props: readonly Prop[]): MachineRun {
  const sources = plan.nodes.filter((n) => n.op === 'source');
  const stores = plan.nodes.filter((n) => n.op === 'store');
  const transforms = plan.nodes.filter((n) => !['source', 'store'].includes(n.op));
  const choices: MachineRun[] = [];
  for (const source of sources) for (const store of stores) for (const middle of transforms) {
    for (const tail of [null, ...transforms.filter((n) => n !== middle)]) {
      const run = simulateMachine(plan, props, [source.objectId, middle.objectId, ...(tail ? [tail.objectId] : []), store.objectId]);
      const original = source.melody.map((pitch) => ({ pitch, beats: 1 }));
      if (!sameNotes(original, run.notes)) choices.push(run);
    }
  }
  choices.sort((a, b) => b.path.length - a.path.length || a.cost - b.cost);
  if (!choices.length) throw new Error('这台机器还缺一个有效的改造器、发声器或容器，请重新生成。');
  return choices[0]!;
}

export function runMachine(plan: MachinePlan, props: readonly Prop[], state: MachineState): MachineState {
  const run = simulateMachine(plan, props, state.path);
  const goal = machineChallenge(plan, props);
  const stored = [...(state.stored[run.receiver] ?? []), ...run.notes];
  if (stored.length > 32) throw new Error('这个容器装不下了，先把声音倒出来或清空。');
  return {
    ...state,
    runs: state.runs + 1,
    stored: { ...state.stored, [run.receiver]: stored },
    lastRun: run,
    solved: state.solved || (run.receiver === goal.receiver && run.cost <= goal.cost && sameNotes(run.notes, goal.notes)),
  };
}

export const TASKS = ['story', 'reading', 'stage'] as const;
export type StrikeTask = typeof TASKS[number];
export const TASK_NAMES: Record<StrikeTask, string> = { story: '写故事', reading: '朗读', stage: '布置现场' };
export type StrikeOffer = { task: StrikeTask; needsCredit: boolean; needsRest: string | null };
export type StrikePerson = { objectId: string; persona: string; offers: StrikeOffer[] };
export type StrikePlan = { title: string; situation: string; people: StrikePerson[] };
export type PromiseAction = { kind: 'rest'; objectId: string } | { kind: 'credit'; objectId: string } | { kind: 'assign'; objectId: string; task: StrikeTask };
export type PromiseState = { rest: string | null; credit: string | null; tasks: Partial<Record<StrikeTask, string>>; promises: PromiseAction[] };
export type StrikeState = { promises: PromiseAction[]; journal: string[]; performance: string[] | null; curtain: number };
export type StrikeRound = { kind: 'strike'; plan: StrikePlan; state: StrikeState };
export type PlayRound = MachineRound | StrikeRound;

export function commitPromises(plan: StrikePlan, previous: readonly PromiseAction[], proposed: readonly PromiseAction[]): PromiseState {
  const state: PromiseState = { rest: null, credit: null, tasks: {}, promises: [] };
  const apply = (action: PromiseAction) => {
    const person = plan.people.find((p) => p.objectId === action.objectId);
    if (!person) throw new Error('这件物品没有参加故事会。');
    const working = Object.values(state.tasks).filter((id) => id === person.objectId).length;
    if (action.kind === 'rest') {
      if (state.rest) throw new Error('唯一的休假名额已经答应给别人了。');
      if (working || state.credit === person.objectId) throw new Error('这位已经接受工作或署名，不能再批准休假。');
      state.rest = person.objectId;
    } else if (action.kind === 'credit') {
      if (state.credit) throw new Error('唯一的署名已经许出，不能转送给别人。');
      if (state.rest === person.objectId) throw new Error('署名需要交给参加演出的伙伴。');
      state.credit = person.objectId;
    } else {
      if (!TASKS.includes(action.task)) throw new Error('没有这项工作。');
      if (state.tasks[action.task]) throw new Error('这项工作已经有人答应承担。');
      if (state.rest === person.objectId) throw new Error('已经批准休假的伙伴不能再被安排工作。');
      if (working >= 2) throw new Error('一件物品最多承担两份工作。');
      const offer = person.offers.find((o) => o.task === action.task);
      if (!offer) throw new Error('这位没有答应做这份工作。');
      if (offer.needsCredit && state.credit !== person.objectId) throw new Error('这份工作需要先兑现它的署名条件。');
      if (offer.needsRest && state.rest !== offer.needsRest) throw new Error('这份工作需要先批准它指定的伙伴休息。');
      state.tasks[action.task] = person.objectId;
    }
    state.promises.push(action);
  };
  previous.forEach(apply);
  // A reviewed multi-part proposal grants allocations before assigning work.
  const order = { rest: 0, credit: 1, assign: 2 };
  [...proposed].sort((a, b) => order[a.kind] - order[b.kind]).forEach(apply);
  return state;
}

export function strikeReady(state: PromiseState): boolean {
  return !!state.rest && !!state.credit && TASKS.every((task) => !!state.tasks[task]) && Object.values(state.tasks).includes(state.credit);
}

export function findStrikeSolution(plan: StrikePlan, existing: readonly PromiseAction[] = []): PromiseAction[] | null {
  const ids = plan.people.map((p) => p.objectId);
  const options = TASKS.map((task) => plan.people.filter((p) => p.offers.some((o) => o.task === task)).map((p) => p.objectId));
  for (const rest of ids) for (const credit of ids) {
    if (rest === credit) continue;
    for (const story of options[0]!) for (const reading of options[1]!) for (const stage of options[2]!) {
      const work = [story, reading, stage];
      if (work.includes(rest) || !work.includes(credit) || new Set(work).size === 1) continue;
      const actions: PromiseAction[] = [
        { kind: 'rest', objectId: rest },
        { kind: 'credit', objectId: credit },
        { kind: 'assign', objectId: story, task: 'story' },
        { kind: 'assign', objectId: reading, task: 'reading' },
        { kind: 'assign', objectId: stage, task: 'stage' },
      ];
      if (!existing.every((a) => actions.some((b) => a.kind === b.kind && a.objectId === b.objectId && (a.kind !== 'assign' || (b.kind === 'assign' && a.task === b.task))))) continue;
      try { if (strikeReady(commitPromises(plan, [], actions))) return actions; } catch { /* This allocation does not satisfy the declared wishes. */ }
    }
  }
  return null;
}

export function actionText(action: PromiseAction, props: readonly Prop[]): string {
  const name = props.find((p) => p.id === action.objectId)?.label ?? '物品';
  return action.kind === 'rest' ? `批准${name}休息` : action.kind === 'credit' ? `把唯一署名给${name}` : `请${name}${TASK_NAMES[action.task]}`;
}

export function offerText(offer: StrikeOffer, props: readonly Prop[]): string {
  const conditions = [offer.needsCredit ? '要有我的署名' : '', offer.needsRest ? `先让${props.find((p) => p.id === offer.needsRest)?.label}休息` : ''].filter(Boolean);
  return conditions.length ? conditions.join('；') : '我愿意直接帮忙';
}

/** Image-stage clicks use the image's own aspect ratio, not an object-fit container. */
export function hitProp(props: readonly Prop[], x: number, y: number): Prop | undefined {
  return props
    .filter(({ box: b }) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2)
    .sort((a, b) => (a.box.x2 - a.box.x1) * (a.box.y2 - a.box.y1) - (b.box.x2 - b.box.x1) * (b.box.y2 - b.box.y1))[0];
}

/**
 * Stand-in for the app's 管家 free-text proposal interpretation (Runtime
 * text.generate). Reads object names and the fixed action words out of the
 * player's sentence; anything else yields an empty proposal with a hint, the
 * way the app's prompt instructs the model to behave.
 */
export function interpretProposalLocally(plan: StrikePlan, props: readonly Prop[], message: string): { reply: string; actions: PromiseAction[] } {
  const actions: PromiseAction[] = [];
  const clauses = message.split(/[，,。；;、\n]+/).map((part) => part.trim()).filter(Boolean);
  for (const clause of clauses) {
    const prop = props.find((p) => clause.includes(p.label));
    if (!prop) continue;
    if (/休息|休假|放假/.test(clause)) actions.push({ kind: 'rest', objectId: prop.id });
    else if (/署名|挂名|名字/.test(clause)) actions.push({ kind: 'credit', objectId: prop.id });
    else if (/写故事|写/.test(clause)) actions.push({ kind: 'assign', objectId: prop.id, task: 'story' });
    else if (/朗读|读/.test(clause)) actions.push({ kind: 'assign', objectId: prop.id, task: 'reading' });
    else if (/布置|现场|舞台/.test(clause)) actions.push({ kind: 'assign', objectId: prop.id, task: 'stage' });
    if (actions.length === 5) break;
  }
  if (!actions.length) {
    const first = plan.people[0];
    const name = props.find((p) => p.id === first?.objectId)?.label ?? '一位伙伴';
    return { reply: `我还没听出要安排谁做什么。可以试试「让${name}休息」或者「请${name}写故事」这样的说法。`, actions: [] };
  }
  return { reply: `我把你的话整理成了 ${actions.length} 项安排。确认之前，先看看它们对休假、署名和三份工作的影响。`, actions };
}
