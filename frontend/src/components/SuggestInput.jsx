'use client';

import { useMemo, useRef, useState } from 'react';
import { Input } from './ui';

/**
 * A text box that offers suggestions as you type, but lets you type anything.
 *
 * The browser's own <datalist> dropdown looks different on every device, is
 * tiny on a phone and cannot be styled. This one uses the same menu as the
 * item picker, so it reads the same everywhere and its rows are big enough to
 * tap. Anything typed that is not in the list is kept as typed.
 */
export function SuggestInput({ value, onChange, options, placeholder, limit = 8, ...rest }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  const matches = useMemo(() => {
    const text = String(value ?? '').trim().toLowerCase();
    const found = options.filter((option) => !text || option.toLowerCase().includes(text));
    // Once the box holds exactly one suggestion there is nothing left to offer.
    if (found.length === 1 && found[0].toLowerCase() === text) return [];
    return found.slice(0, limit);
  }, [options, value, limit]);

  return (
    <div className="suggest">
      <Input
        {...rest}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          clearTimeout(closeTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && matches.length > 0 && (
        <div className="picker-menu">
          {matches.map((option) => (
            <button
              key={option}
              type="button"
              className="picker-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
