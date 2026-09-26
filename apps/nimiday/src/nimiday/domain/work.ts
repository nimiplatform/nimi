import { stillInCare } from './care.js';
import { agentCircleName } from './agent-labels.js';
import { isActive, isOverdue } from './reminders.js';
import { CHAT_SKILL } from './skills.js';
import { attentionOrder, coverageGaps, type ActivityCoverage, type SourceChange } from './sources.js';
import { addDays, DAY_MS, toLocalDate, toLocalTime, weekdayOf } from './time.js';
import { toolDefinitions } from './tools.js';
import type { CareCircle, DayState, Language, LifeItem, MaterialKind, SkillDefinition } from './types.js';

/** Mirrors the public independent Agent work bounds: 8 KiB instructions, 16 KiB per source, 64 KiB total. */
export const WORK_LIMITS = Object.freeze({
  instructions: 8192,
  sourceContent: 16384,
  sources: 16,
  total: 65536,
});

const SOURCE_BUDGET = 12 * 1024;
const TOTAL_SOURCE_BUDGET = 40 * 1024;

export type WorkSource = { readonly sourceId: string; readonly title: string; readonly content: string };
export type WorkTool = { readonly name: string; readonly description: string; readonly inputSchemaJson: string };
export type DayWork = {
  readonly workId: string;
  readonly instructions: string;
  readonly sources: readonly WorkSource[];
  readonly tools: readonly WorkTool[];
};

export type WorkInput = {
  readonly runId: string;
  readonly skill: SkillDefinition;
  readonly state: DayState;
  readonly changes: readonly SourceChange[];
  readonly sourcesAvailable: boolean;
  /** What part of the shared activity `changes` was drawn from. */
  readonly sourceCoverage: ActivityCoverage;
  readonly language: Language;
  readonly now: Date;
  readonly focusCircleId: string | null;
  /** Assistant-page continuation only; standalone skills do not inherit that exchange. */
  readonly assistantBinding?: string | null;
};

const encoder = new TextEncoder();

export function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Cut text to a byte budget on a line boundary, noting how much was left out. */
export function fitLines(lines: readonly string[], budget: number, language: Language): string {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const size = byteLength(line) + 1;
    if (used + size > budget - 64) {
      const omitted = lines.length - kept.length;
      kept.push(language === 'zh' ? `…（另有 ${omitted} 条未列出，可用技能查询）` : `…(${omitted} more not shown; use a skill to look them up)`);
      break;
    }
    kept.push(line);
    used += size;
  }
  return kept.join('\n');
}

