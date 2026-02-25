import type { UiExtensionContext } from '@renderer/mod-ui/contracts';

export type QueryDefinition = {
  id: string;
  label: string;
  capability: string;
  query: Record<string, unknown>;
  autoload: boolean;
};

export type ActionDefinition =
  | {
      id: string;
      label: string;
      type: 'set-fields';
      fields: Record<string, string>;
    }
  | {
      id: string;
      label: string;
      type: 'set-fields-from-query-selection';
      queryId: string;
      bindings: Record<string, string>;
      defaults: Record<string, string>;
    };

export type QueryResultsMap = Record<string, Array<Record<string, unknown>>>;
export type SelectedIndexMap = Record<string, number>;

export type RuntimeQueryPanelProps = {
  extensionId: string;
  modId: string;
  extension: Record<string, unknown>;
  context: UiExtensionContext;
};
