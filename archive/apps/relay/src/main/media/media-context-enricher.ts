// Relay media context enricher — adapted from local-chat media-context-enricher.ts
// Changed imports to local types and prompt-locale. No mod SDK dependencies.

import type {
  ChatMessage,
  LocalChatMediaArtifactShadow,
  LocalChatMediaHints,
  LocalChatTarget,
} from '../chat-pipeline/types.js';
import type { MediaIntent } from './media-spec.js';
import { pt, type PromptLocale } from '../prompt/prompt-locale.js';
import { asRecord } from '../../shared/json.js';

export type CharacterVisualAnchor = {
  subject: string;
  styleHints: string[];
  continuityRefs: string[];
  plannerSummary: string;
  referenceImageUrl: string | null;
};

export type MediaContextSnapshot = {
  visualAnchor: CharacterVisualAnchor;
  visualAnchorSummary: string;
  recentTurnSummary: string;
  continuitySummary: string;
  recentMediaShadows: LocalChatMediaArtifactShadow[];
};

const GENERIC_MEDIA_DESCRIPTOR_RE = /^(?:subject in current conversation|fits current conversation context|natural, refined, companion chat style|matches current interaction mood|natural|generic greeting|scene fits image|visual scene)$/i;
const REQUEST_FILER_RE = /\b(?:send|show|make|create|generate|draw|render|give|can you|could you|please)\b|(?:给我|帮我|替我|发我|来个|来张|来段|发张|发个|做个|做张|整点|生成个|生成张|画张|照片|图片|图|自拍|视频|短视频|短片|影片|动图|看看|一下|一张|一个|一段)/giu;
const INTIMATE_RE = /\b(?:kiss|nude|lingerie|sensual|flirt|bedroom)\b|(?:暧昧|亲密|性感|吻|睡衣|床上|调情|贴贴|诱惑)/iu;
const EMOTIONAL_RE = /难过|好累|很累|委屈|抱抱|安慰|辛苦|孤单|miss you|tired|comfort/iu;
const EXCITED_RE = /哈哈|好耶|太好了|卧槽|真的耶|笑死|wow|omg|excited|yay/iu;
const NIGHT_RE = /夜|深夜|雨夜|窗边|房间|床边|灯光|夜聊|rain|night|window|room|bed|lamp/iu;
const ENVIRONMENT_ONLY_RE = /(?:landscape(?:\s+only)?|scenery(?:\s+only)?|environment(?:\s+only)?|panorama|mountain|sky|cloud|cloudscape|horizon|forest|sea|ocean|lake|waterfall|canyon|valley|sunset|sunrise|aurora|风景|景色|山景|群山|山峦|山峰|天空|白云|云海|云雾|海景|湖景|森林|草原|雪山|瀑布|峡谷|山谷|地平线|天际线|星空|日落|日出|极光)/iu;
const CHARACTER_FOCUS_RE = /(?:selfie|portrait|close-?up|half-?body|full-?body|face|eyes|smile|hair|outfit|pose|appearance|character|自拍|人像|特写|半身|全身|脸|表情|眼神|发型|穿搭|样子|角色|入镜|出镜|看看你|看你|你的样子|你的照片|你的自拍|你本人|你站在|她站在)/iu;
const NO_PEOPLE_RE = /(?:不(?:要|用).{0,4}(?:人物|人像|人|角色|脸)|不要出镜|不要入镜|无人|空镜|纯风景|只看风景|只看山|只看天空|只看云|不拍人|不带人|no people|without people|no person|landscape only|scenery only|environment only)/iu;
const EXPLICIT_CHARACTER_REQUEST_RE = /(?:自拍|人像|人物|角色|肖像|头像|半身|全身|特写|看看你|看你|你的样子|你的照片|你的自拍|你本人|你出镜|你入镜|把你也拍进去|带上你|with you|show yourself|your selfie|portrait of you|include you|person in frame|character portrait)/iu;

type MediaFraming = 'character' | 'environment' | 'mixed';

type SignalRule = {
  pattern: RegExp;
  hint: string;
};

