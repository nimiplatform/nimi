export type CanonicalMessageSelection = {
  readonly text: string;
  readonly sourceText: string;
  readonly startUtf16: number;
  readonly endUtf16: number;
  readonly startByte: number;
  readonly endByte: number;
};

type TextSegment = { node: Text; start: number; end: number; nodeStart: number };
type TextMap = { text: string; segments: TextSegment[] };
const empty = (): TextMap => ({ text: '', segments: [] });

/** One readable-text walk powers copying and DOM selection offsets. UI chrome is excluded. */
// @nimi-authority: rule.nimi.runtime.conversation-message-interaction.quote-format
export function readMessageText(root: HTMLElement) {
  const join = (values: TextMap[], separator: string, keepEmpty = false): TextMap => {
    const output = empty();
    for (const value of keepEmpty ? values : values.filter(item => item.text !== '')) {
      if (output.segments.length || output.text) output.text += separator;
      const start = output.text.length;
      output.segments.push(...value.segments.map(item => ({ ...item, start: item.start + start, end: item.end + start })));
      output.text += value.text;
    }
    // Empty first/last table cells carry meaningful TAB separators.
    if (keepEmpty) {
      output.text = values.map(value => value.text).join(separator);
      output.segments = [];
      let start = 0;
      for (const value of values) { output.segments.push(...value.segments.map(item => ({ ...item, start: item.start + start, end: item.end + start }))); start += value.text.length + separator.length; }
    }
    return output;
  };
  const walk = (node: Node): TextMap => {
    if (node.nodeType === Node.TEXT_NODE) {
      let value = node.textContent || '';
      let nodeStart = 0;
      if (node.previousSibling instanceof HTMLInputElement && node.previousSibling.type === 'checkbox' && value.startsWith(' ')) { value = value.slice(1); nodeStart = 1; }
      if (node.previousSibling instanceof HTMLBRElement && value.startsWith('\n')) { value = value.slice(1); nodeStart = 1; }
      return { text: value, segments: [{ node: node as Text, start: 0, end: value.length, nodeStart }] };
    }
    if (!(node instanceof HTMLElement)) return empty();
    if (node.matches('[data-chat-copy-ignore], [aria-hidden="true"], button, input, img, video, audio, script, style')) return empty();
    if (node.tagName === 'BR') return { text: '\n', segments: [] };
    if (node.hasAttribute('data-chat-code-text')) {
      const text = node.getAttribute('data-chat-code-text') || '';
      const segments: TextSegment[] = [];
      for (const line of node.querySelectorAll<HTMLElement>('[data-chat-code-offset]')) {
        let offset = Number(line.dataset.chatCodeOffset);
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let textNode: Node | null;
        while ((textNode = walker.nextNode())) { const length = textNode.textContent?.length || 0; segments.push({ node: textNode as Text, start: offset, end: offset + length, nodeStart: 0 }); offset += length; }
      }
      return { text, segments };
    }
    const structural = node.hasAttribute('data-chat-markdown') || ['UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR'].includes(node.tagName);
    const children = Array.from(node.childNodes).filter(child => !(structural && child.nodeType === Node.TEXT_NODE && /^\s*$/.test(child.textContent || '')));
    const separator = node.hasAttribute('data-chat-markdown') || ['BLOCKQUOTE', 'LI'].includes(node.tagName) ? '\n\n'
      : ['UL', 'OL', 'TABLE', 'THEAD', 'TBODY'].includes(node.tagName) ? '\n'
        : node.tagName === 'TR' ? '\t' : '';
    return join(children.map(walk), separator, node.tagName === 'TR');
  };
  return walk(root);
}

export function captureMessageSelection(root: HTMLElement): { kind: 'none' | 'outside' } | { kind: 'selected'; selection: CanonicalMessageSelection } {
  const selected = root.ownerDocument.getSelection();
  if (!selected || selected.isCollapsed || !selected.rangeCount) return { kind: 'none' };
  const range = selected.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return { kind: 'outside' };
  const mapping = readMessageText(root);
  const position = (container: Node, offset: number, end: boolean): number | null => {
    const direct = mapping.segments.find(item => item.node === container);
    if (direct) return Math.max(direct.start, Math.min(direct.start + offset - direct.nodeStart, direct.end));
    if (!(container instanceof Element)) return null;
    const child = container.childNodes[offset];
    if (child) {
      const segment = mapping.segments.find(item => child === item.node || child.contains(item.node));
      if (segment) return segment.start;
    }
    const contained = mapping.segments.filter(item => container.contains(item.node));
    return end && contained.length ? contained[contained.length - 1]!.end : null;
  };
  const start = position(range.startContainer, range.startOffset, false);
  const end = position(range.endContainer, range.endOffset, true);
  if (start === null || end === null || start >= end) return { kind: 'outside' };
  return { kind: 'selected', selection: {
    text: mapping.text.slice(start, end), sourceText: mapping.text, startUtf16: start, endUtf16: end,
    startByte: new TextEncoder().encode(mapping.text.slice(0, start)).length,
    endByte: new TextEncoder().encode(mapping.text.slice(0, end)).length,
  } };
}

export function highlightMessageQuote(root: HTMLElement, range: { startByte: number; endByte: number }) {
  const mapping = readMessageText(root);
  const bytes = new TextEncoder().encode(mapping.text);
  if (range.endByte > bytes.length) return false;
  let start: number; let end: number;
  try { const decoder = new TextDecoder('utf-8', { fatal: true }); start = decoder.decode(bytes.slice(0, range.startByte)).length; end = decoder.decode(bytes.slice(0, range.endByte)).length; }
  catch { return false; }
  const first = mapping.segments.find(segment => segment.start <= start && segment.end >= start);
  const last = mapping.segments.find(segment => segment.start <= end && segment.end >= end);
  if (!first || !last) return false;
  const selection = root.ownerDocument.getSelection();
  const domRange = root.ownerDocument.createRange();
  domRange.setStart(first.node, start - first.start + first.nodeStart);
  domRange.setEnd(last.node, end - last.start + last.nodeStart);
  selection?.removeAllRanges(); selection?.addRange(domRange);
  return true;
}
