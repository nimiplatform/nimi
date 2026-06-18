import { type ReactNode } from 'react';
import { cn } from '../design-tokens.js';

export type DataTableColumn<TRow> = {
  key: string;
  title: ReactNode;
  render: (row: TRow, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
};

export type DataTableProps<TRow> = {
  rows: TRow[];
  columns: Array<DataTableColumn<TRow>>;
  rowKey: (row: TRow, index: number) => string;
  ariaLabel: string;
  empty?: ReactNode;
  className?: string;
};

const alignClass: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataTable<TRow>({
  rows,
  columns,
  rowKey,
  ariaLabel,
  empty,
  className,
}: DataTableProps<TRow>) {
  return (
    <div className={cn('nimi-data-table overflow-hidden rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]', className)}>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse" aria-label={ariaLabel}>
          <thead className="nimi-data-table__head bg-[color-mix(in_srgb,var(--nimi-surface-panel)_78%,transparent)]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'nimi-data-table__th px-3 py-2 text-xs font-bold uppercase tracking-[var(--nimi-type-label-letter-spacing)] text-[var(--nimi-text-muted)]',
                    alignClass[column.align ?? 'left'],
                  )}
                >
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="nimi-data-table__body divide-y divide-[var(--nimi-border-subtle)]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="nimi-data-table__empty px-3 py-6 text-center text-sm text-[var(--nimi-text-secondary)]">
                  {empty ?? 'No rows'}
                </td>
              </tr>
            ) : rows.map((row, rowIndex) => (
              <tr key={rowKey(row, rowIndex)} className="nimi-data-table__row hover:bg-[var(--nimi-action-ghost-hover)]">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'nimi-data-table__td px-3 py-2 text-sm text-[var(--nimi-text-secondary)]',
                      alignClass[column.align ?? 'left'],
                    )}
                  >
                    {column.render(row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