const IMAGE_COMPOSITION_RULES: SignalRule[] = [
  { pattern: /(?:selfie|自拍|头像|大头照)/iu, hint: 'Vertical framing, half-body close-up, like a casual selfie from private chat' },
  { pattern: /(?:portrait|close-?up|人像|特写|近景)/iu, hint: 'Subject close to camera, clear expression and gaze' },
  { pattern: /(?:full-?body|全身|站姿)/iu, hint: 'Preserve full pose and clothing details' },
  { pattern: /(?:wide(?:\s+shot)?|landscape|远景|全景|海边|街景)/iu, hint: 'Show environment and spatial atmosphere, not just the face' },
  { pattern: /(?:window|窗边|room|房间|bed|床|sofa|沙发)/iu, hint: 'Lifestyle indoor scene, like a casual shot from real chat' },
];

const VIDEO_COMPOSITION_RULES: SignalRule[] = [
  { pattern: /(?:selfie|自拍)/iu, hint: 'Vertical framing, person facing camera, like a selfie video just recorded for the user' },
  { pattern: /(?:tracking|follow|跟拍|跟随)/iu, hint: 'Camera gently follows the person, no abrupt jump cuts' },
  { pattern: /(?:push(?:\s|-)?in|zoom(?:\s|-)?in|推进|拉近)/iu, hint: 'Camera slowly pushes in, natural movement, no sudden close-up' },
  { pattern: /(?:pan|orbit|横摇|环绕)/iu, hint: 'Camera movement subtle and restrained, keep subject stable' },
  { pattern: /(?:blink|smile|glance|nod|眨眼|微笑|回眸|点头)/iu, hint: 'Small, smooth actions, suitable for short video rhythm' },
];

const STYLE_RULES: SignalRule[] = [
  { pattern: /(?:cinematic|电影感|胶片|film)/iu, hint: 'Cinematic, light film grain, clear lighting' },
  { pattern: /(?:photoreal|realistic|写实)/iu, hint: 'Natural realism, authentic skin and material textures' },
  { pattern: /(?:anime|illustration|插画|二次元)/iu, hint: 'Keep character design feel, but face and clothing should not distort' },
  { pattern: /(?:rain|雨夜|neon|霓虹|night|夜色)/iu, hint: 'Night tones and reflections should be natural, preserve environmental atmosphere' },
];