const WEEKDAYS: Readonly<Record<Language, readonly string[]>> = {
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

const KIND_LABEL: Readonly<Record<Language, Readonly<Record<LifeItem['kind'], string>>>> = {
  zh: { todo: '待办', appointment: '约定', reminder: '提醒', 'follow-up': '跟进' },
  en: { todo: 'to-do', appointment: 'appointment', reminder: 'reminder', 'follow-up': 'follow-up' },
};

function circleLabel(circles: readonly CareCircle[], id: string | null): string | null {
  const circle = id ? circles.find((entry) => entry.id === id) : undefined;
  return circle ? agentCircleName(circle) : null;
}

export function itemLine(item: LifeItem, circles: readonly CareCircle[], language: Language, now: Date): string {
  const parts = [KIND_LABEL[language][item.kind]];
  const circle = circleLabel(circles, item.circleId);
  if (circle) parts.push(circle);
  if (item.repeat) parts.push(language === 'zh' ? '重复' : 'repeats');
  if (item.importance === 'important') parts.push(language === 'zh' ? '重要' : 'important');
  if (isOverdue(item, now)) parts.push(language === 'zh' ? '已过期' : 'overdue');
  if (item.state === 'waiting') parts.push(language === 'zh' ? '等用户决定' : 'waiting for user');
  const when = item.date ? `${item.date}${item.time ? ` ${item.time}` : ''}` : (language === 'zh' ? '未定时间' : 'no date');
  const place = item.place ? ` @${item.place}` : '';
  const notes = item.notes ? ` — ${item.notes.replace(/\s+/gu, ' ').slice(0, 160)}` : '';
  const decision = item.decision ? ` [${item.decision.options.join(' / ')}]` : '';
  const source = item.source
    ? (language === 'zh' ? ` {为 ${item.source.appName} 的提醒「${item.source.title}」所做的安排}` : ` {arranged for ${item.source.appName}'s reminder "${item.source.title}"}`)
    : '';
  return `- [${item.id}] ${when} ${item.title}${place} (${parts.join(' · ')})${decision}${source}${notes}`;
}

function byWhen(a: LifeItem, b: LifeItem): number {
  return `${a.date ?? '9999-99-99'} ${a.time ?? '00:00'}`.localeCompare(`${b.date ?? '9999-99-99'} ${b.time ?? '00:00'}`);
}

function inFocus(item: { readonly circleId: string | null }, focusCircleId: string | null): boolean {
  return focusCircleId === null || item.circleId === focusCircleId;
}

function buildSource(kind: MaterialKind, input: WorkInput): WorkSource | null {
  const { state, language, now, focusCircleId } = input;
  const zh = language === 'zh';
  const today = toLocalDate(now);
  const active = state.items.filter((item) => isActive(item) && inFocus(item, focusCircleId));
  const lines = (items: readonly LifeItem[]) => items.slice().sort(byWhen).map((item) => itemLine(item, state.circles, language, now));
  switch (kind) {
    case 'today': {
      const items = active.filter((item) => item.date === today);
      return {
        sourceId: 'nimiday.today',
        title: zh ? `今天的安排（${today}）` : `Today (${today})`,
        content: items.length ? fitLines(lines(items), SOURCE_BUDGET, language) : (zh ? '今天没有安排。' : 'Nothing scheduled today.'),
      };
    }
    case 'week': {
      const end = addDays(today, 7);
      const items = active.filter((item) => item.date !== null && item.date >= today && item.date <= end);
      return {
        sourceId: 'nimiday.week',
        title: zh ? `未来 7 天（${today} 至 ${end}）` : `Next 7 days (${today} to ${end})`,
        content: items.length ? fitLines(lines(items), SOURCE_BUDGET, language) : (zh ? '未来 7 天没有安排。' : 'Nothing in the next 7 days.'),
      };
    }
    case 'overdue': {
      const items = active.filter((item) => isOverdue(item, now));
      if (!items.length) return null;
      return {
        sourceId: 'nimiday.overdue',
        title: zh ? '已过期未处理' : 'Overdue',
        content: fitLines(lines(items), SOURCE_BUDGET, language),
      };
    }
    case 'waiting': {
      const items = active.filter((item) => item.state === 'waiting');
      if (!items.length) return null;
      return {
        sourceId: 'nimiday.waiting',
        title: zh ? '等用户决定的事' : 'Waiting for the user',
        content: fitLines(lines(items), SOURCE_BUDGET, language),
      };
    }
    case 'recent-done': {
      const since = now.getTime() - DAY_MS;
      const items = state.items.filter((item) => inFocus(item, focusCircleId) && (
        (item.completedAt !== null && Date.parse(item.completedAt) >= since && item.state === 'done')
        || item.history.some((event) => event.kind === 'occurrence-done' && Date.parse(event.at) >= since)
      ));
      return {
        sourceId: 'nimiday.recent-done',
        title: zh ? '最近一天完成的事' : 'Done in the last day',
        content: items.length ? fitLines(lines(items), SOURCE_BUDGET, language) : (zh ? '最近一天没有完成记录。' : 'Nothing completed in the last day.'),
      };
    }
    case 'circles': {
      const circles = state.circles.filter((circle) => circle.status !== 'ended' && inFocus({ circleId: circle.id }, focusCircleId));
      if (!circles.length) return null;
      return {
        sourceId: 'nimiday.circles',
        title: zh ? '照看对象' : 'People and areas looked after',
        content: fitLines(circles.map((circle) => {
          const focus = circle.focus.length ? ` [${circle.focus.join(', ')}]` : '';
          const paused = circle.status === 'paused' ? (zh ? '（暂停照看）' : ' (paused)') : '';
          return `- [${circle.id}] ${agentCircleName(circle)}${paused}${focus}: ${circle.watch || (zh ? '未写关注点' : 'no notes yet')}`;
        }), SOURCE_BUDGET, language),
      };
    }
    case 'handbook': {
      const notes = state.notes
        .filter((note) => focusCircleId === null || note.circleId === focusCircleId || note.circleId === null)
        .slice()
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.updatedAt < b.updatedAt ? 1 : -1));
      if (!notes.length) return null;
      return {
        sourceId: 'nimiday.handbook',
        title: zh ? '家庭手册' : 'Household handbook',
        content: fitLines(notes.map((note) => {
          const circle = circleLabel(state.circles, note.circleId);
          return `- [${note.id}] ${note.title}${circle ? `（${circle}）` : ''}: ${note.body.replace(/\s+/gu, ' ').slice(0, 600)}`;
        }), SOURCE_BUDGET, language),
      };
    }
    case 'recent-sources': {
      if (!input.sourcesAvailable) {
        return {
          sourceId: 'nimiday.changes',
          title: zh ? '其他 App 的新变化' : 'Changes from other apps',
          content: zh ? 'NimiDay 目前无法读取其他 App 共享的动态，不要推测它们的内容。' : "NimiDay can't read other apps' shared activity right now; don't guess what they contain.",
        };
      }
      const since = now.getTime() - 7 * DAY_MS;
      // Reminders still open in their own app matter however long ago their window began.
      const changes = attentionOrder(input.changes.filter((change) => ((change.nature === 'reminder' && change.todoState === 'open')
        || Date.parse(change.occurredAt) >= since) && inFocus(change, focusCircleId)));
      const nature = zh
        ? { reminder: '提醒', record: '记录', interpretation: '解读' }
        : { reminder: 'reminder', record: 'record', interpretation: 'interpretation' };
      // Say what was not in hand, so a partial list is never read as the whole picture.
      const gaps = coverageGaps(input.sourceCoverage, language);
      const gapNote = gaps.length ? `\n${zh ? '（说明：' : '(Note: '}${gaps.join(' ')}${zh ? '不要把这里当成完整清单。）' : ' Do not treat this as the complete list.)'}` : '';
      return {
        sourceId: 'nimiday.changes',
        title: zh ? '其他 App 的待办提醒和最近 7 天的变化' : 'Open reminders and changes (7 days) from other apps',
        content: (changes.length
          ? fitLines(changes.map((change) => {
            const circle = circleLabel(state.circles, change.circleId);
            const todo = change.todoState ? ` [${change.todoState}]` : '';
            const summary = change.summary ? ` — ${change.summary}` : '';
            const id = change.nature === 'reminder' && change.todoState === 'open' ? `[${change.id}] ` : '';
            return `- ${id}${change.occurredAt.slice(0, 16).replace('T', ' ')} ${change.appName} · ${nature[change.nature]}${circle ? ` · ${circle}` : ''}: ${change.title}${todo}${summary}`;
          }), SOURCE_BUDGET - byteLength(gapNote), language)
          : (zh ? '没有待处理的提醒，最近 7 天也没有新变化。' : 'No open reminders and no changes in the last 7 days.')) + gapNote,
      };
    }
  }
}

