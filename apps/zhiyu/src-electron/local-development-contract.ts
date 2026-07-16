const LOCAL_AGENT_ID_PATTERN = /^local-agent:runtime-[0-9a-f]{32}$/u;

export type ZhiyuLocalDevelopmentSelectorInput = {
  readonly localDevelopment: boolean;
  readonly selector: string | undefined;
};

export function resolveZhiyuLocalDevelopmentAgentId(
  input: ZhiyuLocalDevelopmentSelectorInput,
): string | undefined {
  if (!input.localDevelopment) {
    if (input.selector !== undefined) {
      throw new Error('Zhiyu local-development Agent selector is forbidden outside local development.');
    }
    return undefined;
  }
  if (input.selector === undefined) {
    return undefined;
  }
  const selector = input.selector.trim();
  if (!LOCAL_AGENT_ID_PATTERN.test(selector)) {
    throw new Error('Zhiyu local-development Agent selector is invalid.');
  }
  return selector;
}
