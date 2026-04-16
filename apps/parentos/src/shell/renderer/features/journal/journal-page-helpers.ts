import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';

/* ── Types ── */

export type SceneTab = 'quick' | 'deep' | 'review';
export type CaptureMode = 'text' | 'voice';
export type VoiceDraftStatus =
  | 'idle'
  | 'recording'
  | 'ready'
  | 'transcribing'
  | 'transcribed'
  | 'transcription-failed';
export type TagSuggestionStatus = 'idle' | 'suggesting' | 'ready' | 'failed';
export type KeepsakeReason =
  | 'commemorative'
  | 'first-time'
  | 'achievement'
  | 'persistence'
  | 'character'
  | 'family-moment'
  | 'other';

export interface VoiceDraft {
  status: VoiceDraftStatus;
  blob: Blob | null;
  mimeType: string | null;
  previewUrl: string | null;
  transcript: string;
  error: string | null;
}

export const EMPTY_VOICE_DRAFT: VoiceDraft = {
  status: 'idle',
  blob: null,
  mimeType: null,
  previewUrl: null,
  transcript: '',
  error: null,
};

export interface PhotoDraft {
  file: File;
  previewUrl: string;
}

export const KEEPSAKE_REASON_OPTIONS: Array<{ value: KeepsakeReason; label: string }> = [
  { value: 'commemorative', label: '值得纪念' },
  { value: 'first-time', label: '第一次' },
  { value: 'achievement', label: '取得成果' },
  { value: 'persistence', label: '长期坚持' },
  { value: 'character', label: '性格闪光' },
  { value: 'family-moment', label: '家庭时刻' },
  { value: 'other', label: '其他' },
];

export function getKeepsakeReasonLabel(reason: KeepsakeReason | null | undefined) {
  return KEEPSAKE_REASON_OPTIONS.find((item) => item.value === reason)?.label ?? null;
}

/* ── Scene config ── */

export const SCENE_TABS: Array<{ key: SceneTab; emoji: string; label: string; sub: string }> = [
  { key: 'quick', emoji: '⚡️', label: '随手记', sub: '抓拍 · 速记 · 闪念' },
  { key: 'deep', emoji: '🔍', label: '专项观察', sub: '深度 · 计时 · 结构化' },
  { key: 'review', emoji: '🌙', label: '阶段复盘', sub: '回顾 · 梳理 · 感悟' },
];

/** Map scene tabs to existing observation mode IDs */
export const SCENE_MODE_MAP: Record<SceneTab, string> = {
  quick: 'quick-capture',
  deep: 'focused-observation',
  review: 'daily-reflection',
};

export type EmojiCategory = 'frequent' | 'smileys' | 'gestures' | 'people' | 'animals' | 'food' | 'activity' | 'objects' | 'symbols';

