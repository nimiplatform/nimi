// NimiDay business state. Everything here is App-owned job material:
// the on-duty agent's identity, conversation and memory stay with Runtime.

/** UTC instant, ISO-8601 (`Date#toISOString`). */
export type Instant = string;
/** Calendar date in the user's local time zone, `YYYY-MM-DD`. */
export type LocalDate = string;
/** Wall-clock time in the user's local time zone, `HH:MM`. */
export type LocalTime = string;

export type Language = 'zh' | 'en';

export type CircleKind =
  | 'child'
  | 'elder'
  | 'partner'
  | 'self'
  | 'home'
  | 'pet'
  | 'health'
  | 'money'
  | 'other';

export type CircleStatus = 'active' | 'paused' | 'ended';

/** A person or area of life the user wants looked after. */
export type CareCircle = {
  readonly id: string;
  readonly kind: CircleKind;
  readonly name: string;
  /** What the user wants watched, in their own words. */
  readonly watch: string;
  /** Short concern tags, e.g. "疫苗", "睡眠". */
  readonly focus: readonly string[];
  readonly status: CircleStatus;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

export type ItemKind = 'todo' | 'appointment' | 'reminder' | 'follow-up';
export type ItemState = 'open' | 'waiting' | 'done' | 'dropped';
export type Importance = 'gentle' | 'normal' | 'important';

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Repeat = {
  readonly freq: RepeatFreq;
  readonly interval: number;
  /** For weekly repeats: 0 = Sunday … 6 = Saturday. */
  readonly weekdays: readonly number[];
  /** First occurrence; keeps "the 31st" or "Feb 29" stable across months. */
  readonly anchor: LocalDate;
};

export type RemindRule =
  | { readonly kind: 'none' }
  | { readonly kind: 'at-time' }
  | { readonly kind: 'before'; readonly minutes: number };

export type Origin =
  | { readonly by: 'user' }
  | { readonly by: 'agent'; readonly agentName: string; readonly runId: string | null }
  | { readonly by: 'rhythm'; readonly rhythmId: string };

export type ItemEventKind =
  | 'created'
  | 'edited'
  | 'completed'
  | 'occurrence-done'
  | 'occurrence-skipped'
  | 'reopened'
  | 'dropped'
  | 'snoozed'
  | 'reminded'
  | 'missed'
  | 'decided';

export type ItemEvent = {
  readonly at: Instant;
  readonly kind: ItemEventKind;
  readonly by: 'user' | 'agent' | 'system';
  readonly note?: string;
};

/** A question the agent parked for the user to decide later. */
export type Decision = {
  readonly question: string;
  readonly options: readonly string[];
  readonly choice: string | null;
};

export type LifeItem = {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly kind: ItemKind;
  readonly circleId: string | null;
  readonly date: LocalDate | null;
  /** `null` means all day (or undated when `date` is also null). */
  readonly time: LocalTime | null;
  readonly place: string;
  readonly repeat: Repeat | null;
  readonly remind: RemindRule;
  readonly importance: Importance;
  readonly state: ItemState;
  readonly snoozedUntil: Instant | null;
  /** Reminder instant already delivered (or recorded as missed). */
  readonly remindedFor: Instant | null;
  readonly decision: Decision | null;
  /** Set when this is NimiDay's own arrangement for a reminder that lives in another App. */
  readonly source?: SourceLink | null;
  readonly origin: Origin;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly completedAt: Instant | null;
  readonly history: readonly ItemEvent[];
};

/**
 * The other App's reminder an arrangement was made for. Finishing the
 * arrangement never finishes that App's business; only the App itself can.
 */
export type SourceLink = {
  readonly appId: string;
  readonly appName: string;
  readonly activityId: string;
  /** Stable key of the business object, to find its current state again. */
  readonly objectKey: string | null;
  readonly title: string;
};

export type HandbookNote = {
  readonly id: string;
  readonly circleId: string | null;
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly origin: Origin;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

export type RhythmDays = 'daily' | 'weekdays' | 'weekends' | 'custom';
export type RhythmSchedule = {
  readonly days: RhythmDays;
  /** Used when `days === 'custom'`: 0 = Sunday … 6 = Saturday. */
  readonly weekdays: readonly number[];
  readonly time: LocalTime;
};

/** When a rhythm comes due: ask the user to start, or start on its own. */
export type RhythmStart = 'ask' | 'auto';

export type Rhythm = {
  readonly id: string;
  readonly skillId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly schedule: RhythmSchedule;
  readonly start: RhythmStart;
  readonly notify: boolean;
  /** Last scheduled occurrence that was handled (fired, asked or missed). */
  readonly handledFor: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

export type MaterialKind =
  | 'today'
  | 'week'
  | 'overdue'
  | 'waiting'
  | 'circles'
  | 'handbook'
  | 'recent-sources'
  | 'recent-done';

export type SkillDefinition = {
  readonly id: string;
  readonly builtIn: boolean;
  readonly icon: string;
  readonly name: string;
  readonly purpose: string;
  /** The method the agent follows; the user may adjust it. */
  readonly instructions: string;
  /** The request the user sends when starting the skill. */
  readonly request: string;
  readonly tools: readonly string[];
  readonly materials: readonly MaterialKind[];
  readonly enabled: boolean;
  readonly updatedAt: Instant | null;
  /** What this household learned about doing it well; travels with the post, not the agent. */
  readonly lessons: readonly SkillLesson[];
};

export type SkillLesson = {
  readonly id: string;
  readonly text: string;
  readonly addedAt: Instant;
};

/** User edits layered over a built-in skill. */
export type SkillOverride = {
  readonly skillId: string;
  readonly instructions?: string;
  readonly request?: string;
  readonly enabled?: boolean;
  readonly lessons?: readonly SkillLesson[];
  readonly updatedAt: Instant;
};

export type RunTrigger = 'user' | 'rhythm' | 'chat';

export type RunState =
  | 'waiting-start'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'interrupted'
  | 'missed'
  | 'dismissed';

export type RunToolCall = {
  readonly callId: string;
  readonly name: string;
  readonly summary: string;
  readonly ok: boolean;
  readonly at: Instant;
  /** The change was applied on screen but storage refused it when the agent asked. */
  readonly unsaved?: boolean;
};

/**
 * A reversible business change made by an agent through a skill.
 * `keptOnUndo`: the user had changed it since, so undoing the run left it as it was.
 */
export type RunChange = (
  | { readonly kind: 'item-created'; readonly itemId: string; readonly title: string }
  | { readonly kind: 'item-updated'; readonly itemId: string; readonly title: string; readonly before: LifeItem }
  | { readonly kind: 'item-completed'; readonly itemId: string; readonly title: string; readonly before: LifeItem }
  | { readonly kind: 'decision-asked'; readonly itemId: string; readonly title: string }
  | { readonly kind: 'note-saved'; readonly noteId: string; readonly title: string; readonly before: HandbookNote | null }
) & { readonly keptOnUndo?: true };

export type SkillRun = {
  readonly id: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly trigger: RunTrigger;
  readonly rhythmId: string | null;
  readonly scheduledFor: Instant | null;
  readonly state: RunState;
  readonly agentName: string | null;
  readonly requestText: string;
  readonly turnId: string | null;
  readonly createdAt: Instant;
  readonly startedAt: Instant | null;
  readonly finishedAt: Instant | null;
  /** The one person or area the request was about (null: everyone), so trying again asks the same. */
  readonly focusCircleId?: string | null;
  readonly toolCalls: readonly RunToolCall[];
  readonly changes: readonly RunChange[];
  readonly undone: boolean;
  readonly replyMessageId: string | null;
  readonly replyText: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;
};

export type QuietHours = {
  readonly enabled: boolean;
  readonly start: LocalTime;
  readonly end: LocalTime;
};

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'auto' | Language;

/**
 * Who serves in the NimiDay post. `binding` is the App-scoped durable
 * correlation Runtime issues for matching a fresh reference listing; it is
 * never an operation selector. Without it the user confirms the agent again.
 */
export type Appointment = {
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly binding: string | null;
  readonly appointedAt: Instant;
};

export type AppointmentRecord = {
  readonly displayName: string;
  readonly from: Instant;
  readonly to: Instant | null;
};

export type SourcePreference = {
  readonly appId: string;
  readonly enabled: boolean;
  readonly circleId: string | null;
};

/**
 * Where one publisher-declared group of records goes (for example one child in
 * ParentOS). `key` joins the publishing registration's `sourceRef` with the
 * record's opaque `data.groupRef`; it is never an identity or a selector.
 */
export type SourceGroupPreference = {
  readonly key: string;
  readonly appId: string;
  readonly circleId: string | null;
};

export type DayProfile = {
  readonly appointment: Appointment | null;
  readonly appointmentHistory: readonly AppointmentRecord[];
  readonly quiet: QuietHours;
  readonly systemNotifications: boolean;
  readonly homeMessages: boolean;
  readonly allDayRemindTime: LocalTime;
  readonly theme: ThemePreference;
  readonly language: LanguagePreference;
  readonly onboarded: boolean;
  readonly sources: readonly SourcePreference[];
  readonly sourceGroups: readonly SourceGroupPreference[];
  /** Activity ids the user set aside inside NimiDay (read state stays shared). */
  readonly hiddenSourceIds: readonly string[];
  readonly lastActiveAt: Instant | null;
};

export type DayState = {
  readonly profile: DayProfile;
  readonly circles: readonly CareCircle[];
  readonly items: readonly LifeItem[];
  readonly notes: readonly HandbookNote[];
  readonly rhythms: readonly Rhythm[];
  readonly skillOverrides: readonly SkillOverride[];
  readonly customSkills: readonly SkillDefinition[];
  readonly runs: readonly SkillRun[];
};
