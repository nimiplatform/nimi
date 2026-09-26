import { asRecord, assertExactKeys, localAppError } from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAgentWorkInput = {
  readonly workId: string;
  readonly routineName?: string;
  readonly instructions: string;
  readonly sources: readonly { readonly sourceId: string; readonly title: string; readonly content: string }[];
  readonly tools: readonly { readonly name: string; readonly description: string; readonly inputSchemaJson: string }[];
};
export type NimiLocalAppAgentWorkToolCall = {
  readonly callId: string; readonly executionId: string; readonly name: string; readonly argumentsJson: string;
};

function invalid(): never {
  return localAppError('Local-app work input is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_bounded_app_work');
}
export function workText(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\u0000') || new TextEncoder().encode(value).byteLength > max) invalid();
  return value;
}
export function validateAgentWork(value: unknown): NimiLocalAppAgentWorkInput {
  const work = asRecord(value);
  assertExactKeys(work, work?.routineName === undefined ? ['workId', 'instructions', 'sources', 'tools'] : ['workId', 'instructions', 'sources', 'tools', 'routineName'], 'App work');
  if (!Array.isArray(work?.sources) || work.sources.length > 16 || !Array.isArray(work.tools) || work.tools.length > 16) invalid();
  const sourceIds = new Set<string>(); const toolNames = new Set<string>();
  const result = {
    ...(work.routineName === undefined ? {} : { routineName: workText(work.routineName, 128) }),
    workId: workText(work.workId, 256), instructions: workText(work.instructions, 8192, true),
    sources: work.sources.map((value) => {
      const source = asRecord(value);
      assertExactKeys(source, ['sourceId', 'title', 'content'], 'App work source');
      const sourceId = workText(source?.sourceId, 256);
      if (sourceIds.has(sourceId)) invalid(); sourceIds.add(sourceId);
      return { sourceId, title: workText(source?.title, 256), content: workText(source?.content, 16384) };
    }),
    tools: work.tools.map((value) => {
      const tool = asRecord(value);
      assertExactKeys(tool, ['name', 'description', 'inputSchemaJson'], 'App work tool');
      const name = workText(tool?.name, 64);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(name) || toolNames.has(name)) invalid(); toolNames.add(name);
      const inputSchemaJson = workText(tool?.inputSchemaJson, 8192);
      try { if (JSON.parse(inputSchemaJson)?.type !== 'object') invalid(); } catch { invalid(); }
      return { name, description: workText(tool?.description, 2048, true), inputSchemaJson };
    }),
  };
  workText(JSON.stringify(result), 65536);
  return result;
}
