import { useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import type { Alert } from '../lib/api';
import SeverityBadge from './SeverityBadge';
import { useSession } from '../store/session';

const columnHelper = createColumnHelper<Alert>();

export interface AlertTableProps {
  alerts: Alert[];
  onOpen: (alert: Alert) => void;
  onBulk: (action: 'ack' | 'assign' | 'link-case', ids: string[], extra?: string) => void;
}

/** TanStack Table with row selection + bulk actions (ack / assign / link case). */
export default function AlertTable({ alerts, onOpen, onBulk }: AlertTableProps): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'ts', desc: true }]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const isReadOnly = useSession((s) => s.isReadOnly());

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all alerts"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select alert ${row.original.ruleTitle}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      }),
      columnHelper.accessor('ts', {
        header: 'Time',
        cell: (info) => new Date(info.getValue()).toLocaleString(),
      }),
      columnHelper.accessor('severity', {
        header: 'Severity',
        cell: (info) => <SeverityBadge severity={info.getValue()} />,
      }),
      columnHelper.accessor('ruleTitle', { header: 'Rule' }),
      columnHelper.accessor((a) => a.source.system, { id: 'system', header: 'Source' }),
      columnHelper.accessor('tenantId', { header: 'Tenant', cell: (info) => info.getValue() ?? '—' }),
      columnHelper.accessor('status', { header: 'Status' }),
      columnHelper.accessor('count', { header: 'Count' }),
      columnHelper.accessor('assignee', { header: 'Assignee', cell: (info) => info.getValue() ?? '—' }),
    ],
    [],
  );

  const table = useReactTable({
    data: alerts,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: !isReadOnly,
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  return (
    <div>
      {selectedIds.length > 0 && (
        <div role="toolbar" aria-label="Bulk actions" className="mb-3 flex items-center gap-2 rounded-md bg-brand-50 p-2">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <button type="button" className="btn-secondary" onClick={() => onBulk('ack', selectedIds)}>
            Acknowledge
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const assignee = window.prompt('Assign to (username):');
              if (assignee) onBulk('assign', selectedIds, assignee);
            }}
          >
            Assign…
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const caseId = window.prompt('Link to case id:');
              if (caseId) onBulk('link-case', selectedIds, caseId);
            }}
          >
            Link to case…
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className="px-3 py-2 font-semibold">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className="flex items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: '▲', desc: '▼' }[header.column.getIsSorted() as string] ?? null}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => onOpen(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2" onClick={(e) => cell.column.id === 'select' && e.stopPropagation()}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                  No alerts match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
