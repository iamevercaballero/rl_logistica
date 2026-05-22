/**
 * DataTable — RL Logística Design System
 *
 * Features:
 *  - TanStack Table v8: sort (multi-column), column-level filter, column visibility
 *  - TanStack Virtual v3: row virtualization (opt-in, for 200+ row lists)
 *  - Selection: checkbox per row + batch-action bar
 *  - Expandable rows: custom sub-component
 *  - CSV export (client-side)
 *  - Sticky header
 *  - Loading skeleton, empty state
 *  - Client-side or server-side pagination
 *
 * Usage (client-side):
 * ```tsx
 * const cols = createColumnHelper<MyRow>();
 * const columns = [
 *   cols.accessor('name', { header: 'Nombre' }),
 *   cols.accessor('qty',  { header: 'Cantidad', meta: { align: 'right' } }),
 * ];
 * <DataTable data={rows} columns={columns} enableExport exportFilename="stock" />
 * ```
 */

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type ExpandedState,
  type Row,
  type Table,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from 'react';
import './DataTable.css';

/* ── Public types ─────────────────────────────────────────────────────────── */

export type { ColumnDef };
export { createColumnHelper };

/** Column meta extensions (use via `meta` in ColumnDef). */
export interface ColumnMeta {
  align?: 'left' | 'center' | 'right';
  /** Hide column filter input even when global filters are on. */
  noFilter?: boolean;
  /** Fix column width. */
  width?: number | string;
}

export interface BatchAction<T> {
  label: string;
  icon?: ReactNode;
  variant?: 'default' | 'danger';
  onClick: (selectedRows: T[]) => void;
}

export interface ServerPagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];

  // Features
  enableSorting?: boolean;
  enableFiltering?: boolean;        // global search + per-column filters
  enableColumnVisibility?: boolean;
  enableSelection?: boolean;
  enableVirtualization?: boolean;   // activate for large lists (200+ rows)
  virtualHeight?: number;           // px height of scroll container when virtualized (default 480)

  // Expand
  renderSubComponent?: (row: Row<T>) => ReactNode;

  // Batch actions (shown when rows are selected)
  batchActions?: BatchAction<T>[];

  // Export
  enableExport?: boolean;
  exportFilename?: string;

  // Pagination — omit for fully client-side (shows all rows)
  pagination?: ServerPagination;

  // State
  isLoading?: boolean;
  emptyMessage?: ReactNode;
  caption?: string;

  // Style
  className?: string;
  style?: CSSProperties;
  maxHeight?: number | string;      // non-virtual scroll container max-height
}

/* ── Sort icon ────────────────────────────────────────────────────────────── */
function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  return (
    <span className="dt-sort-icon" aria-hidden="true">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
        <path d="M4 0 L7 4 H1 Z" opacity={direction === 'asc' ? 1 : 0.3} />
      </svg>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
        <path d="M4 8 L7 4 H1 Z" opacity={direction === 'desc' ? 1 : 0.3} />
      </svg>
    </span>
  );
}

