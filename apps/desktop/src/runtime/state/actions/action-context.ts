import type {
  MessageListState,
  StoreEventMap,
  StoreState,
} from '../store-types';

export type StoreActionContext = {
  state: StoreState;
  persistState: () => void;
  emit: <K extends keyof StoreEventMap>(event: K, payload: StoreEventMap[K]) => void;
};

export const EMPTY_MESSAGE_LIST: MessageListState = {
  items: [],
  cursor: null,
  hasMore: false,
  isLoading: false,
};
