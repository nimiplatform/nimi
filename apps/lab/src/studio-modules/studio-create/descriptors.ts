export type StudioCreateCapabilityId = 'text.generate' | 'chat.stream' | 'text.embed';

export const studioCreateDescriptors = Object.freeze([
  {
    id: 'text.generate', label: 'Text Studio', labelKey: 'Capabilities.textGenerate.label', group: 'text',
    section: 'chat',
    summary: 'Prompt → text.generate CapabilityContract → typed Runtime result.',
    summaryKey: 'Capabilities.textGenerate.summary',
    surface: 'sdk.localApp.ai.text.generateCandidate → RuntimeAiService.GenerateLocalAppTextCandidate',
    execution: 'runtime-sdk', capabilityContract: 'text.generate',
  },
  {
    id: 'chat.stream', label: 'Chat Stream', labelKey: 'Capabilities.chatStream.label', group: 'text',
    section: 'chat',
    summary: 'Conversation turn → protected text.generate stream → incremental typed Runtime result.',
    summaryKey: 'Capabilities.chatStream.summary', surface: 'kit.runRuntimeAIConsumeCapability → sdk.localApp.ai.text.streamTurn',
    execution: 'runtime-sdk', capabilityContract: 'text.generate',
  },
  {
    id: 'text.embed', label: 'Embeddings', labelKey: 'Capabilities.textEmbed.label', group: 'text',
    section: 'embed',
    summary: 'Input string → protected scenario.execute text.embed → typed vector result.',
    summaryKey: 'Capabilities.textEmbed.summary', surface: 'sdk.localApp.ai.scenario.execute:text-embed',
    execution: 'runtime-sdk', capabilityContract: 'text.embed',
  },
] as const);
