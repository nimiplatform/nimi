import { createNimiReactConversationStore } from './index';

export const reactConversationStateExample = createNimiReactConversationStore([
  { type: 'conversation.started' },
  { type: 'conversation.text_delta', text: 'hello' },
  { type: 'conversation.completed', finishReason: 'stop' },
]);
