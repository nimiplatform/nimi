import {
  normalizePageIdV11,
  normalizeRuntimeConfigActionFocus,
  type RuntimeConfigActionFocus,
  type RuntimePageIdV11,
} from './runtime-config-state-types';

const RUNTIME_CONFIG_OPEN_PAGE_EVENT = 'nimi://runtime-config-open-page';
const RUNTIME_CONFIG_ACTION_FOCUS_EVENT = 'nimi://runtime-config-action-focus';

export function dispatchRuntimeConfigOpenPage(pageId: RuntimePageIdV11): void {
  window.dispatchEvent(new CustomEvent<RuntimePageIdV11>(RUNTIME_CONFIG_OPEN_PAGE_EVENT, {
    detail: pageId,
  }));
}

export function addRuntimeConfigOpenPageListener(
  onOpenPage: (pageId: RuntimePageIdV11) => void,
): () => void {
  const handleEvent = (event: Event) => {
    const openPageEvent = event as CustomEvent<unknown>;
    onOpenPage(normalizePageIdV11(openPageEvent.detail));
  };

  window.addEventListener(RUNTIME_CONFIG_OPEN_PAGE_EVENT, handleEvent);
  return () => {
    window.removeEventListener(RUNTIME_CONFIG_OPEN_PAGE_EVENT, handleEvent);
  };
}

export function dispatchRuntimeConfigActionFocus(actionFocus: RuntimeConfigActionFocus): void {
  window.dispatchEvent(new CustomEvent<RuntimeConfigActionFocus>(RUNTIME_CONFIG_ACTION_FOCUS_EVENT, {
    detail: actionFocus,
  }));
}

export function addRuntimeConfigActionFocusListener(
  onActionFocus: (actionFocus: RuntimeConfigActionFocus) => void,
): () => void {
  const handleEvent = (event: Event) => {
    const openActionFocusEvent = event as CustomEvent<unknown>;
    const actionFocus = normalizeRuntimeConfigActionFocus(openActionFocusEvent.detail);
    if (actionFocus) {
      onActionFocus(actionFocus);
    }
  };

  window.addEventListener(RUNTIME_CONFIG_ACTION_FOCUS_EVENT, handleEvent);
  return () => {
    window.removeEventListener(RUNTIME_CONFIG_ACTION_FOCUS_EVENT, handleEvent);
  };
}
