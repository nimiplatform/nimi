const CORE_ACTIVITY_IDS = [
  'happy',
  'sad',
  'shy',
  'angry',
  'surprised',
  'confused',
  'excited',
  'worried',
  'embarrassed',
  'neutral',
  'greet',
  'farewell',
  'agree',
  'disagree',
  'listening',
  'thinking',
  'idle',
  'celebrating',
  'sleeping',
  'focused',
] as const;

const EXTENDED_ACTIVITY_IDS = [
  'ext:apologetic',
  'ext:proud',
  'ext:lonely',
  'ext:grateful',
  'ext:acknowledging',
  'ext:encouraging',
  'ext:teasing',
  'ext:resting',
  'ext:playing',
  'ext:eating',
] as const;

const KNOWN_ACTIVITY_IDS = [
  ...CORE_ACTIVITY_IDS,
  ...EXTENDED_ACTIVITY_IDS,
] as const;

export function isKnownActivityId(activityId: string): boolean {
  return (KNOWN_ACTIVITY_IDS as readonly string[]).includes(activityId);
}