export interface EmojiCategoryDef {
  key: EmojiCategory;
  icon: string;
  label: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategoryDef[] = [
  {
    key: 'frequent', icon: '🕐', label: '常用',
    emojis: [
      '😊', '😂', '🥰', '😍', '🤗', '😢', '😡', '😴',
      '🎉', '👏', '💪', '🌟', '❤️', '🎈', '🎨', '🏃',
      '📚', '🎵', '🧩', '🍼', '🌈', '🦋', '🐱', '🌸',
    ],
  },
  {
    key: 'smileys', icon: '😀', label: '表情',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗',
      '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝',
      '🤑', '🤗', '🤭', '🫢', '🫣', '🤫', '🤔', '🫡',
      '🤐', '🤨', '😐', '😑', '😶', '🫥', '😏', '😒',
      '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴',
      '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴',
      '😵', '🤯', '🥳', '🥸', '😎', '🤓', '🧐', '😕',
      '🫤', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺',
      '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭',
      '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱',
      '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️',
      '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖',
      '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿',
      '😾', '🙈', '🙉', '🙊', '💌', '💘', '💝', '💖',
      '💗', '💓', '💞', '💕', '💟', '❣️', '💔', '❤️‍🔥',
      '❤️‍🩹', '❤️', '🩷', '🧡', '💛', '💚', '💙', '🩵',
      '💜', '🤎', '🖤', '🩶', '🤍', '💋', '💯', '💢',
      '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '🗨️',
      '🗯️', '💭', '💤', '🫧',
    ],
  },
  {
    key: 'gestures', icon: '👋', label: '手势',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳',
      '🫴', '🫷', '🫸', '👌', '🤌', '🤏', '✌️', '🤞',
      '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕',
      '👇', '☝️', '🫵', '👍', '👎', '✊', '👊', '🤛',
      '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏',
      '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶',
      '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴',
      '👀', '👁️', '👅', '👄', '🫦',
    ],
  },
  {
    key: 'people', icon: '👶', label: '人物',
    emojis: [
      '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔',
      '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆',
      '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '👮', '🕵️',
      '💂', '🥷', '👷', '🫅', '🤴', '👸', '👳', '👲',
      '🧕', '🤵', '👰', '🤰', '🫃', '🫄', '🤱', '👼',
      '🎅', '🤶', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜',
      '🧝', '🧞', '🧟', '🧌', '💆', '💇', '🚶', '🧍',
      '🧎', '🏃', '💃', '🕺', '🕴️', '👯', '🧖', '🧗',
      '🤸', '⛹️', '🏋️', '🚴', '🚵', '🤼', '🤽', '🤾',
      '🤺', '⛷️', '🏂', '🏌️', '🏄', '🚣', '🏊', '🤹',
      '🧘', '👪', '👨‍👩‍👦', '👨‍👩‍👧', '👨‍👩‍👧‍👦', '👨‍👩‍👦‍👦', '👨‍👩‍👧‍👧', '🫂',
    ],
  },
  {
    key: 'animals', icon: '🐶', label: '动物',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
      '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸',
      '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦',
      '🐤', '🐣', '🐥', '🪿', '🦆', '🐦‍⬛', '🦅', '🦉',
      '🦇', '🐺', '🐗', '🐴', '🦄', '🫎', '🐝', '🪱',
      '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳',
      '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖',
      '🦕', '🐙', '🦑', '🪼', '🦐', '🦞', '🦀', '🐡',
      '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🪸', '🐊',
      '🐅', '🐆', '🦓', '🫏', '🦍', '🦧', '🦣', '🐘',
      '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃',
      '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐',
      '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶',
      '🪽', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩',
      '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥',
      '🐁', '🐀', '🐿️', '🦔', '🐾', '🐉', '🐲',
      '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿',
      '☘️', '🍀', '🎍', '🪴', '🎋', '🍃', '🍂', '🍁',
      '🪺', '🪹', '🍄', '🐚', '🪸', '🪨', '🌾', '💐',
      '🌷', '🌹', '🥀', '🪻', '🌺', '🌸', '🌼', '🌻',
      '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗',
      '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍',
      '🌏', '🪐', '💫', '⭐', '🌟', '✨', '⚡', '☄️',
      '💥', '🔥', '🌪️', '🌈', '☀️', '🌤️', '⛅', '🌥️',
      '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️',
      '⛄', '🌬️', '💨', '💧', '💦', '🫧', '☔', '☂️',
      '🌊', '🌫️',
    ],
  },
  {
    key: 'food', icon: '🍎', label: '食物',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇',
      '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥',
      '🥝', '🍅', '🍆', '🥑', '🥦', '🫑', '🥬', '🥒',
      '🌶️', '🫚', '🧄', '🧅', '🥕', '🌽', '🥔', '🍠',
      '🫘', '🥜', '🌰', '🫒', '🥐', '🍞', '🥖', '🫓',
      '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓',
      '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕',
      '🫔', '🌮', '🌯', '🫕', '🥙', '🧆', '🥚', '🍲',
      '🫗', '🥣', '🥗', '🍿', '🧂', '🥫', '🍱', '🍘',
      '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣',
      '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦪',
      '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁',
      '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '🥛',
      '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🫙', '🍶',
      '🍺', '🍻', '🥂', '🍷', '🫗', '🥃', '🍸', '🍹',
      '🧊', '🥄', '🍴', '🍽️', '🥢', '🧑‍🍳',
    ],
  },
  {
    key: 'activity', icon: '⚽', label: '活动',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉',
      '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍',
      '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿',
      '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌',
      '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️',
      '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽',
      '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉',
      '🏅', '🎖️', '🏵️', '🎗️', '🎪', '🤹', '🎭', '🩰',
      '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘',
      '🎷', '🎺', '🪗', '🎸', '🎻', '🪕', '🎲', '♟️',
      '🎯', '🎳', '🎮', '🎰', '🧩',
    ],
  },
  {
    key: 'objects', icon: '💡', label: '物品',
    emojis: [
      '👓', '🕶️', '🥽', '🧳', '🌂', '☂️', '🎒', '👑',
      '🧢', '🎩', '💍', '💎', '📱', '💻', '⌨️', '🖥️',
      '🖨️', '🖱️', '💾', '📀', '📷', '📸', '📹', '🎥',
      '📽️', '📺', '📻', '🎙️', '🎚️', '🎛️', '⏰', '⏳',
      '📡', '🔋', '🪫', '🔌', '💡', '🔦', '🕯️', '🪔',
      '📔', '📕', '📖', '📗', '📘', '📙', '📚', '📓',
      '📒', '📃', '📜', '📄', '📰', '🗞️', '📑', '🔖',
      '🏷️', '✉️', '📧', '📨', '📩', '📤', '📥', '📦',
      '📫', '📪', '📬', '📭', '📮', '🗳️', '✏️', '✒️',
      '🖊️', '🖋️', '📝', '💼', '📁', '📂', '🗂️', '📅',
      '📆', '🗒️', '🗓️', '📇', '📈', '📉', '📊', '📋',
      '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🗃️',
      '🗄️', '🗑️', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️',
      '🔨', '🪓', '⛏️', '⚒️', '🛠️', '🗡️', '⚔️', '🔫',
      '🪃', '🏹', '🛡️', '🪚', '🔧', '🪛', '🔩', '⚙️',
      '🗜️', '⚖️', '🦯', '🔗', '⛓️', '🪝', '🧰', '🧲',
      '🪜', '🧪', '🧫', '🧬', '🔬', '🔭', '📡', '💉',
      '🩸', '💊', '🩹', '🩼', '🩺', '🩻', '🚪', '🛗',
      '🪞', '🪟', '🛏️', '🛋️', '🪑', '🚽', '🪠', '🚿',
      '🛁', '🪤', '🪒', '🧴', '🧷', '🧹', '🧺', '🧻',
      '🪣', '🧼', '🫧', '🪥', '🧽', '🧯', '🛒', '🚬',
      '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '🪬',
      '💈', '⚗️', '🪄', '🎀', '🎁', '🎈', '🎏', '🎐',
      '🎑', '🧧', '🎃', '🎄', '🎆', '🎇', '🧨', '✨',
      '🎊', '🎉', '🎋', '🎍', '🎎', '🎐', '🎌', '🏮',
    ],
  },
  {
    key: 'symbols', icon: '❤️', label: '符号',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓',
      '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️',
      '🕉️', '☸️', '✡️', '🔯', '🪯', '☯️', '☦️', '🛐',
      '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎',
      '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑',
      '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺',
      '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴',
      '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️',
      '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯',
      '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵',
      '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅',
      '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️',
      '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠',
      'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗',
      '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺',
      '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣',
      'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒',
      '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣',
      '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣',
      '⏏️', '▶️', '⏩', '⏭️', '⏯️', '◀️', '⏪', '⏮️',
      '🔼', '⏫', '🔽', '⏬', '⏸️', '⏹️', '⏺️', '⏏️',
      '🎵', '🎶', '🔀', '🔁', '🔂', '▶️', '⏩', '⏪',
      '🔈', '🔉', '🔊', '🔇', '📣', '📢', '🔔', '🔕',
    ],
  },
];

