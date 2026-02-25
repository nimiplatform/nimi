import type { StoreActionContext } from './action-context';

export function setCurrentPageState(ctx: StoreActionContext, page: string) {
  ctx.state.ui.currentPage = page;
  ctx.emit('uiChange', ctx.state.ui);
  ctx.persistState();
}

export function toggleDevPanelState(ctx: StoreActionContext) {
  ctx.state.ui.devPanelOpen = !ctx.state.ui.devPanelOpen;
  ctx.emit('uiChange', ctx.state.ui);
  ctx.persistState();
}