function asString(value: unknown): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value: string, maxLength: number): string {
  const normalized = asString(value);
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function joinUnique(values: Array<string | undefined | null>, separator: string, maxLength: number): string {
  const normalized = Array.from(new Set(
    values
      .map((value) => asString(value))
      .filter(Boolean),
  ));
  const joined = normalized.join(separator).trim();
  return compactText(joined, maxLength);
}

function normalizeStringList(values: string[] | undefined, maxItems: number): string[] {
  return Array.from(new Set(
    (values || [])
      .map((value) => asString(value))
      .filter(Boolean),
  )).slice(0, maxItems);
}

function isMeaningfulDescriptor(value: string | undefined | null): boolean {
  const normalized = asString(value);
  if (!normalized || GENERIC_MEDIA_DESCRIPTOR_RE.test(normalized)) {
    return false;
  }
  const stripped = stripRequestBoilerplate(normalized);
  return stripped.length >= 4 || stripped === normalized;
}

function stripRequestBoilerplate(value: string): string {
  return asString(value)
    .replace(REQUEST_FILER_RE, ' ')
    .replace(/[!,.?？！，。~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeShadow(shadow: LocalChatMediaArtifactShadow): string {
  return compactText([
    shadow.subject,
    shadow.scene,
    shadow.styleIntent,
  ].map((value) => asString(value)).filter(Boolean).join(' / '), 110);
}

function collectRecentMediaShadows(messages: ChatMessage[]): LocalChatMediaArtifactShadow[] {
  const collected: LocalChatMediaArtifactShadow[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const shadow = messages[index]?.meta?.mediaShadow;
    if (!shadow) continue;
    collected.push(shadow);
    if (collected.length >= 2) break;
  }
  return collected;
}

function buildRecentTurnSummary(input: {
  messages: ChatMessage[];
  userText: string;
  assistantText: string;
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  const lines: string[] = [];
  if (input.userText) {
    lines.push(pt(locale, 'enricher.userMention', { text: compactText(input.userText, 88) }));
  }
  if (input.assistantText) {
    lines.push(pt(locale, 'enricher.assistantSaid', { text: compactText(input.assistantText, 96) }));
  }
  for (let index = input.messages.length - 1; index >= 0 && lines.length < 5; index -= 1) {
    const message = input.messages[index];
    if (!message) continue;
    if (message.kind === 'image' || message.kind === 'video') {
      const shadow = message.meta?.mediaShadow;
      if (shadow) {
        lines.push(pt(locale, 'enricher.recentMedia', { text: summarizeShadow(shadow) }));
      }
      continue;
    }
    const content = compactText(message.content, 84);
    if (!content) continue;
    const roleLabel = message.role === 'user' ? pt(locale, 'enricher.earlierUser') : pt(locale, 'enricher.earlierAssistant');
    lines.push(`${roleLabel}: ${content}`);
  }
  return joinUnique(lines, ' | ', 420) || '-';
}

function buildContinuitySummary(input: {
  visualAnchor: CharacterVisualAnchor;
  recentMediaShadows: LocalChatMediaArtifactShadow[];
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  const refs = [
    ...input.visualAnchor.continuityRefs,
    ...input.recentMediaShadows.map((shadow) => pt(locale, 'enricher.recentMediaContinuity', { kind: shadow.kind, summary: summarizeShadow(shadow) })),
  ];
  return joinUnique(refs, ' | ', 360) || '-';
}

function buildWorldHint(target: LocalChatTarget, locale: PromptLocale): string {
  const worldName = asString(target.worldName);
  return worldName ? pt(locale, 'enricher.worldLabel', { name: worldName }) : '';
}

function resolveMediaFraming(input: {
  semanticIntent: MediaIntent;
  userText: string;
  assistantText: string;
}): MediaFraming {
  const userDescriptor = stripRequestBoilerplate(input.userText);
  const userForbidsPeople = NO_PEOPLE_RE.test(userDescriptor);
  const userRequestsCharacter = EXPLICIT_CHARACTER_REQUEST_RE.test(userDescriptor);
  const userRequestsEnvironment = ENVIRONMENT_ONLY_RE.test(userDescriptor);
  if (userForbidsPeople) {
    return 'environment';
  }
  if (userRequestsCharacter) {
    return 'character';
  }
  if (userRequestsEnvironment) {
    return 'environment';
  }
  const descriptor = [
    userDescriptor,
    stripRequestBoilerplate(input.assistantText),
    input.semanticIntent.subject,
    input.semanticIntent.scene,
    input.semanticIntent.styleIntent,
    input.semanticIntent.hints?.composition,
  ].map((value) => asString(value)).filter(Boolean).join('\n');
  if (!descriptor) {
    return 'character';
  }
  if (NO_PEOPLE_RE.test(descriptor)) {
    return 'environment';
  }
  const environmentFocused = ENVIRONMENT_ONLY_RE.test(descriptor);
  const characterFocused = CHARACTER_FOCUS_RE.test(descriptor);
  if (environmentFocused && !characterFocused) {
    return 'environment';
  }
  if (environmentFocused && characterFocused) {
    return 'mixed';
  }
  return 'character';
}

function collectRuleHints(rules: SignalRule[], source: string): string[] {
  return rules
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => rule.hint);
}

function inferMood(input: {
  semanticIntent: MediaIntent;
  cueSource: string;
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  const semanticMood = asString(input.semanticIntent.mood);
  const moods: string[] = [];
  if (isMeaningfulDescriptor(semanticMood)) {
    moods.push(semanticMood);
  }
  if (input.semanticIntent.nsfwIntent === 'suggested' || INTIMATE_RE.test(input.cueSource)) {
    moods.push(pt(locale, 'enricher.intimateMood'));
  } else if (EMOTIONAL_RE.test(input.cueSource)) {
    moods.push(pt(locale, 'enricher.emotionalMood'));
  } else if (EXCITED_RE.test(input.cueSource)) {
    moods.push(pt(locale, 'enricher.excitedMood'));
  } else if (NIGHT_RE.test(input.cueSource)) {
    moods.push(pt(locale, 'enricher.nightMood'));
  } else {
    moods.push(pt(locale, 'enricher.defaultMood'));
  }
  return joinUnique(moods, ', ', 140) || pt(locale, 'enricher.defaultMood');
}

function isCharacterBoundSubject(input: {
  subject: string;
  anchorSubject: string;
}): boolean {
  const normalizedSubject = asString(input.subject);
  if (!normalizedSubject) {
    return false;
  }
  const anchorLead = asString(input.anchorSubject).split(/[，,;；]/u)[0] || '';
  if (anchorLead && normalizedSubject.includes(anchorLead)) {
    return true;
  }
  return /(?:她|他|TA|ta|人物|角色|人像|自拍|肖像|portrait|selfie|person|woman|man|girl|boy)/iu.test(normalizedSubject);
}

function buildSubject(input: {
  kind: MediaIntent['kind'];
  semanticIntent: MediaIntent;
  contextSnapshot: MediaContextSnapshot;
  framing: MediaFraming;
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  const semanticSubject = asString(input.semanticIntent.subject);
  if (input.framing === 'environment') {
    return joinUnique([
      isMeaningfulDescriptor(semanticSubject) && !isCharacterBoundSubject({
        subject: semanticSubject,
        anchorSubject: input.contextSnapshot.visualAnchor.subject,
      }) ? semanticSubject : '',
      input.kind === 'image'
        ? pt(locale, 'enricher.imageEnvironmentSubjectFallback')
        : pt(locale, 'enricher.videoEnvironmentSubjectFallback'),
    ], '; ', 260);
  }
  const fallbackPose = input.kind === 'image'
    ? pt(locale, 'enricher.imageFallbackPose')
    : pt(locale, 'enricher.videoFallbackPose');
  return joinUnique([
    input.contextSnapshot.visualAnchor.subject,
    isMeaningfulDescriptor(semanticSubject) ? `Current state: ${semanticSubject}` : fallbackPose,
  ], '; ', 260);
}

function buildScene(input: {
  kind: MediaIntent['kind'];
  semanticIntent: MediaIntent;
  target: LocalChatTarget;
  userText: string;
  assistantText: string;
  contextSnapshot: MediaContextSnapshot;
  framing: MediaFraming;
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  const sceneParts: string[] = [];
  const semanticScene = asString(input.semanticIntent.scene);
  const requestDetail = stripRequestBoilerplate(input.userText);
  if (isMeaningfulDescriptor(semanticScene)) {
    sceneParts.push(semanticScene);
  }
  if (requestDetail) {
    sceneParts.push(pt(locale, 'enricher.expandAround', { detail: compactText(requestDetail, 84) }));
  }
  if (input.framing !== 'environment' && input.contextSnapshot.recentTurnSummary !== '-') {
    sceneParts.push(pt(locale, 'enricher.continuityLine', { summary: input.contextSnapshot.recentTurnSummary }));
  }
  const worldHint = buildWorldHint(input.target, locale);
  if (worldHint) {
    sceneParts.push(worldHint);
  }
  sceneParts.push(
    input.framing === 'environment'
      ? (input.kind === 'image'
        ? pt(locale, 'enricher.imageEnvironmentSceneFallback')
        : pt(locale, 'enricher.videoEnvironmentSceneFallback'))
      : (input.kind === 'image'
        ? pt(locale, 'enricher.imageSceneFallback')
        : pt(locale, 'enricher.videoSceneFallback')),
  );
  return joinUnique(sceneParts, '; ', 320);
}

function buildStyleIntent(input: {
  kind: MediaIntent['kind'];
  semanticIntent: MediaIntent;
  cueSource: string;
  contextSnapshot: MediaContextSnapshot;
  framing: MediaFraming;
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  const styleParts: string[] = [];
  const semanticStyle = asString(input.semanticIntent.styleIntent);
  if (isMeaningfulDescriptor(semanticStyle)) {
    styleParts.push(semanticStyle);
  }
  if (input.framing !== 'environment') {
    styleParts.push(...input.contextSnapshot.visualAnchor.styleHints);
  }
  styleParts.push(...collectRuleHints(STYLE_RULES, input.cueSource));
  styleParts.push(
    input.framing === 'environment'
      ? (input.kind === 'image'
        ? pt(locale, 'enricher.imageEnvironmentStyleFallback')
        : pt(locale, 'enricher.videoEnvironmentStyleFallback'))
      : (input.kind === 'image'
        ? pt(locale, 'enricher.imageStyleFallback')
        : pt(locale, 'enricher.videoStyleFallback')),
  );
  return joinUnique(styleParts, ', ', 260);
}

function buildComposition(input: {
  kind: MediaIntent['kind'];
  cueSource: string;
  currentComposition?: string;
  framing: MediaFraming;
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  const rules = input.kind === 'image' ? IMAGE_COMPOSITION_RULES : VIDEO_COMPOSITION_RULES;
  const ruleHints = collectRuleHints(rules, input.cueSource);
  const fallback = input.framing === 'environment'
    ? (input.kind === 'image'
      ? pt(locale, 'enricher.imageEnvironmentCompositionFallback')
      : pt(locale, 'enricher.videoEnvironmentCompositionFallback'))
    : (input.kind === 'image'
      ? pt(locale, 'enricher.imageCompositionFallback')
      : pt(locale, 'enricher.videoCompositionFallback'));
  return joinUnique([
    input.currentComposition,
    ...ruleHints,
    fallback,
  ], '; ', 240);
}

function buildNegativeCues(input: {
  kind: MediaIntent['kind'];
  hints?: LocalChatMediaHints;
  framing: MediaFraming;
  promptLocale?: PromptLocale;
}): string[] {
  const locale = input.promptLocale || 'en';
  const rawDefaults = input.kind === 'image'
    ? pt(locale, 'enricher.imageNegCues')
    : pt(locale, 'enricher.videoNegCues');
  const defaults = rawDefaults.split('|');
  const environmentOnlyDefaults = input.framing === 'environment'
    ? pt(locale, 'enricher.environmentNegCues').split('|')
    : [];
  return normalizeStringList([
    ...(input.hints?.negativeCues || []),
    ...environmentOnlyDefaults,
    ...defaults,
  ], 8);
}

function buildContinuityRefs(input: {
  hints?: LocalChatMediaHints;
  contextSnapshot: MediaContextSnapshot;
  framing: MediaFraming;
  promptLocale?: PromptLocale;
}): string[] {
  const locale = input.promptLocale || 'en';
  if (input.framing === 'environment') {
    return normalizeStringList([
      ...(input.hints?.continuityRefs || []),
    ], 4);
  }
  return normalizeStringList([
    ...(input.hints?.continuityRefs || []),
    ...input.contextSnapshot.visualAnchor.continuityRefs,
    ...input.contextSnapshot.recentMediaShadows.map((shadow) => pt(locale, 'enricher.continuityMediaPrefix', { summary: summarizeShadow(shadow) })),
  ], 6);
}

// ── Visual anchor builder (simplified for relay — no mod data layer) ──

function buildCharacterVisualAnchor(target: LocalChatTarget): CharacterVisualAnchor {
  const displayName = asString(target.displayName);
  const bio = asString(target.bio);
  const metadata = asRecord(target.metadata);

  const artStyle = asString(metadata.artStyle || metadata.art_style);
  const fashionStyle = asString(metadata.fashionStyle || metadata.fashion_style);
  const personaCue = asString(metadata.personaCue || metadata.persona_cue);
  const avatarUrl = asString(target.avatarUrl);

  const subjectParts: string[] = [];
  if (displayName) subjectParts.push(displayName);
  if (personaCue) subjectParts.push(personaCue);
  if (bio && bio.length <= 80) subjectParts.push(bio);

  const styleHints: string[] = [];
  if (artStyle) styleHints.push(artStyle);
  if (fashionStyle) styleHints.push(fashionStyle);

  const continuityRefs: string[] = [];
  if (displayName) continuityRefs.push(`Character: ${displayName}`);
  if (fashionStyle) continuityRefs.push(`Outfit: ${fashionStyle}`);

  const plannerSummary = joinUnique(
    [displayName, personaCue, artStyle, fashionStyle].filter(Boolean),
    ', ',
    200,
  );

  return {
    subject: joinUnique(subjectParts, ', ', 200) || displayName || 'character',
    styleHints,
    continuityRefs,
    plannerSummary: plannerSummary || displayName || '-',
    referenceImageUrl: avatarUrl || null,
  };
}

export function collectMediaContextSnapshot(input: {
  target: LocalChatTarget;
  messages: ChatMessage[];
  userText: string;
  assistantText: string;
  promptLocale?: PromptLocale;
}): MediaContextSnapshot {
  const visualAnchor = buildCharacterVisualAnchor(input.target);
  const recentMediaShadows = collectRecentMediaShadows(input.messages);
  return {
    visualAnchor,
    visualAnchorSummary: visualAnchor.plannerSummary,
    recentTurnSummary: buildRecentTurnSummary({ ...input, promptLocale: input.promptLocale }),
    continuitySummary: buildContinuitySummary({
      visualAnchor,
      recentMediaShadows,
      promptLocale: input.promptLocale,
    }),
    recentMediaShadows,
  };
}

export function enrichMediaIntent(input: {
  semanticIntent: MediaIntent;
  target: LocalChatTarget;
  userText: string;
  assistantText: string;
  contextSnapshot: MediaContextSnapshot;
  promptLocale?: PromptLocale;
}): MediaIntent {
  const locale = input.promptLocale || 'en';
  const framing = resolveMediaFraming({
    semanticIntent: input.semanticIntent,
    userText: input.userText,
    assistantText: input.assistantText,
  });
  const cueSource = [
    input.userText,
    input.assistantText,
    input.semanticIntent.subject,
    input.semanticIntent.scene,
    input.semanticIntent.styleIntent,
    input.semanticIntent.mood,
    input.contextSnapshot.recentTurnSummary,
    input.contextSnapshot.continuitySummary,
  ].map((value) => asString(value)).filter(Boolean).join('\n');

  return {
    ...input.semanticIntent,
    subject: buildSubject({
      kind: input.semanticIntent.kind,
      semanticIntent: input.semanticIntent,
      contextSnapshot: input.contextSnapshot,
      framing,
      promptLocale: locale,
    }),
    scene: buildScene({
      kind: input.semanticIntent.kind,
      semanticIntent: input.semanticIntent,
      target: input.target,
      userText: input.userText,
      assistantText: input.assistantText,
      contextSnapshot: input.contextSnapshot,
      framing,
      promptLocale: locale,
    }),
    styleIntent: buildStyleIntent({
      kind: input.semanticIntent.kind,
      semanticIntent: input.semanticIntent,
      cueSource,
      contextSnapshot: input.contextSnapshot,
      framing,
      promptLocale: locale,
    }),
    mood: inferMood({
      semanticIntent: input.semanticIntent,
      cueSource,
      promptLocale: locale,
    }),
    hints: {
      composition: buildComposition({
        kind: input.semanticIntent.kind,
        cueSource,
        currentComposition: input.semanticIntent.hints?.composition,
        framing,
        promptLocale: locale,
      }),
      negativeCues: buildNegativeCues({
        kind: input.semanticIntent.kind,
        hints: input.semanticIntent.hints,
        framing,
        promptLocale: locale,
      }),
      continuityRefs: buildContinuityRefs({
        hints: input.semanticIntent.hints,
        contextSnapshot: input.contextSnapshot,
        framing,
        promptLocale: locale,
      }),
    },
  };
}
