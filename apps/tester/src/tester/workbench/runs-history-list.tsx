import { EmptyState, ScrollArea, StatusBadge } from '@nimiplatform/kit/ui';
import { Boxes } from 'lucide-react';
import {
  flattenTesterRunHistory,
  formatTesterRunTimestamp,
  getTesterRunStatusLabel,
  getTesterRunStatusTone,
  type TesterFlatRunRecord,
  type TesterRunHistory,
} from '../tester-history.js';

type RunsHistoryListProps = {
  history: TesterRunHistory | null;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  selectedRecordId?: string | null;
  onSelectRecord?: (record: TesterFlatRunRecord) => void;
  showMessage?: boolean;
};

export function RunsHistoryList({
  history,
  limit,
  emptyTitle = 'No runs captured yet',
  emptyDescription = 'Trigger a capability lane or resolve a typed blocker to populate this list.',
  className,
  selectedRecordId,
  onSelectRecord,
  showMessage = false,
}: RunsHistoryListProps) {
  const flat = flattenTesterRunHistory(history);
  const visible = typeof limit === 'number' ? flat.slice(0, limit) : flat;

  if (!visible.length) {
    return (
      <EmptyState
        icon={<Boxes size={18} />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <ScrollArea className={className ? `runs-history ${className}` : 'runs-history'}>
      <ul className="runs-history__list">
        {visible.map((record) => {
          const rowClassName = [
            'runs-history__row',
            record.status === 'local-fixture' ? 'runs-history__row--local-fixture' : '',
            selectedRecordId === record.id ? 'runs-history__row--selected' : '',
          ].filter(Boolean).join(' ');
          const rowContent = (
            <>
              <div className="runs-history__row-main">
                <span className="runs-history__capability">{record.capabilityLabel}</span>
                <span className="runs-history__prompt" title={record.prompt}>{record.prompt}</span>
                {showMessage ? <span className="runs-history__message" title={record.message}>{record.message}</span> : null}
              </div>
              <div className="runs-history__row-meta">
                <StatusBadge tone={getTesterRunStatusTone(record.status)} shape="dot">
                  {getTesterRunStatusLabel(record.status)}
                </StatusBadge>
                <span className="runs-history__time">{formatTesterRunTimestamp(record.createdAt)}</span>
              </div>
            </>
          );
          return (
            <li key={record.id}>
              {onSelectRecord ? (
                <button
                  type="button"
                  className={rowClassName}
                  onClick={() => onSelectRecord(record)}
                  aria-pressed={selectedRecordId === record.id ? true : undefined}
                >
                  {rowContent}
                </button>
              ) : (
                <div className={rowClassName}>{rowContent}</div>
              )}
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