export const CAPTURE_MODES: CaptureMode[] = ['text', 'voice'];

/* ── Helpers ── */

export function describeVoiceStatus(status: VoiceDraftStatus) {
  switch (status) {
    case 'recording':
      return 'Recording';
    case 'ready':
      return 'Ready to transcribe';
    case 'transcribing':
      return 'Transcribing';
    case 'transcribed':
      return 'Ready to save';
    case 'transcription-failed':
      return 'Transcription failed, voice-only save is still available';
    default:
      return 'No voice draft yet';
  }
}

export function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  });
}

export function blobToBase64(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  });
}

export function parseSelectedTags(selectedTags: string | null) {
  if (!selectedTags) return [];
  try {
    const parsed = JSON.parse(selectedTags) as unknown;
    return Array.isArray(parsed) ? parsed.map((tag) => String(tag)) : [];
  } catch {
    return [];
  }
}

export function groupEntriesByDate(entries: JournalEntryRow[]): [string, JournalEntryRow[]][] {
  const map = new Map<string, JournalEntryRow[]>();
  for (const e of entries) {
    const d = e.recordedAt.split('T')[0]!;
    const list = map.get(d);
    if (list) list.push(e);
    else map.set(d, [e]);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export function formatDateLabel(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (iso === today) return '今天';
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === yesterday) return '昨天';
  const [, m, d] = iso.split('-');
  return `${parseInt(m!, 10)}月${parseInt(d!, 10)}日`;
}

export function getSceneForMode(modeId: string | null): SceneTab {
  if (modeId === 'focused-observation') return 'deep';
  if (modeId === 'daily-reflection') return 'review';
  return 'quick';
}
