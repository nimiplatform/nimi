import type { InvokeRequest } from '../types';
import type { UsageRecordInput, UsageTracker } from '../usage-tracker';

export class UsageService {
  constructor(private readonly usageTracker?: UsageTracker) {}

  estimatePromptTokens(request: InvokeRequest) {
    const text = request.messages
      .map((message) => {
        if (typeof message.content === 'string') {
          return message.content;
        }
        try {
          return JSON.stringify(message.content);
        } catch {
          return String(message.content);
        }
      })
      .join('\n');
    const normalized = text.trim();
    if (!normalized) {
      return 0;
    }
    return Math.max(1, Math.ceil(normalized.length / 4));
  }

  estimateCompletionTokens(content: string) {
    const normalized = String(content || '').trim();
    if (!normalized) {
      return 0;
    }
    return Math.max(1, Math.ceil(normalized.length / 4));
  }

  async recordUsage(input: UsageRecordInput) {
    if (!this.usageTracker) {
      return;
    }
    await this.usageTracker.record(input);
  }
}