export function jobInstructions(input: WorkInput, agentName: string): string {
  const { language, now, skill } = input;
  const zh = language === 'zh';
  const date = toLocalDate(now);
  const weekday = WEEKDAYS[language][weekdayOf(date)];
  const focus = input.focusCircleId ? circleLabel(input.state.circles, input.focusCircleId) : null;
  const header = zh
    ? [
      `${agentName}，你正在 NimiDay 担任用户的日常照看助理。保持你自己的性格与说话方式；NimiDay 只提供这份工作的做法、用户家里的资料和几项技能。`,
      `现在是 ${date}（${weekday}）${toLocalTime(now)}，用户所在时区。`,
      focus ? `这次只关注「${focus}」。` : '',
      `【这次的做法：${skill.name}】`,
    ]
    : [
      `${agentName}, you are serving as the user's daily-life care assistant in NimiDay. Keep your own personality and voice; NimiDay only supplies this job's method, the household material and a few skills.`,
      `It is ${weekday} ${date}, ${toLocalTime(now)} in the user's time zone.`,
      focus ? `This time, focus only on "${focus}".` : '',
      `[Method for this request: ${skill.name}]`,
    ];
  const fixed = [...header.filter(Boolean)].join('\n');
  const continuation = skill.id === CHAT_SKILL && input.assistantBinding
    ? (zh
      ? '【连续交代】\n对于用户已明确要求且可撤销的 Day 内部操作，若当前短答清楚回答了刚才的问题，应结合最近同一助理的 Day 业务前文、原目标和已有授权继续执行。不要仅因补充没有重述目标，就再次确认同一个目标或已经明确的参数。真正多义、矛盾或仍缺必要信息时继续询问；当前纠正和实际业务状态优先，不能执行无关或已失效的历史口头承诺。'
      : '[Continuing this request]\nFor reversible actions within Day that the user has explicitly requested, when the current short answer clearly resolves the question just asked, combine it with this assistant’s recent Day business context, original goal and existing authorization, then proceed. Do not ask again about the same goal or an already clear parameter merely because the answer did not repeat the goal. Ask when there is genuine ambiguity, a contradiction or missing necessary information. Current corrections and actual business state take priority; do not act on unrelated or superseded historical promises.')
    : '';
  const tail = ['', ...groundRules(language)].join('\n');
  const text = [fixed, methodBlock(skill, language), continuation, tail].filter(Boolean).join('\n');
  // The method is the user's: it is handed over whole or not at all.
  if (byteLength(text) > WORK_LIMITS.instructions) throw new MethodTooLongError(skill.name);
  return text;
}

