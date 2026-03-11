import { normalizePageIdV11, type RuntimePageIdV11 } from './runtime-config-state-types';

const RUNTIME_CONFIG_OPEN_PAGE_EVENT = 'nimi://runtime-config-open-page';

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