/* ── CSV export ───────────────────────────────────────────────────────────── */
function exportToCsv<T>(
  rows: Row<T>[],
  columns: ColumnDef<T, any>[],
  filename: string,
) {
  const headers = columns
    .filter((c) => (c as { accessorKey?: string }).accessorKey !== undefined || (c as { id?: string }).id !== undefined)
    .map((c) => {
      if (typeof c.header === 'string') return c.header;
      return (c as { accessorKey?: string }).accessorKey ?? (c as { id?: string }).id ?? '';
    });

  const csvRows = rows.map((row) =>
    row
      .getVisibleCells()
      .map((cell) => {
        const val = cell.getValue();
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str}"`
          : str;
      })
      .join(','),
  );

  const csv = [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <tr key={i} className="dt-skeleton-row" aria-hidden="true">
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <div
                className="dt-skeleton-cell"
                style={{ width: `${60 + ((i * 3 + j * 7) % 35)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ── Pagination control ───────────────────────────────────────────────────── */
function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: ServerPagination) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Compute visible page numbers (max 7 slots)
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="dt-footer">
      <span className="dt-footer-info">
        {total === 0 ? 'Sin resultados' : `${from}–${to} de ${total}`}
      </span>

      {onPageSizeChange && (
        <select
          className="input"
          style={{ height: 28, fontSize: 12, padding: '0 24px 0 6px' }}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Filas por página"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>{n} / pág.</option>
          ))}
        </select>
      )}

      <nav className="dt-pagination" aria-label="Paginación">
        <button
          className="dt-page-btn"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          aria-label="Primera página"
        >‹‹</button>
        <button
          className="dt-page-btn"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label="Página anterior"
        >‹</button>

        {pages.map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="dt-page-btn" style={{ cursor: 'default', opacity: 0.5 }}>…</span>
          ) : (
            <button
              key={p}
              className={`dt-page-btn${page === p ? ' dt-page-btn--active' : ''}`}
              onClick={() => onPageChange(p)}
              aria-label={`Página ${p}`}
              aria-current={page === p ? 'page' : undefined}
            >
              {p}
            </button>
          ),
        )}

        <button
          className="dt-page-btn"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Página siguiente"
        >›</button>
        <button
          className="dt-page-btn"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          aria-label="Última página"
        >››</button>
      </nav>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export function DataTable<T>({
  data,
  columns,
  enableSorting: _enableSorting = true,
  enableFiltering = false,
  enableColumnVisibility = false,
  enableSelection = false,
  enableVirtualization = false,
  virtualHeight = 480,
  renderSubComponent,
  batchActions,
  enableExport = false,
  exportFilename = 'export',
  pagination,
  isLoading = false,
  emptyMessage = 'Sin resultados.',
  caption,
  className = '',
  style,
  maxHeight,
}: DataTableProps<T>) {
  /* State */
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [colVisOpen, setColVisOpen] = useState(false);

  /* Column visibility popover outside-click */
  const colVisRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!colVisOpen) return;
    const handler = (e: MouseEvent) => {
      if (!colVisRef.current?.contains(e.target as Node)) setColVisOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colVisOpen]);

  /* Build columns: inject select + expand columns */
  const allColumns: ColumnDef<T, any>[] = [
    ...(renderSubComponent
      ? [
          {
            id: '__expand',
            header: () => null,
            cell: ({ row }: { row: Row<T> }) => (
              <button
                className="dt-expand-btn"
                onClick={() => row.toggleExpanded()}
                aria-label={row.getIsExpanded() ? 'Contraer fila' : 'Expandir fila'}
                aria-expanded={row.getIsExpanded()}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  {row.getIsExpanded()
                    ? <polyline points="2,8 6,4 10,8" />
                    : <polyline points="2,4 6,8 10,4" />}
                </svg>
              </button>
            ),
            enableSorting: false,
            enableHiding: false,
          } as ColumnDef<T, any>,
        ]
      : []),
    ...(enableSelection
      ? [
          {
            id: '__select',
            header: ({ table }: { table: Table<T> }) => (
              <input
                type="checkbox"
                checked={table.getIsAllPageRowsSelected()}
                ref={(el) => {
                  if (el) el.indeterminate = table.getIsSomePageRowsSelected();
                }}
                onChange={table.getToggleAllPageRowsSelectedHandler()}
                aria-label="Seleccionar todas las filas"
                style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
            ),
            cell: ({ row }: { row: Row<T> }) => (
              <input
                type="checkbox"
                checked={row.getIsSelected()}
                onChange={row.getToggleSelectedHandler()}
                aria-label="Seleccionar fila"
                style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
            ),
            enableSorting: false,
            enableHiding: false,
          } as ColumnDef<T, any>,
        ]
      : []),
    ...columns,
  ];

  const table = useReactTable<T>({
    data,
    columns: allColumns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      rowSelection,
      expanded,
    },
    enableRowSelection: enableSelection,
    enableMultiSort: true,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    // Disable built-in pagination — we handle server-side externally
    manualPagination: !!pagination,
  });

  /* Virtualizer */
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 41,
    overscan: 10,
    enabled: enableVirtualization,
  });

  const virtualItems = enableVirtualization ? virtualizer.getVirtualItems() : null;
  const totalVirtualSize = enableVirtualization ? virtualizer.getTotalSize() : 0;

  /* Selected rows for batch actions */
  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((r) => r.original);
  const selectedCount = selectedRows.length;

  /* Export handler */
  const handleExport = useCallback(() => {
    exportToCsv(table.getFilteredRowModel().rows, columns, exportFilename);
  }, [table, columns, exportFilename]);

  /* Visible column count */
  const visibleColCount = table.getVisibleLeafColumns().length;

  /* Scroll container style */
  const scrollStyle: CSSProperties = enableVirtualization
    ? { height: virtualHeight, overflow: 'auto' }
    : maxHeight
    ? { maxHeight, overflow: 'auto' }
    : { overflow: 'auto' };

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className={`dt-wrap${className ? ' ' + className : ''}`} style={style}>

      {/* Toolbar */}
      {(enableFiltering || enableColumnVisibility || enableExport) && (
        <div className="dt-toolbar">
          {enableFiltering && (
            <input
              className="input dt-search"
              type="search"
              placeholder="Buscar…"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              aria-label="Búsqueda global en tabla"
            />
          )}

          <div className="dt-toolbar-right">
            {/* Column visibility */}
            {enableColumnVisibility && (
              <div className="dt-col-vis-wrap" ref={colVisRef}>
                <button
                  className="btn"
                  onClick={() => setColVisOpen((o) => !o)}
                  aria-haspopup="true"
                  aria-expanded={colVisOpen}
                  aria-label="Visibilidad de columnas"
                  title="Columnas visibles"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                  </svg>
                  Columnas
                </button>

                {colVisOpen && (
                  <div className="dt-col-vis-menu" role="dialog" aria-label="Columnas visibles">
                    {table.getAllLeafColumns()
                      .filter((col) => col.getCanHide())
                      .map((col) => (
                        <label key={col.id} className="dt-col-vis-item">
                          <input
                            type="checkbox"
                            checked={col.getIsVisible()}
                            onChange={col.getToggleVisibilityHandler()}
                          />
                          {typeof col.columnDef.header === 'string'
                            ? col.columnDef.header
                            : col.id}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* CSV export */}
            {enableExport && (
              <button
                className="btn"
                onClick={handleExport}
                disabled={rows.length === 0}
                aria-label="Exportar a CSV"
                title="Exportar CSV"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                CSV
              </button>
            )}
          </div>
        </div>
      )}

      {/* Batch action bar */}
      {enableSelection && selectedCount > 0 && batchActions && (
        <div className="dt-batch-bar" role="status" aria-live="polite">
          <span>{selectedCount} fila{selectedCount !== 1 ? 's' : ''} seleccionada{selectedCount !== 1 ? 's' : ''}</span>
          {batchActions.map((action, idx) => (
            <button
              key={idx}
              className={`btn${action.variant === 'danger' ? ' btn--danger' : ''}`}
              onClick={() => action.onClick(selectedRows)}
              style={{ height: 28, fontSize: 12 }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
          <button
            className="btn"
            onClick={() => table.resetRowSelection()}
            style={{ height: 28, fontSize: 12 }}
            aria-label="Cancelar selección"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Scroll container */}
      <div className="dt-scroll" style={scrollStyle} ref={scrollRef}>
        <table
          className="dt-table"
          aria-label={caption}
          aria-busy={isLoading}
          aria-rowcount={pagination ? pagination.total : data.length}
        >
          {caption && <caption className="sr-only">{caption}</caption>}

          <thead>
            {/* Header rows */}
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                  const isSortable = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const ariaSort =
                    sortDir === 'asc'
                      ? 'ascending'
                      : sortDir === 'desc'
                      ? 'descending'
                      : undefined;

                  const isSpecial = header.column.id === '__select' || header.column.id === '__expand';
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      colSpan={header.colSpan}
                      className={
                        isSpecial
                          ? header.column.id === '__select'
                            ? 'dt-col-check'
                            : 'dt-col-expand'
                          : isSortable
                          ? 'sortable'
                          : ''
                      }
                      aria-sort={ariaSort}
                      style={{
                        width: meta?.width,
                        textAlign: meta?.align ?? 'left',
                        cursor: isSortable ? 'pointer' : undefined,
                      }}
                      onClick={isSortable ? header.column.getToggleSortingHandler() : undefined}
                      onKeyDown={
                        isSortable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                header.column.getToggleSortingHandler()?.(e);
                              }
                            }
                          : undefined
                      }
                      tabIndex={isSortable ? 0 : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="dt-th-inner">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {isSortable && <SortIcon direction={sortDir} />}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}

            {/* Column filter row */}
            {enableFiltering && (
              <tr className="dt-filter-row">
                {table.getHeaderGroups()[0]?.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                  const isSpecial = header.column.id === '__select' || header.column.id === '__expand';
                  if (isSpecial || meta?.noFilter) return <th key={header.id} scope="col" />;
                  return (
                    <th key={header.id} scope="col">
                      {header.column.getCanFilter() && (
                        <input
                          className="dt-col-filter"
                          type="text"
                          value={(header.column.getFilterValue() as string) ?? ''}
                          onChange={(e) => header.column.setFilterValue(e.target.value)}
                          placeholder={
                            typeof header.column.columnDef.header === 'string'
                              ? `Filtrar ${header.column.columnDef.header.toLowerCase()}…`
                              : 'Filtrar…'
                          }
                          aria-label={`Filtrar columna ${
                            typeof header.column.columnDef.header === 'string'
                              ? header.column.columnDef.header
                              : header.column.id
                          }`}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>

          <tbody>
            {/* Loading skeleton */}
            {isLoading && <SkeletonRows cols={visibleColCount} />}

            {/* Virtual rows */}
            {!isLoading && enableVirtualization && virtualItems && (
              <>
                {/* Top padding */}
                {virtualItems.length > 0 && virtualItems[0].start > 0 && (
                  <tr style={{ height: virtualItems[0].start }}>
                    <td colSpan={visibleColCount} />
                  </tr>
                )}

                {virtualItems.map((vItem) => {
                  const row = rows[vItem.index];
                  if (!row) return null;
                  return (
                    <RenderRow
                      key={row.id}
                      row={row}
                      visibleColCount={visibleColCount}
                      renderSubComponent={renderSubComponent}
                    />
                  );
                })}

                {/* Bottom padding */}
                {virtualItems.length > 0 && (() => {
                  const last = virtualItems[virtualItems.length - 1];
                  const remaining = totalVirtualSize - last.end;
                  return remaining > 0 ? (
                    <tr style={{ height: remaining }}>
                      <td colSpan={visibleColCount} />
                    </tr>
                  ) : null;
                })()}
              </>
            )}

            {/* Non-virtual rows */}
            {!isLoading && !enableVirtualization &&
              rows.map((row) => (
                <RenderRow
                  key={row.id}
                  row={row}
                  visibleColCount={visibleColCount}
                  renderSubComponent={renderSubComponent}
                />
              ))}

            {/* Empty state */}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={visibleColCount} className="dt-empty" role="status">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && (
        <PaginationBar {...pagination} />
      )}
    </div>
  );
}

/* ── Row renderer (extracted to avoid re-creating inline) ─────────────────── */
function RenderRow<T>({
  row,
  visibleColCount,
  renderSubComponent,
}: {
  row: Row<T>;
  visibleColCount: number;
  renderSubComponent?: (row: Row<T>) => ReactNode;
}) {
  return (
    <>
      <tr
        className={[
          row.getIsSelected() ? 'dt-row--selected' : '',
          row.getIsExpanded() ? 'dt-row--expanded' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-selected={row.getIsSelected() ? true : undefined}
      >
        {row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
          const isCheck = cell.column.id === '__select';
          const isExpand = cell.column.id === '__expand';
          return (
            <td
              key={cell.id}
              className={isCheck ? 'dt-col-check' : isExpand ? 'dt-col-expand' : ''}
              style={{ textAlign: meta?.align ?? 'left' }}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          );
        })}
      </tr>

      {/* Sub-row (expand) */}
      {renderSubComponent && row.getIsExpanded() && (
        <tr>
          <td colSpan={visibleColCount} className="dt-row-expand-cell">
            <div className="dt-expand-content">{renderSubComponent(row)}</div>
          </td>
        </tr>
      )}
    </>
  );
}