function groundRules(language: Language): string[] {
  return language === 'zh'
    ? [
      '【基本原则】',
      '- 只有技能调用的结果才算真正完成了改动：NimiDay 的提醒只有用 day_create_item 建好才会响。没有调用技能并看到成功结果之前，绝不能说“已经记下 / 已安排 / 到时提醒你”。回复里准确说出你新增或修改了什么。',
      '- 事项、提醒和手册以本次资料和技能结果为准：之前对话里提到、但这里查不到的事项，一律当作没有建立，不要说它已经安排好。说到具体几点时，只用资料里写着的时间，不要凭记忆补时间。',
      '- 你做的改动用户都能看到，也可以撤销。不确定时先问，不要替用户做决定。',
      '- 其他 App 的提醒要到那个 App 里完成；App 的解读（例如日镜）不是事实结论。标着“为某 App 的提醒所做的安排”的事项是 NimiDay 自己的安排：它完成了，不代表那个 App 里的事已经办好，要请用户到那个 App 里记录或处理。为其他 App 的提醒建安排时，在 day_create_item 里带上那条提醒的 id（forReminderId）。',
      '- 不编造资料里没有的人、时间或事情。用中文回复。',
    ]
    : [
      '[Ground rules]',
      "- Only skill results establish that something changed: a NimiDay reminder only goes off if you created it with day_create_item. Never say you noted, arranged or will remind about something before a skill call returned success. Say exactly what you added or changed.",
      "- Items, reminders and the handbook are what this material and skill results show: anything mentioned earlier in conversation but not found here was never set up, so don't say it is arranged. When you mention a time of day, use only times written in this material, never one remembered from before.",
      '- The user sees and can undo your changes. When unsure, ask instead of deciding for them.',
      "- Reminders from other apps are completed in those apps; an app's interpretation (such as a daily reading) is not a factual conclusion. An item marked as arranged for another app's reminder is NimiDay's own arrangement: finishing it does not mean that app's business is done, so ask the user to record or handle it in that app. When you create an item for another app's reminder, pass that reminder's id as forReminderId.",
      "- Never invent people, times or events that aren't in the material. Reply in English.",
    ];
}

/** A skill's method and the household's lessons, exactly as they are handed to the assistant. */
export function methodBlock(skill: Pick<SkillDefinition, 'instructions' | 'lessons'>, language: Language): string {
  const lessons = skill.lessons.length > 0
    ? [language === 'zh' ? '【这个家的经验，优先照做】' : '[What this household has learned — follow it]', ...skill.lessons.map((lesson) => `- ${lesson.text}`)].join('\n')
    : '';
  return lessons ? `${skill.instructions.trim()}\n${lessons}` : skill.instructions.trim();
}

