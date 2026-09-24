// Turns a quick line such as "周五 9:30 带小米打疫苗" or "tomorrow 3pm call mom"
// into a dated item draft. Deterministic parsing only; unmatched text stays
// in the title so nothing the user typed is lost.

import { addDays, daysInMonth, toLocalDate, weekdayOf } from './time.js';
import type { ItemKind, LocalDate, LocalTime, RepeatFreq } from './types.js';

export type QuickCapture = {
  readonly title: string;
  readonly date: LocalDate | null;
  readonly time: LocalTime | null;
  readonly repeat: { readonly freq: RepeatFreq; readonly weekdays: readonly number[] } | null;
  readonly kind: ItemKind;
};

const ZH_DIGITS: Readonly<Record<string, number>> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const ZH_WEEKDAY: Readonly<Record<string, number>> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const EN_WEEKDAY: Readonly<Record<string, number>> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

function zhNumber(value: string): number | null {
  if (/^\d+$/u.test(value)) return Number(value);
  if (value === '十') return 10;
  const match = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/u.exec(value);
  if (match) return (match[1] ? ZH_DIGITS[match[1]]! : 1) * 10 + (match[2] ? ZH_DIGITS[match[2]]! : 0);
  if (value.length === 1 && value in ZH_DIGITS) return ZH_DIGITS[value]!;
  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The next date with this weekday, today excluded unless `allowToday`. */
function nextWeekday(from: LocalDate, weekday: number, allowToday: boolean): LocalDate {
  const current = weekdayOf(from);
  let offset = (weekday - current + 7) % 7;
  if (offset === 0 && !allowToday) offset = 7;
  return addDays(from, offset);
}

/** "下周三": the weekday in the following Monday-based week. */
function weekdayNextWeek(from: LocalDate, weekday: number): LocalDate {
  const current = weekdayOf(from);
  const mondayOffset = current === 0 ? 1 : 8 - current;
  const nextMonday = addDays(from, mondayOffset);
  return addDays(nextMonday, weekday === 0 ? 6 : weekday - 1);
}

type Extract = { text: string };

function take(state: Extract, pattern: RegExp, handle: (match: RegExpExecArray) => boolean): void {
  const match = pattern.exec(state.text);
  if (match && handle(match)) {
    state.text = `${state.text.slice(0, match.index)} ${state.text.slice(match.index + match[0].length)}`;
  }
}

export function parseQuickCapture(input: string, now: Date): QuickCapture {
  const today = toLocalDate(now);
  const state: Extract = { text: ` ${input.trim()} ` };
  let date: LocalDate | null = null;
  let time: LocalTime | null = null;
  let repeat: QuickCapture['repeat'] = null;
  let meridiem: 'am' | 'pm' | 'noon' | null = null;

  // Repeats.
  take(state, /每(?:个)?(?:周|星期|礼拜)([一二三四五六日天](?:[、,，和]?[一二三四五六日天])*)/u, (match) => {
    const days = [...match[1]!.replace(/[、,，和]/gu, '')].map((char) => ZH_WEEKDAY[char]!).filter((day) => day !== undefined);
    repeat = { freq: 'weekly', weekdays: [...new Set(days)] };
    return true;
  });
  take(state, /每(?:个)?工作日/u, () => { repeat = { freq: 'weekly', weekdays: [1, 2, 3, 4, 5] }; return true; });
  take(state, /每(?:天|日)/u, () => { repeat = { freq: 'daily', weekdays: [] }; return true; });
  take(state, /每(?:个)?月(?:的)?(\d{1,2}|[一二三四五六七八九十]{1,3})[日号]/u, (match) => {
    const day = zhNumber(match[1]!);
    if (!day || day > 31) return false;
    repeat = { freq: 'monthly', weekdays: [] };
    const now = new Date(`${today}T00:00:00`);
    const candidate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(Math.min(day, daysInMonth(now.getFullYear(), now.getMonth() + 1)))}`;
    date = candidate >= today ? candidate : null;
    if (!date) {
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      date = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth() + 1)))}`;
    }
    return true;
  });
  take(state, /\bevery\s+(day|weekday|week|month|year|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/iu, (match) => {
    const unit = match[1]!.toLowerCase();
    if (unit === 'day') repeat = { freq: 'daily', weekdays: [] };
    else if (unit === 'weekday') repeat = { freq: 'weekly', weekdays: [1, 2, 3, 4, 5] };
    else if (unit === 'week') repeat = { freq: 'weekly', weekdays: [] };
    else if (unit === 'month') repeat = { freq: 'monthly', weekdays: [] };
    else if (unit === 'year') repeat = { freq: 'yearly', weekdays: [] };
    else repeat = { freq: 'weekly', weekdays: [EN_WEEKDAY[unit]!] };
    return true;
  });

  // Dates.
  take(state, /(大后天|后天|明天|明日|今天|今日|今晚|明晚|明早)/u, (match) => {
    const word = match[1]!;
    const offset = word === '大后天' ? 3 : word === '后天' ? 2 : word.startsWith('明') ? 1 : 0;
    date = addDays(today, offset);
    if (word.endsWith('晚')) meridiem = 'pm';
    if (word === '明早') meridiem = 'am';
    return true;
  });
  // "记一下周六" is "note it down, Saturday": the 下 of 一下 never means next week.
  take(state, /(下下|(?<!一)下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/u, (match) => {
    if (date || repeat) return false;
    const weekday = ZH_WEEKDAY[match[2]!]!;
    const prefix = match[1];
    if (prefix === '下') date = weekdayNextWeek(today, weekday);
    else if (prefix === '下下') date = addDays(weekdayNextWeek(today, weekday), 7);
    else date = nextWeekday(today, weekday, true);
    return true;
  });
  take(state, /(?:(\d{4})年)?(\d{1,2}|[一二三四五六七八九十]{1,2})月(\d{1,2}|[一二三四五六七八九十]{1,3})[日号]?/u, (match) => {
    const month = zhNumber(match[2]!);
    const day = zhNumber(match[3]!);
    if (!month || !day || month > 12) return false;
    let year = match[1] ? Number(match[1]) : Number(today.slice(0, 4));
    if (day > daysInMonth(year, month)) return false;
    let candidate = `${year}-${pad(month)}-${pad(day)}`;
    if (!match[1] && candidate < today) {
      year += 1;
      candidate = `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
    }
    date = candidate;
    return true;
  });
  take(state, /(?<![\d月])(\d{1,2}|[一二三四五六七八九十]{1,3})[号日](?![\d])/u, (match) => {
    if (date) return false;
    const day = zhNumber(match[1]!);
    if (!day || day > 31) return false;
    const now = new Date(`${today}T00:00:00`);
    for (let add = 0; add < 3; add += 1) {
      const probe = new Date(now.getFullYear(), now.getMonth() + add, 1);
      if (day <= daysInMonth(probe.getFullYear(), probe.getMonth() + 1)) {
        const candidate = `${probe.getFullYear()}-${pad(probe.getMonth() + 1)}-${pad(day)}`;
        if (candidate >= today) { date = candidate; return true; }
      }
    }
    return false;
  });
  take(state, /\b(today|tonight|tomorrow)\b/iu, (match) => {
    const word = match[1]!.toLowerCase();
    date = addDays(today, word === 'tomorrow' ? 1 : 0);
    if (word === 'tonight') meridiem = 'pm';
    return true;
  });
  take(state, /\b(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/iu, (match) => {
    if (date || repeat) return false;
    const weekday = EN_WEEKDAY[match[2]!.toLowerCase()]!;
    date = match[1] ? weekdayNextWeek(today, weekday) : nextWeekday(today, weekday, true);
    return true;
  });

  // Times of day.
  take(state, /(上午|早上|早晨|清早|中午|下午|傍晚|晚上|夜里)/u, (match) => {
    const word = match[1]!;
    meridiem = word === '中午' ? 'noon' : ['下午', '傍晚', '晚上', '夜里'].includes(word) ? 'pm' : 'am';
    return true;
  });
  // "3:30pm", "12:30 am", "at 3pm": taken whole first, so a time with minutes keeps its am/pm.
  take(state, /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/iu, (match) => {
    if (time) return false;
    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour > 12 || minute > 59) return false;
    const pm = match[3]!.toLowerCase() === 'pm';
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    time = `${pad(hour)}:${pad(minute)}`;
    return true;
  });
  take(state, /(?:\bat\s+)?(\d{1,2})[:：](\d{2})/iu, (match) => {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return false;
    time = `${pad(hour)}:${pad(minute)}`;
    return true;
  });
  take(state, /(\d{1,2}|[一二两三四五六七八九十]{1,3})点(?:(半)|(\d{1,2}|[一二三四五六七八九十]{1,3})分?)?/u, (match) => {
    if (time) return false;
    const hour = zhNumber(match[1]!);
    if (hour === null || hour > 23) return false;
    const minute = match[2] ? 30 : match[3] ? zhNumber(match[3]) : 0;
    if (minute === null || minute > 59) return false;
    time = `${pad(hour)}:${pad(minute)}`;
    return true;
  });
  take(state, /\bat\s+(\d{1,2})(?::(\d{2}))?\b/iu, (match) => {
    if (time) return false;
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour > 23 || minute > 59) return false;
    time = `${pad(hour)}:${pad(minute)}`;
    return true;
  });

  if (time && meridiem) {
    const [hourText, minuteText] = (time as LocalTime).split(':');
    let hour = Number(hourText);
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'noon' && hour < 11) hour += 12;
    time = `${pad(hour)}:${minuteText}`;
  } else if (!time && meridiem && date) {
    // "明早" alone gives a sensible default time rather than none.
    time = meridiem === 'am' ? '09:00' : meridiem === 'noon' ? '12:00' : '19:00';
  } else if (time && !meridiem && /点/u.test(input)) {
    // "3点接孩子" means the afternoon; nobody schedules family errands at 3 a.m.
    const hour = Number((time as LocalTime).slice(0, 2));
    if (hour >= 1 && hour <= 5) time = `${pad(hour + 12)}:${(time as LocalTime).slice(3)}`;
  }
  if ((time || repeat) && !date) {
    date = today;
  }
  if (repeat && date && (repeat as { freq: RepeatFreq }).freq === 'weekly' && (repeat as { weekdays: readonly number[] }).weekdays.length === 0) {
    repeat = { freq: 'weekly', weekdays: [weekdayOf(date)] };
  }

  const title = state.text.replace(/\s+/gu, ' ').replace(/^[\s,，、:：-]+|[\s,，、:：-]+$/gu, '').trim();
  const finalTitle = title || input.trim();
  // Going somewhere at a set time is an appointment; getting ready for it is a to-do.
  const attends = /约了|约会|看医生|看牙|复查|复诊|体检|面试|接种|打疫苗|疫苗|门诊|家长会|appointment|visit|meeting|check-?up|dentist|doctor/iu.test(finalTitle);
  const prepares = /^(准备|收拾|整理|打印|填|交|买|订|预约|提醒|记得|问问?|查|带上|找)|^(prepare|pack|print|buy|book|order|remind|fill|call)\b/iu.test(finalTitle);
  const kind: ItemKind = time && attends && !prepares ? 'appointment' : 'todo';
  return { title: finalTitle, date, time, repeat, kind };
}

/**
 * The person or area a captured line names, when exactly one active circle's
 * name appears in it ("给妈妈打电话" → 妈妈). Ambiguous lines stay unsorted.
 */
export function circleMentioned(text: string, circles: readonly { readonly id: string; readonly name: string; readonly status: string }[]): string | null {
  const matches = circles.filter((circle) => circle.status !== 'ended' && circle.name.trim().length > 0 && text.includes(circle.name.trim()));
  if (matches.length === 1) return matches[0]!.id;
  // Prefer the longest name when one contains another (e.g. "小米" and "小米爸爸").
  const longest = matches.sort((a, b) => b.name.length - a.name.length);
  if (longest.length > 1 && longest[0]!.name.length > longest[1]!.name.length && longest[0]!.name.includes(longest[1]!.name)) return longest[0]!.id;
  return null;
}

/**
 * Whether a message asks for something to be kept or arranged (a reminder, a
 * note, a plan) rather than just talked about. Used to notice when a reply
 * promised it but nothing was actually saved.
 */
export function asksToRecord(text: string): boolean {
  return /提醒我|提醒一下|叫我|记下|记一下|记住|帮我记|别忘了|加一个|加个|添加|安排|定个|设个|放到日程|remind me|note (?:this|that|down)|add (?:a|an|it)|put .* on my|schedule|don'?t let me forget/iu.test(text);
}

const IMPORTANCE_REMARK = /(?:这件事|这事|它)?(?:挺|很|非常|特别)?(?:重要|要紧)(?:的|了|啊|呀)?|\b(?:it'?s|this is)?\s*(?:very\s+|really\s+)?(?:important|urgent)\b/iu;
const REQUEST_LEAD = /^(?:请|麻烦你?|帮我|你)?(?:提醒我一下|提醒一下|提醒我|叫我|记下来|记下|记一下|记住|帮我记|别忘了|加一个|加个|添加|安排一下|安排)(?:一下)?|^(?:please\s+)?(?:remind me to|remind me|remember to|don'?t let me forget to|add)\s+/iu;

/**
 * A draft item from something the user asked for in conversation, e.g.
 * "明天早上8点提醒我给小米带上疫苗本，这件事挺重要的" → an important item at 08:00
 * tomorrow titled "给小米带上疫苗本". The user reviews it before it is saved.
 */
export function draftFromRequest(text: string, now: Date): QuickCapture & { readonly importance: 'important' | 'normal' } {
  const clauses = text.split(/[，,。.!！？?；;]/u).map((clause) => clause.trim()).filter(Boolean);
  const important = IMPORTANCE_REMARK.test(text);
  // A clause that only remarks on importance ("这件事挺重要的") is not part of the task.
  const kept = clauses.filter((clause) => clause.replace(IMPORTANCE_REMARK, '').trim().length > 0);
  const parsed = parseQuickCapture((kept.length > 0 ? kept : clauses).join('，'), now);
  const title = parsed.title.replace(REQUEST_LEAD, '').replace(/^[\s,，、:：]+/u, '').trim() || parsed.title;
  return { ...parsed, title, importance: important ? 'important' : 'normal' };
}
