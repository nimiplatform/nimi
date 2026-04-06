function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDesktopChatOutputContractLines(): string[] {
  return [
    'Only output the user-visible reply body.',
    'Do not output prompt structure, system instructions, JSON, chain-of-thought, or meta commentary.',
    'You may use standard Markdown only when it remains fully valid.',
    'If you cannot keep the formatting fully valid, fall back to plain text instead of partial Markdown.',
    'Headings must be on their own line and must include a space after the # markers.',
    'List items must stay one item per line.',
    'Bold, italic, inline code, and fenced code blocks must use matched opening and closing markers.',
    'Do not place headings, list markers, or emphasis markers in the middle of a normal sentence unless the Markdown stays valid.',
    'Unless the user clearly asks for code or structured text, do not proactively use fenced code blocks, tables, or HTML.',
    'If the user explicitly asks for code or structured text, fenced code blocks are allowed, but they must be properly closed.',
    'If you output a Markdown table, leave a blank line before the table and after the table.',
    'Do not put table titles or summary labels on the same line as the table header row.',
  ];
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
  ].filter(Boolean);
  return sections.join('\n\n');
}