/**
 * Room kept for the header (the agent's name, the date, the focus and the
 * skill's name), so a method that fits when it is saved still fits whoever is
 * on duty and whatever the request is about.
 */
const HEADER_ROOM_BYTES = 800;

/**
 * How many bytes a skill's method and lessons are over what one work request
 * can carry; 0 when they fit. The one budget used when saving a method, adding
 * a lesson and starting the skill.
 */
export function methodOverflow(skill: Pick<SkillDefinition, 'instructions' | 'lessons'>, language: Language): number {
  const room = WORK_LIMITS.instructions - byteLength(['', ...groundRules(language)].join('\n')) - HEADER_ROOM_BYTES;
  return Math.max(0, byteLength(methodBlock(skill, language)) - room);
}

export class MethodTooLongError extends Error {
  readonly reasonCode = 'method-too-long';
  constructor(readonly skillName: string) {
    super(`The method and lessons of ${skillName} do not fit in one work request.`);
    this.name = 'MethodTooLongError';
  }
}

/** Assemble the bounded work submission for one skill run. */
/**
 * What changed since the assistant last spoke that its own conversation memory
 * would get wrong: its changes the user undid, and questions the user already
 * answered. The shared conversation keeps the old claims, so this is stated
 * explicitly and overrides them.
 */
export function correctionsSource(input: WorkInput): WorkSource | null {
  const { state, language, now } = input;
  const zh = language === 'zh';
  const since = now.getTime() - 3 * DAY_MS;
  const lines: string[] = [];
  // What is true now for everything an undone run touched. An undo skips what
  // the user edited afterwards, so "it was undone" is never assumed: only the
  // current state is stated.
  const inCare = stillInCare(state.circles);
  const itemNow = (itemId: string, title: string): string | null => {
    const item = state.items.find((entry) => entry.id === itemId) ?? null;
    if (item && !inCare(item)) return null;
    if (!item || item.state === 'dropped') return zh ? `「${title}」现在不在事项里。` : `"${title}" is not on the list now.`;
    if (item.decision?.choice) return null;
    if (item.state === 'done') return zh ? `「${item.title}」现在是已完成。` : `"${item.title}" is done now.`;
    const line = itemLine(item, state.circles, language, now).replace(/^-\s*/u, '');
    return zh ? `「${item.title}」现在是：${line}` : `"${item.title}" is now: ${line}`;
  };
  const noteNow = (noteId: string, title: string): string | null => {
    const note = state.notes.find((entry) => entry.id === noteId);
    if (note && !inCare(note)) return null;
    if (!note) return zh ? `手册里现在没有「${title}」。` : `The handbook has no "${title}" now.`;
    const body = note.body.replace(/\s+/gu, ' ').slice(0, 160);
    return zh ? `手册里的「${note.title}」现在是：${body}` : `The handbook note "${note.title}" now reads: ${body}`;
  };
  for (const run of state.runs) {
    if (!run.undone || !run.finishedAt || Date.parse(run.finishedAt) < since) continue;
    for (const change of run.changes) {
      const fact = change.kind === 'note-saved' ? noteNow(change.noteId, change.title) : itemNow(change.itemId, change.title);
      if (fact && !lines.includes(`- ${fact}`)) lines.push(`- ${fact}`);
    }
  }
  for (const item of state.items) {
    const decided = item.decision?.choice
      ? [...item.history].reverse().find((event) => event.kind === 'decided')
      : undefined;
    if (!decided || Date.parse(decided.at) < since) continue;
    lines.push(zh ? `- 用户已决定「${item.decision!.question}」：${item.decision!.choice}。这个问题不再悬而未决。` : `- The user decided "${item.decision!.question}": ${item.decision!.choice}. It is no longer open.`);
  }
  if (lines.length === 0) return null;
  return {
    sourceId: 'nimiday.corrections',
    title: zh
      ? '核对用：你改动过、用户后来撤销过的事项现在的实际情况，以及用户最近的决定（与对话记忆不一致时以此为准；用户没问起就不必复述）'
      : 'For checking: how things you changed and the user later undid stand now, and the user\'s recent decisions (these override earlier conversation; no need to bring them up unless asked)',
    content: fitLines(lines, SOURCE_BUDGET, language),
  };
}

