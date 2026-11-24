/** Limit a text result by Unicode code points without splitting a surrogate pair. */
export function textPreview(text: string, limit = 16384) {
  let length = 0;
  let offset = 0;
  for (const character of text) {
    if (length === limit) return { text: text.slice(0, offset), truncated: true };
    offset += character.length;
    length++;
  }
  return { text, truncated: false };
}

/** A live view follows the end of the reply even after it fills the preview. */
export function progressText(text: string) {
  const limit = 8192;
  if (text.length <= limit) return { text, truncated: false };
  // A code point spans at most two UTF-16 units. Only inspect this bounded tail.
  const tail = Array.from(text.slice(-2 * limit)).slice(-limit).join('');
  return { text: tail, truncated: tail.length !== text.length };
}
