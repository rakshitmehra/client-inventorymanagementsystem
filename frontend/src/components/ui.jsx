'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { Icon, renderIcon } from './Icon';
import { useClientTable } from '@/lib/hooks';

/* ------------------------------------------------------------------ toast -- */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = 'info', ttl = 7000) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((list) => [...list, { id, message, tone }]);
      if (ttl) setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss],
  );

  const toast = {
    // Messages linger longer than the usual few seconds: there is no rush.
    success: (message) => push(message, 'success', 8000),
    error: (message) => push(message, 'error', 14000),
    info: (message) => push(message, 'info', 8000),
  };

  const icons = { success: 'check-circle', error: 'alert', info: 'info' };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Rendered only when there is something to say. An empty fixed-position
          container still takes part in layout, and on a phone it was sizing
          itself from the scroll width while adding to it - a small feedback
          loop that left every screen scrollable sideways by a few pixels. */}
      <div
        className="toast-stack"
        role="status"
        aria-live="polite"
        hidden={toasts.length === 0}
      >
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="toast-icon" aria-hidden="true">
              <Icon name={icons[t.tone]} size={22} />
            </span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Close message"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
};

/* ---------------------------------------------------------------- basics -- */
export function Badge({ tone = 'gray', dot = false, className = '', children }) {
  return (
    <span className={`badge ${tone}${dot ? ' dot' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </span>
  );
}

export function Spinner({ white = false }) {
  return <span className={`spinner${white ? ' white' : ''}`} />;
}

export function Loading({ label = 'Just a moment…' }) {
  return (
    <div className="loading-page">
      <Spinner />
      <span className="muted">{label}</span>
    </div>
  );
}

export function Button({
  variant = 'secondary',
  size,
  loading = false,
  icon,
  children,
  className = '',
  ...rest
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`}
      {...rest}
      disabled={loading || rest.disabled}
    >
      {loading ? (
        <Spinner white={variant === 'primary' || variant === 'danger'} />
      ) : (
        icon && <span className="btn-icon-slot">{renderIcon(icon, 19)}</span>
      )}
      {children}
    </button>
  );
}

/**
 * A large, obvious "do this thing" tile. Used instead of burying the common
 * jobs behind small toolbar buttons.
 */
export function ActionCard({ href, onClick, icon, title, sub, primary = false }) {
  const content = (
    <>
      <span className="action-card-icon" aria-hidden="true">
        {renderIcon(icon, 26)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="action-card-title" style={{ display: 'block' }}>
          {title}
        </span>
        {sub && <span className="action-card-sub">{sub}</span>}
      </span>
    </>
  );

  const className = `action-card${primary ? ' primary' : ''}`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  );
}

