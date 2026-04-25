function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDesktopChatOutputContractLines(): string[] {
  return [
    'Return APML only. Do not output prose, Markdown, code fences, JSON, comments, or wrapper text outside APML.',
    'The first non-whitespace characters must be <message and the response must contain exactly one <message id="...">...</message>.',
    'Put all user-visible assistant text inside the single <message> body.',
    'Use <emotion>neutral|joy|focus|calm|playful|concerned|surprised</emotion> inside <message> only when a current affect cue is useful.',
    'Use <activity>...</activity> inside <message> only for a short presentation/action cue; do not use it as visible text.',
    'Immediate post-turn media actions must be sibling <action> tags after </message>, never nested inside <message>.',
    '<action> kind may be only "image" or "voice". Do not emit kind="video"; video generation is deferred.',
    '<action> must include id, kind, source-message, and coupling="after-message" or coupling="with-message".',
    '<action> must contain <prompt-payload kind="image|voice"><prompt-text>...</prompt-text></prompt-payload>.',
    'Emit at most one image action and at most one voice action in the entire response.',
    'Deferred continuation must use <time-hook> with <delay-ms> or <event-hook> with exactly one <event-user-idle idle-for="600s"/> or <event-chat-ended/>, plus <effect kind="follow-up-turn">, not an <action>.',
    'If no action or hook is needed, emit only the single <message> element.',
    'Keep internal planning private and never include chain-of-thought fields.',
  ];
}

export function buildDesktopChatEnvelopeSkeleton(): string {
  return [
    '<message id="message-0">',
    '  <emotion>neutral</emotion>',
    '  <activity>responding</activity>',
    '  Assistant reply text here.',
    '</message>',
  ].join('\n');
}

export function buildDesktopChatOutputContractSection(): string {
  return [
    'Output Contract:',
    ...buildDesktopChatOutputContractLines().map((line) => `- ${line}`),
  ].join('\n');
}

export function composeDesktopChatSystemPrompt(basePrompt?: string | null): string {
  const base = normalizeText(basePrompt);
  const sections = [
    base || null,
    buildDesktopChatOutputContractSection(),
    `Response Skeleton:\n${buildDesktopChatEnvelopeSkeleton()}`,
  ].filter(Boolean);
  return sections.join('\n\n');
}
