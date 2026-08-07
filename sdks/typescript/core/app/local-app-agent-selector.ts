declare const localAppAgentSelectorBrand: unique symbol;

/** Opaque selector projected by Runtime for a future protected App session. */
export type NimiLocalAppAgentHandle = string & {
  readonly [localAppAgentSelectorBrand]: 'runtime-local-app-agent-selector';
};