export function EmptyState({ icon = 'box', title, message, action }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {renderIcon(icon, 34)}
      </div>
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }) {
  const icons = { info: 'info', warn: 'alert', error: 'alert', success: 'check-circle' };
  return (
    <div className={`alert ${tone}`}>
      <span className="alert-icon" aria-hidden="true">
        <Icon name={icons[tone]} size={22} />
      </span>
      <div style={{ minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        {title && children ? <div className="mt-4">{children}</div> : children}
      </div>
    </div>
  );
}

/** A numbered heading, so a long form reads as a short sequence of steps. */
export function Step({ number, title, sub }) {
  return (
    <div className="step-head">
      <span className="step-number" aria-hidden="true">
        {number}
      </span>
      <span>
        <span className="step-title" style={{ display: 'block' }}>
          {title}
        </span>
        {sub && <span className="step-sub">{sub}</span>}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- forms -- */
export function Field({ label, required, optional, error, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="req" aria-hidden="true">*</span>}
          {optional && <span className="optional">(you can leave this blank)</span>}
        </label>
      )}
      {children}
      {error && (
        <div className="field-error">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}
      {hint && !error && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Input({ error, className = '', ...rest }) {
  return <input className={`input ${error ? 'error' : ''} ${className}`} {...rest} />;
}

export function NumberInput({ error, className = '', ...rest }) {
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      className={`input num ${error ? 'error' : ''} ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ error, className = '', ...rest }) {
  return <textarea className={`textarea ${error ? 'error' : ''} ${className}`} {...rest} />;
}

export function Select({ error, options = [], placeholder, className = '', children, ...rest }) {
  return (
    <select className={`select ${error ? 'error' : ''} ${className}`} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
      {children}
    </select>
  );
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function DateInput(props) {
  return <input type="date" className="input" {...props} />;
}

/** Debounced search box: fires onChange once typing settles. */
export function SearchInput({ value, onChange, placeholder = 'Type to search…', delay = 350 }) {
  const [text, setText] = useState(value ?? '');
  const first = useRef(true);

  useEffect(() => {
    setText(value ?? '');
  }, [value]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      if (text !== value) onChange(text);
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="search">
      <span className="search-icon" aria-hidden="true">
        <Icon name="search" size={20} />
      </span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

/**
 * Search stays visible; everything else folds away. Most people only ever need
 * the search box, and a wall of dropdowns is the fastest way to lose them.
 */
export function FilterBar({ children, more, onClear, hasFilters = false }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="filter-bar">
      {children}
      {more && (
        <Button onClick={() => setOpen((v) => !v)} icon={open ? 'chevron-up' : 'chevron-down'}>
          {open ? 'Hide filters' : 'More filters'}
        </Button>
      )}
      {hasFilters && onClear && (
        <Button onClick={onClear} icon="close">
          Clear
        </Button>
      )}
      {more && open && <div className="filter-more">{more}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- modal -- */
export function Modal({ open, title, subtitle, onClose, children, footer, size = '' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close this window"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Yes, do it',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={loading ? undefined : onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={loading}>
            No, go back
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------ data table -- */
/**
 * Columns: { key, label, align, sortable, width, render(row) }
 * Sorting is reported upward so the service does the ordering.
 */
export function DataTable({
  columns,
  rows,
  loading,
  empty,
  sort,
  order,
  onSort,
  onRowClick,
  rowKey = (row, index) => row.id ?? index,
  footer,
  /**
   * Row numbers. `startIndex` is the number of the first row on this page, so
   * page 2 of a 20-row table starts at 21 rather than restarting at 1 - the
   * number then matches what someone means when they say "line 27".
   */
  numbered = true,
  startIndex = 1,
  /**
   * Paging that survives printing.
   *
   * Pass a `useClientTable` result here and the table keeps every matching row
   * in the document, marking the ones outside the current page so CSS can hide
   * them. On screen you get twenty rows; on paper the whole thing prints,
   * which is the entire point of a report.
   *
   * Lists with no natural ceiling should keep passing `rows` and `startIndex`
   * instead, so the browser never holds thousands of rows it cannot show.
   */
  page,
}) {
  const visible = page ? page.allRows : rows;
  const firstNumber = page ? 1 : startIndex;
  const offset = page ? (page.meta.page - 1) * page.meta.page_size : null;

  if (loading) return <Loading />;
  if (!visible?.length) return empty ?? <EmptyState title="Nothing here yet" />;

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {numbered && (
              <th className="row-number" scope="col">
                #
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                className={`${column.align === 'right' ? 'num' : ''} ${
                  column.sortable && onSort ? 'sortable' : ''
                }`}
                style={column.width ? { width: column.width } : undefined}
                onClick={column.sortable && onSort ? () => onSort(column.key) : undefined}
              >
                {column.label}
                {column.sortable && onSort && sort === column.key && (
                  <span className="sort-arrow" aria-hidden="true">
                    <Icon name={order === 'desc' ? 'chevron-down' : 'chevron-up'} size={16} />
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className={
                [
                  onRowClick ? 'clickable' : '',
                  offset !== null && (index < offset || index >= offset + page.meta.page_size)
                    ? 'off-page'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {numbered && (
                <td className="row-number" data-label="">
                  {firstNumber + index}
                </td>
              )}
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.align === 'right' ? 'num' : undefined}
                  data-label={typeof column.label === 'string' ? column.label : ''}
                >
                  {column.render ? column.render(row, index) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

/**
 * A table that pages itself.
 *
 * For lists that arrive whole and already filtered - a report's rows, the
 * lines on one transfer - where the caller has nothing to decide beyond "show
 * me twenty at a time". It keeps every row in the document and hides the ones
 * off the current page, so the table pages at a desk and still prints
 * complete.
 *
 * Screens with their own search and filter controls use `useClientTable`
 * directly instead, because they need the filtered set for their own totals.
 */
export function PagedTable({ rows, pageSize, ...props }) {
  const table = useClientTable(rows, pageSize ? { pageSize } : undefined);
  return (
    <>
      <DataTable {...props} page={table} />
      <Pagination meta={table.meta} onPage={table.setPage} />
    </>
  );
}

export function Pagination({ meta, onPage }) {
  const total = meta?.total ?? 0;
  const pages = meta?.total_pages ?? 0;

  // The component owns its footer bar, so a table with nothing to page through
  // renders no empty strip under it and no call site has to guess.
  if (!total) return null;

  // Said out loud whenever the browser is holding only part of the list, so a
  // filtered view is never mistaken for a complete one.
  const partial = meta.truncated ? (
    <span className="info warn-text">
      Showing the most recent {meta.filtered_from} of {meta.truncated}. Narrow the dates to
      search further back.
    </span>
  ) : null;

  if (pages <= 1) {
    return (
      <div className="card-foot">
        <span className="info muted">
          {total} {total === 1 ? 'row' : 'rows'}
          {meta.filtered_from > total && ` of ${meta.filtered_from}`}
        </span>
        {partial}
      </div>
    );
  }

  const { page, page_size: size } = meta;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);

  return (
    <div className="card-foot">
      {partial}
      <div className="pagination">
        <span className="info">
          Showing {from}–{to} of {total}
        </span>
        <Button onClick={() => onPage(page - 1)} disabled={page <= 1} icon="arrow-left">
          Previous
        </Button>
        <span className="nowrap strong">
          Page {page} of {pages}
        </span>
        <Button onClick={() => onPage(page + 1)} disabled={page >= pages} icon="arrow-right">
          Next
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- skeleton -- */
/**
 * A grey placeholder in the shape of the thing that is loading.
 *
 * Preferred over a spinner where the layout is known in advance: the page
 * settles into its final shape instead of collapsing and jumping when the data
 * lands, which is the part that actually feels slow.
 */
export function Skeleton({ width, height = 16, radius = 6, className = '' }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width: width ?? '100%', height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/** A stat tile's shape, for use while its numbers are on their way. */
export function StatSkeleton() {
  return (
    <div className="stat" aria-hidden="true">
      <Skeleton width={46} height={46} radius={10} />
      <div className="stat-body">
        <Skeleton width="55%" height={12} />
        <Skeleton width="75%" height={24} className="mt-8" />
        <Skeleton width="40%" height={11} className="mt-4" />
      </div>
    </div>
  );
}

/** A card with a heading and a few table rows' worth of placeholder. */
export function CardSkeleton({ rows = 4, title = true }) {
  return (
    <div className="card" aria-hidden="true">
      {title && (
        <div className="card-head">
          <Skeleton width={180} height={18} />
        </div>
      )}
      <div className="card-body">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="skeleton-row">
            <Skeleton width="45%" height={14} />
            <Skeleton width="20%" height={14} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- stat tile -- */
export function Stat({ icon, tone = '', label, value, meta, onClick }) {
  const body = (
    <>
      {icon && (
        <div className={`stat-icon ${tone}`} aria-hidden="true">
          {renderIcon(icon, 24)}
        </div>
      )}
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {meta && <div className="stat-meta">{meta}</div>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="stat" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="stat">{body}</div>;
}

/* ------------------------------------------------------------ mini chart -- */
export function BarList({ items, valueKey = 'value', labelKey = 'label', format = (v) => v }) {
  const max = Math.max(...items.map((item) => Number(item[valueKey]) || 0), 1);
  return (
    <div className="bar-chart">
      {items.map((item, index) => (
        <div className="bar-row" key={item.id ?? index}>
          <span className="bar-label">{item[labelKey]}</span>
          <span className="bar-value">{format(item[valueKey])}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${((Number(item[valueKey]) || 0) / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
