import { useEffect, useMemo, useState } from 'react';
import { getRuntimeHookRuntime } from '@runtime/mod';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { executeRuntimeQuery } from './runtime-query/execute';
import { applyRuntimeFields, resolveActionFields, summarizeRecord } from './runtime-query/field-bindings';
import { parseActions, parseQueries } from './runtime-query/parse';
import type { ActionDefinition, QueryDefinition, QueryResultsMap, RuntimeQueryPanelProps, SelectedIndexMap } from './runtime-query/types';
import { RuntimeQueryPanelView } from './runtime-query/view';

export function RuntimeQueryPanel(props: RuntimeQueryPanelProps) {
  const { extensionId, modId, extension, context } = props;
  const flowId = useMemo(() => createRendererFlowId(`mod-ui-${extensionId}`), [extensionId]);
  const hookRuntime = useMemo(() => getRuntimeHookRuntime(), []);
  const queries = useMemo(() => parseQueries(extension), [extension]);
  const actions = useMemo(() => parseActions(extension), [extension]);

  const [queryResults, setQueryResults] = useState<QueryResultsMap>({});
  const [selectedIndexMap, setSelectedIndexMap] = useState<SelectedIndexMap>({});
  const [loadingQueryId, setLoadingQueryId] = useState<string | null>(null);

  const runQuery = async (query: QueryDefinition) => {
    setLoadingQueryId(query.id);
    try {
      const records = await executeRuntimeQuery(hookRuntime, modId, query);
      setQueryResults((state) => ({
        ...state,
        [query.id]: records,
      }));
      setSelectedIndexMap((state) => ({
        ...state,
        [query.id]: 0,
      }));
      logRendererEvent({
        level: 'info',
        area: 'mod-ui',
        message: 'action:runtime-query-panel:query-done',
        flowId,
        details: {
          extensionId,
          queryId: query.id,
          capability: query.capability,
          resultCount: records.length,
        },
      });
    } catch (error) {
      logRendererEvent({
        level: 'error',
        area: 'mod-ui',
        message: 'action:runtime-query-panel:query-failed',
        flowId,
        details: {
          extensionId,
          queryId: query.id,
          capability: query.capability,
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    } finally {
      setLoadingQueryId(null);
    }
  };

  useEffect(() => {
    const autoloadQueries = queries.filter((query) => query.autoload);
    if (autoloadQueries.length === 0) {
      return;
    }
    for (const query of autoloadQueries) {
      void runQuery(query);
    }
  }, [queries]);

  const runAction = async (action: ActionDefinition) => {
    const fields = resolveActionFields(action, queryResults, selectedIndexMap);
    applyRuntimeFields(context, fields);
    logRendererEvent({
      level: 'info',
      area: 'mod-ui',
      message: 'action:runtime-query-panel:action-applied',
      flowId,
      details: {
        extensionId,
        actionId: action.id,
        actionType: action.type,
        fieldCount: Object.keys(fields).length,
      },
    });
  };

  const title = String(extension.title || modId).trim() || modId;
  const description = String(extension.description || '').trim();

  return (
    <RuntimeQueryPanelView
      title={title}
      modId={modId}
      description={description}
      queries={queries}
      actions={actions}
      queryResults={queryResults}
      selectedIndexMap={selectedIndexMap}
      loadingQueryId={loadingQueryId}
      onRunQuery={(query) => { void runQuery(query); }}
      onSelectIndex={(queryId, selectedIndex) => {
        setSelectedIndexMap((state) => ({
          ...state,
          [queryId]: selectedIndex,
        }));
      }}
      onRunAction={(action) => { void runAction(action); }}
      summarizeRecord={summarizeRecord}
    />
  );
}
