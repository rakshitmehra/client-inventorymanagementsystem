'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { money, qty } from '@/lib/format';
import { Badge, Button, NumberInput, Select } from './ui';

/**
 * A searchable item picker. Native selects get unusable once the catalogue
 * grows, so this filters as you type and shows stock on hand inline.
 */
export function ItemPicker({
  items,
  value,
  onChange,
  availability,
  placeholder = 'Search for an item…',
  excludeIds = [],
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  const selected = items.find((i) => i.id === value);

  useEffect(() => {
    if (!open) return undefined;
    const onClickAway = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    return items
      .filter((item) => !excludeIds.includes(item.id) || item.id === value)
      .filter(
        (item) =>
          !text ||
          item.name.toLowerCase().includes(text) ||
          item.sku.toLowerCase().includes(text) ||
          // Typing "dairy" should find the dairy items. With 180 items in the
          // catalogue, the category is often the only word somebody knows.
          (item.category_name ?? '').toLowerCase().includes(text),
      )
      .slice(0, 40);
  }, [items, query, excludeIds, value]);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        className="input"
        disabled={disabled}
        value={open ? query : selected ? `${selected.name} (${selected.sku})` : ''}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="picker-menu">
          {matches.length === 0 && (
            <div className="muted small" style={{ padding: 12 }}>
              No items match.
            </div>
          )}
          {matches.map((item) => {
            const stock = availability?.[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={`picker-option${item.id === value ? ' selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 550, display: 'block' }}>{item.name}</span>
                  <span className="cell-sub mono">{item.sku}</span>
                </span>
                {stock !== undefined && (
                  <Badge tone={stock > 0 ? 'green' : 'red'}>{qty(stock, item.unit_code)}</Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The repeated quantity rows shared by transfers and goods receipts.
 *
 * `availability` (item_id -> quantity in the item's own unit) turns on the
 * insufficient-stock warning, so the user sees the problem before submitting
 * rather than as a rejection afterwards.
 */
export function LineItemEditor({
  lines,
  onChange,
  items,
  units,
  availability,
  showCost = false,
}) {
  const itemsById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);

  const [category, setCategory] = useState('');

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category_name).filter(Boolean))].sort(),
    [items],
  );

  /**
   * What the pickers offer. An item already on a line stays offerable whatever
   * the filter says, so narrowing the category cannot blank out a line that is
   * already filled in.
   */
  const offered = useMemo(() => {
    if (!category) return items;
    const chosen = new Set(lines.map((l) => l.item_id).filter(Boolean));
    return items.filter((i) => i.category_name === category || chosen.has(i.id));
  }, [items, category, lines]);

  const update = (index, patch) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const addLine = () =>
    onChange([...lines, { item_id: null, quantity: '', unit_id: null, unit_cost: '' }]);

  const removeLine = (index) => onChange(lines.filter((_, i) => i !== index));

  /** Units the picked item can be entered in - same dimension only. */
  const unitsFor = (itemId) => {
    const item = itemsById[itemId];
    if (!item) return units;
    const base = units.find((u) => u.id === item.unit_id);
    return units.filter((u) => u.dimension === base?.dimension);
  };

  /** Convert an entered amount into the item's stocking unit. */
  const toBase = (line) => {
    const item = itemsById[line.item_id];
    if (!item || !line.quantity) return 0;
    const entered = units.find((u) => u.id === (line.unit_id ?? item.unit_id));
    const base = units.find((u) => u.id === item.unit_id);
    if (!entered || !base || entered.dimension !== base.dimension) return 0;
    return (Number(line.quantity) * Number(entered.factor)) / Number(base.factor);
  };

  const selectedIds = lines.map((l) => l.item_id).filter(Boolean);
  const totalValue = lines.reduce(
    (sum, line) => sum + toBase(line) * Number(line.unit_cost || 0),
    0,
  );

  return (
    <div>
      {/* Narrowing to a category before picking. With a catalogue this size,
          scrolling a list of everything to find one sauce is the slow part;
          the search box still works across the lot when you know the name. */}
      {categories.length > 1 && (
        <div className="line-item-filter mb-8">
          <span className="muted small">Show</span>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              { value: '', label: `Every category (${items.length} items)` },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>
      )}

      <div className="line-item-head mb-8">
        <span>Item</span>
        <span>Quantity</span>
        <span>{showCost ? 'Unit cost' : 'Converts to'}</span>
        <span />
      </div>

      <div className="line-items">
        {lines.map((line, index) => {
          const item = itemsById[line.item_id];
          const baseQuantity = toBase(line);
          const available = availability?.[line.item_id];
          const short =
            available !== undefined && baseQuantity > 0 && baseQuantity > available + 1e-9;

          return (
            <div key={index}>
              <div className="line-item">
                <div>
                  <ItemPicker
                    items={offered}
                    value={line.item_id}
                    onChange={(itemId) => {
                      const picked = itemsById[itemId];
                      update(index, {
                        item_id: itemId,
                        unit_id: picked?.unit_id ?? null,
                        unit_cost: showCost ? String(picked?.unit_cost ?? '') : line.unit_cost,
                      });
                    }}
                    availability={availability}
                    excludeIds={selectedIds}
                  />
                  {item && (
                    <div className="cell-sub mt-4">
                      Stocked in {item.unit_code}
                      {available !== undefined && ` · ${qty(available, item.unit_code)} available`}
                    </div>
                  )}
                </div>

                <div className="input-group">
                  <NumberInput
                    value={line.quantity}
                    min="0"
                    placeholder="0"
                    error={short}
                    onChange={(e) => update(index, { quantity: e.target.value })}
                  />
                  <select
                    className="select"
                    value={line.unit_id ?? item?.unit_id ?? ''}
                    disabled={!item}
                    onChange={(e) => update(index, { unit_id: Number(e.target.value) })}
                  >
                    {unitsFor(line.item_id).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  {showCost ? (
                    <NumberInput
                      value={line.unit_cost}
                      min="0"
                      placeholder="0.00"
                      onChange={(e) => update(index, { unit_cost: e.target.value })}
                    />
                  ) : (
                    <div className="small muted" style={{ paddingTop: 8 }}>
                      {item && baseQuantity > 0 ? qty(baseQuantity, item.unit_code) : '—'}
                    </div>
                  )}
                </div>

                <Button
                  variant="ghost"
                  className="btn-icon"
                  onClick={() => removeLine(index)}
                  disabled={lines.length === 1}
                  title="Remove line"
                  aria-label="Remove line"
                  icon="close"
                />
              </div>

              {short && item && (
                <div className="field-error" style={{ marginTop: 4 }}>
                  Only {qty(available, item.unit_code)} available — short by{' '}
                  {qty(baseQuantity - available, item.unit_code)}
                </div>
              )}
              {showCost && item && baseQuantity > 0 && (
                <div className="cell-sub" style={{ marginTop: 4 }}>
                  {qty(baseQuantity, item.unit_code)} × {money(line.unit_cost || 0)} ={' '}
                  <strong>{money(baseQuantity * Number(line.unit_cost || 0))}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex between items-center mt-12 wrap gap-8">
        <Button onClick={addLine}>+ Add another item</Button>
        <span className="muted small">
          {lines.filter((l) => l.item_id && Number(l.quantity) > 0).length} line(s) ready
          {showCost && (
            <>
              {' · '}
              <strong>{money(totalValue)}</strong> total
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** Turn editor rows into the payload the API expects. */
export function toPayloadLines(lines) {
  return lines
    .filter((line) => line.item_id && Number(line.quantity) > 0)
    .map((line) => ({
      item_id: line.item_id,
      quantity: Number(line.quantity),
      unit_id: line.unit_id ?? undefined,
      ...(line.unit_cost !== undefined && line.unit_cost !== ''
        ? { unit_cost: Number(line.unit_cost) }
        : {}),
      ...(line.batch_no ? { batch_no: line.batch_no } : {}),
      ...(line.expiry_date ? { expiry_date: line.expiry_date } : {}),
      ...(line.notes ? { notes: line.notes } : {}),
    }));
}
