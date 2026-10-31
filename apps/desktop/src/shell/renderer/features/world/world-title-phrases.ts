// Keep authored clauses together when they fit. CSS still wraps a clause
// longer than its container, so arbitrary titles need no inserted line breaks.
export function worldTitlePhrases(text: string): string[] {
  return text.match(/[^，。；：！？、,;:!?\n]*[，。；：！？、,;:!?\n]+[”’」』）】]*|[^，。；：！？、,;:!?\n]+/gu) ?? [];
}
