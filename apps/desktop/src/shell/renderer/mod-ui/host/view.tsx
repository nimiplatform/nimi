import { i18n } from '@renderer/i18n';
import type { ActionDefinition, QueryDefinition, QueryResultsMap, SelectedIndexMap } from './types';

export type RuntimeQueryPanelViewProps = {
  title: string;
  modId: string;
  description: string;
  queries: QueryDefinition[];
  actions: ActionDefinition[];
  queryResults: QueryResultsMap;
  selectedIndexMap: SelectedIndexMap;
  loadingQueryId: string | null;
  onRunQuery: (query: QueryDefinition) => void;
  onSelectIndex: (queryId: string, selectedIndex: number) => void;
  onRunAction: (action: ActionDefinition) => void;
  summarizeRecord: (record: Record<string, unknown>, index: number) => string;
};

export function RuntimeQueryPanelView(props: RuntimeQueryPanelViewProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{props.title}</h3>
        <span className="text-xs text-gray-500">{props.modId}</span>
      </div>
      {props.description ? <p className="mb-3 text-xs text-gray-600">{props.description}</p> : null}

      <div className="space-y-2">
        {props.queries.map((query) => {
          const records = props.queryResults[query.id] || [];
          const selectedIndex = props.selectedIndexMap[query.id] ?? 0;
          return (
            <div key={query.id} className="rounded-lg border border-gray-200 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-700">{query.label}</span>
                <button
                  type="button"
                  onClick={() => props.onRunQuery(query)}
                  className="rounded-md bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-60"
                  disabled={props.loadingQueryId === query.id}
                >
                  {props.loadingQueryId === query.id
                    ? i18n.t('ModUI.queryLoading', { defaultValue: 'Loading...' })
                    : i18n.t('ModUI.queryRun', { defaultValue: 'Run' })}
                </button>
              </div>
              {records.length > 0 ? (
                <select
                  className="mt-2 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                  value={String(selectedIndex)}
                  onChange={(event) => {
                    const next = Number.parseInt(String(event.target.value || '0'), 10);
                    props.onSelectIndex(query.id, Number.isInteger(next) ? next : 0);
                  }}
                >
                  {records.map((record, index) => (
                    <option key={`${query.id}-${index}`} value={String(index)}>
                      {props.summarizeRecord(record, index)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>

      {props.actions.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-2">
          {props.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => props.onRunAction(action)}
              className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-left text-xs text-brand-800 hover:bg-brand-100"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