/** Recent Day-owned exchanges with this assistant; no canonical Conversation is read. */
function assistantContinuationSource(input: WorkInput): WorkSource | null {
  if (!input.assistantBinding) return null;
  const currentCare = new Set(input.state.circles.filter(circle => circle.status !== 'ended').map(circle => circle.id));
  const runs = input.state.runs.filter(run => run.id !== input.runId && run.trigger === 'chat'
    && run.turnId && run.agentBinding === input.assistantBinding
    && run.careCircleIds && run.careCircleIds.every(id => currentCare.has(id)))
    .slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (!runs.length) return null;
  const excerpt = (text: string) => {
    if (byteLength(text) <= 2048) return text;
    let kept = ''; let size = 0;
    for (const character of text) { const bytes = byteLength(character); if (size + bytes > 2048 - 3) break; kept += character; size += bytes; }
    return `${kept}…`;
  };
  type Exchange = { request: string; reply: string | null; state: string; changesUndone: boolean; excerpted: boolean };
  const entries: Exchange[] = [];
  const notice = input.language === 'zh'
    ? '这是同一助理在 Day 中的近期业务前文，只用于理解本次继续请求。历史 state=done 只表示模型轮次结束，不代表原用户目标已经完成，仍以真实保存事实判断。当前事项、手册、用户决定与实际保存结果优先于历史口头承诺；未提供或截断的前文不能猜测，缺少必要信息时请询问用户。'
    : 'Recent Day business exchanges with this assistant, for understanding this continuation. Historical state=done means only that a model turn ended, not that the original user goal was achieved; judge that from actual saved facts. Current items, handbook notes, user decisions and saved results override earlier spoken promises. Do not guess omitted or excerpted context; ask when necessary.';
  const content = (selected: Exchange[]) => JSON.stringify({ notice, omittedEarlier: runs.length - selected.length, entries: [...selected].reverse() });
  for (const run of runs.slice(-8).reverse()) {
    const request = excerpt(run.requestText); const reply = run.replyText === null ? null : excerpt(run.replyText);
    const next: Exchange = { request, reply, state: run.state, changesUndone: run.undone, excerpted: request !== run.requestText || reply !== run.replyText };
    if (byteLength(content([...entries, next])) > 6 * 1024) break;
    entries.push(next);
  }
  return { sourceId: 'nimiday.continuation', title: input.language === 'zh' ? '本次继续请求的 Day 业务前文（有界摘录）' : 'Day context for this continuation (bounded excerpt)', content: content(entries) };
}

export function buildDayWork(fullInput: WorkInput, agentName: string): DayWork {
  // Ended care stays out of what the assistant is given; its data is kept in NimiDay.
  const inCare = stillInCare(fullInput.state.circles);
  const input: WorkInput = {
    ...fullInput,
    state: { ...fullInput.state, items: fullInput.state.items.filter(inCare), notes: fullInput.state.notes.filter(inCare) },
    changes: fullInput.changes.filter(inCare),
  };
  const sources: WorkSource[] = [];
  let used = 0;
  const corrections = correctionsSource(fullInput);
  const continuation = assistantContinuationSource(input);
  // Corrections come first so a large household can never push them out of the budget.
  for (const source of [corrections, continuation, ...input.skill.materials.map((kind) => buildSource(kind, input))]) {
    if (!source) continue;
    const size = byteLength(source.content) + byteLength(source.title) + byteLength(source.sourceId);
    if (used + size > TOTAL_SOURCE_BUDGET || sources.length >= WORK_LIMITS.sources) break;
    sources.push(source);
    used += size;
  }
  const tools = toolDefinitions(input.skill.tools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchemaJson: JSON.stringify(tool.inputSchema),
  }));
  return {
    workId: input.runId,
    instructions: jobInstructions(input, agentName),
    sources,
    tools,
  };
}

export function workByteLength(work: DayWork): number {
  return byteLength(JSON.stringify(work));
}
