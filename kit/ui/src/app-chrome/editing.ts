import type { NimiChromeNativeCommand } from '@nimiplatform/kit/shell/capabilities';

type Input = HTMLInputElement | HTMLTextAreaElement;
type SelectionSnapshot =
  | { kind: 'input'; target: Input; start: number; end: number; direction: 'forward' | 'backward' | 'none' }
  | { kind: 'document'; range: Range; target: HTMLElement | null }
  | { kind: 'page' };

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome-native
export function createNimiChromeEditingOwner(doc: Document) {
  let saved: SelectionSnapshot | null = null;
  const isInput = (node: unknown): node is Input => node instanceof doc.defaultView!.HTMLInputElement || node instanceof doc.defaultView!.HTMLTextAreaElement;
  const live = (node: Node) => node.isConnected && node.ownerDocument === doc
    && !(node instanceof doc.defaultView!.HTMLElement && node.closest('[hidden], [aria-hidden="true"]'));
  const visible = (node: HTMLElement) => {
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      const style = doc.defaultView!.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return live(node);
  };
  const writable = () => saved?.kind === 'input'
    ? live(saved.target) && visible(saved.target) && !saved.target.disabled && !saved.target.readOnly
    : saved?.kind === 'document' && saved.target && visible(saved.target) && saved.target.isContentEditable;
  const capture = () => {
    const active = doc.activeElement;
    if (active instanceof doc.defaultView!.HTMLElement && active.closest('[role="menubar"], [role="menu"], .nimi-app-chrome')) return;
    if (isInput(active) && active.selectionStart !== null && active.selectionEnd !== null) {
      saved = { kind: 'input', target: active, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection ?? 'none' };
      return;
    }
    const selection = doc.getSelection();
    if (selection?.rangeCount && (!selection.isCollapsed || active instanceof doc.defaultView!.HTMLElement && active.isContentEditable)) {
      const range = selection.getRangeAt(0);
      const element = range.commonAncestorContainer instanceof doc.defaultView!.HTMLElement
        ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      saved = { kind: 'document', range: range.cloneRange(), target: element?.closest<HTMLElement>('[contenteditable="true"], [contenteditable=""]') ?? null };
    } else if (active instanceof doc.defaultView!.HTMLElement && active.isContentEditable) {
      const range = doc.createRange(); range.selectNodeContents(active); range.collapse(true);
      saved = { kind: 'document', range, target: active };
    } else saved = { kind: 'page' };
  };
  const canExecute = (command: NimiChromeNativeCommand): boolean => {
    if (!saved) return false;
    if (saved.kind === 'input' && (!visible(saved.target) || saved.target.disabled || saved.end > saved.target.value.length)) return false;
    if (saved.kind === 'document' && [saved.range.startContainer, saved.range.endContainer].some(node => !live(node) || !visible(node instanceof doc.defaultView!.HTMLElement ? node : node.parentElement!))) return false;
    if (command === 'select-all') return true;
    const selected = saved.kind === 'input' ? saved.end > saved.start : saved.kind === 'document' && !saved.range.collapsed;
    if (command === 'copy') return selected;
    if (command === 'cut') return Boolean(writable() && selected);
    return Boolean(writable());
  };
  return {
    capture, canExecute,
    isEditing: () => {
      const active = doc.activeElement;
      return isInput(active) || active instanceof doc.defaultView!.HTMLElement && active.isContentEditable;
    },
    invalidate: () => { saved = null; },
    restore(command: NimiChromeNativeCommand) {
      if (!canExecute(command)) throw new Error('The original edit target or selection is no longer available.');
      if (saved?.kind === 'input') {
        saved.target.focus({ preventScroll: true });
        saved.target.setSelectionRange(saved.start, saved.end, saved.direction);
      } else if (saved?.kind === 'document') {
        if (saved.target) saved.target.focus({ preventScroll: true });
        else if (doc.activeElement instanceof doc.defaultView!.HTMLElement) doc.activeElement.blur();
        const selection = doc.getSelection(); selection?.removeAllRanges(); selection?.addRange(saved.range);
      } else if (doc.activeElement instanceof doc.defaultView!.HTMLElement) doc.activeElement.blur();
    },
  };
}
