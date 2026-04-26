function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDesktopChatOutputContractLines(): string[] {
  return [
    'Return APML only. Do not output prose, Markdown, code fences, JSON, comments, or wrapper text outside APML.',
    'The first non-whitespace characters must be <message and the response must contain exactly one <message id="...">...</message>.',
    'Put all user-visible assistant text inside the single <message> body.',
    'Use <emotion>neutral|joy|focus|calm|playful|concerned|surprised</emotion> inside <message> only when a current affect cue is useful.',
    'Use <activity>happy|sad|shy|angry|surprised|confused|excited|worried|embarrassed|neutral|greet|farewell|agree|disagree|listening|thinking|idle|celebrating|sleeping|focused</activity> inside <message> only for a short presentation/action cue; do not use it as visible text.',
    'Immediate post-turn media actions must be sibling <action> tags after </message>, never nested inside <message>.',
    '<action> kind may be only "image" or "voice". Do not emit kind="video"; video generation is deferred.',
    '<action> must include only id and kind attributes; do not emit operation, source-message, coupling, priority, routing, or provider/backend attributes.',
    '<action> must contain <prompt-payload kind="image|voice"><prompt-text>...</prompt-text></prompt-payload>.',
    'Emit at most one image action and at most one voice action in the entire response.',
    'Runtime-owned deferred continuation uses <time-hook> / <event-hook>; this Desktop local parser must not emit or accept those hooks.',
    'If no action or hook is needed, emit only the single <message> element.',
    'Keep internal planning private and never include chain-of-thought fields.',
  ];
}

export function buildDesktopChatEnvelopeSkeleton(): string {
  return [
    '<message id="message-0">',
    '  <emotion>neutral</emotion>',
    '  <activity>thinking</activity>',
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
