/**
 * The icon set.
 *
 * Every icon is drawn on the same 24x24 grid with a single stroke weight and
 * round joins, and takes its colour from `currentColor`. That is what makes a
 * screen full of them look deliberate rather than decorated: emoji are drawn by
 * the operating system, so they arrive at different weights, different colours
 * and different sizes on every device, and they read as informal.
 *
 * Shapes are kept simple and open. An icon here is often the first thing read
 * on a row, sometimes by someone who will not put their glasses on, so detail
 * that only survives at 32px is detail worth cutting.
 *
 * Usage: `<Icon name="truck" />`, or pass the name to any component that takes
 * an `icon` prop (Button, Stat, ActionCard, EmptyState, Alert).
 */

const P = {
  // ---------------------------------------------------------------- places --
  home: (
    <>
      <path d="M3.5 10.2 12 3.6l8.5 6.6V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" />
    </>
  ),
  kitchen: (
    <>
      <path d="M4 9h16v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z" />
      <path d="M20 10.5h1.2a1.8 1.8 0 0 1 0 3.6H20" />
      <path d="M8.5 6V4.5M12 6V3.5M15.5 6V4.5" />
    </>
  ),
  supplier: (
    <>
      <path d="M3.5 9.5 5 4.5h14l1.5 5" />
      <path d="M4.5 9.5h15V20a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" />
      <path d="M9.5 21v-5.5h5V21" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.8 12 3.5l8.5 4.3v8.4L12 20.5l-8.5-4.3z" />
      <path d="m3.5 7.8 8.5 4.3 8.5-4.3M12 12.1v8.4" />
    </>
  ),
  ingredient: (
    <>
      <path d="M9 3.5h6v2.2l2 2.6V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8.3l2-2.6z" />
      <path d="M7 11.5h10" />
      <path d="M10.5 15h3" />
    </>
  ),

  // ------------------------------------------------------------- movements --
  truck: (
    <>
      <path d="M2.5 6.5h10v9h-10z" />
      <path d="M12.5 10h3.6l2.9 3v2.5h-6.5z" />
      <circle cx="6.5" cy="17.5" r="2" />
      <circle cx="16" cy="17.5" r="2" />
      <path d="M8.5 17.5h5.5" />
    </>
  ),
  transfer: (
    <>
      <path d="M4 8.5h13.5M14 5l3.5 3.5L14 12" />
      <path d="M20 15.5H6.5M10 12l-3.5 3.5L10 19" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4" />
      <path d="M3.5 13.5 6 5.2A1 1 0 0 1 7 4.5h10a1 1 0 0 1 1 .7l2.5 8.3V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
    </>
  ),
  cooking: (
    <>
      <path d="M6 14.5a4.2 4.2 0 1 1 1.6-8.1 4.7 4.7 0 0 1 8.8 0A4.2 4.2 0 1 1 18 14.5z" />
      <path d="M6 14.5h12V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" />
      <path d="M6 17.2h12" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7" />
      <path d="M6.5 6.5 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13.5" />
      <path d="M10.3 10.5v6M13.7 10.5v6" />
    </>
  ),
  adjust: (
    <>
      <path d="M5 7.5h9M17.5 7.5h1.5M5 16.5h1.5M10 16.5h9" />
      <circle cx="15.8" cy="7.5" r="2.3" />
      <circle cx="8.2" cy="16.5" r="2.3" />
    </>
  ),
  out: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6.8 6.8 10.4 10.4" />
    </>
  ),

  request: (
    <>
      <path d="M7.5 3.5h9a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M9.8 8.5h4.4M9.8 12h4.4M9.8 15.5h2.6" />
      <path d="M15.4 17.6 17 19.2l3-3.2" />
    </>
  ),

  // ----------------------------------------------------------- information --
  chart: (
    <>
      <path d="M4 20.5h16" />
      <path d="M6.5 20.5v-6M11 20.5V6.5M15.5 20.5v-9M20 20.5V9.5" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </>
  ),
  documents: (
    <>
      <path d="M8 3.5h6l4.5 4.5v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" />
      <path d="M13.5 3.6V8.5h4.9" />
      <path d="M7 7H5.5a1 1 0 0 0-1 1v11.5a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V19" />
    </>
  ),
  recipe: (
    <>
      <path d="M12 6.8C10.6 5.4 8.7 4.8 5.5 4.8a1 1 0 0 0-1 1v11.4a1 1 0 0 0 1 1c3.2 0 5.1.6 6.5 2 1.4-1.4 3.3-2 6.5-2a1 1 0 0 0 1-1V5.8a1 1 0 0 0-1-1c-3.2 0-5.1.6-6.5 2z" />
      <path d="M12 6.8v13.4" />
    </>
  ),
  product: (
    <>
      <path d="M6.5 3.8h11a1 1 0 0 1 1 1v15.4l-6.5-3.8-6.5 3.8V4.8a1 1 0 0 1 1-1z" />
    </>
  ),
  tag: (
    <>
      <path d="M11.3 3.8H19a1.2 1.2 0 0 1 1.2 1.2v7.7a1 1 0 0 1-.3.7l-7.5 7.5a1 1 0 0 1-1.4 0l-7-7a1 1 0 0 1 0-1.4l7.6-7.4a1 1 0 0 1 .7-.3z" />
      <circle cx="15.8" cy="8.2" r="1.4" />
    </>
  ),
  grid: (
    <>
      <path d="M4 4.5h6.5V11H4zM13.5 4.5H20V11h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.2-8.5 4.3-8.5-4.3z" />
      <path d="m3.5 12.2 8.5 4.3 8.5-4.3" />
      <path d="m3.5 16.5 8.5 4.3 8.5-4.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  history: (
    <>
      <path d="M3.8 12a8.2 8.2 0 1 0 2.5-5.9" />
      <path d="M3.5 4.5v4.2h4.2" />
      <path d="M12 7.6V12l3 1.9" />
    </>
  ),
  audit: (
    <>
      <path d="M18.5 10.5V8L14 3.5H7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h4" />
      <path d="M13.5 3.6V8.5h4.9" />
      <circle cx="16.2" cy="16.2" r="3.3" />
      <path d="m18.7 18.7 2.3 2.3" />
    </>
  ),

  // ------------------------------------------------------------- people -----
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8.2" r="3.4" />
      <path d="M3.2 20a6.4 6.4 0 0 1 12.6 0" />
      <path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.1" />
      <path d="M17.5 14.4a6.4 6.4 0 0 1 3.3 5.6" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 4.5h-4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h4" />
      <path d="M14 8.2 17.8 12 14 15.8" />
      <path d="M17.5 12H8.5" />
    </>
  ),

  // ------------------------------------------------------------- controls ---
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.4 15.4 4.3 4.3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: (
    <>
      <path d="M16.2 3.9a1.9 1.9 0 0 1 2.7 2.7L8.4 17.1l-3.6.9.9-3.6z" />
      <path d="m14.6 5.5 3.9 3.9" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8.5V4.2a.7.7 0 0 1 .7-.7h8.6a.7.7 0 0 1 .7.7v4.3" />
      <path d="M5.5 8.5h13a1.5 1.5 0 0 1 1.5 1.5v5a1 1 0 0 1-1 1H17v4.3a.7.7 0 0 1-.7.7H7.7a.7.7 0 0 1-.7-.7V16H5a1 1 0 0 1-1-1v-5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M9.5 13.5h5" />
    </>
  ),
  rupee: (
    <>
      <path d="M7 5h10M7 9.2h10M13.2 5a4.2 4.2 0 0 1 0 8.4H7M9.8 13.4 17 20.2" />
    </>
  ),

  // -------------------------------------------------------------- feedback --
  check: <path d="m5 12.8 4.5 4.4L19 6.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.3 2.7 2.6 5-5.4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.7 4.2 3.4 17.4a1.5 1.5 0 0 0 1.3 2.3h14.6a1.5 1.5 0 0 0 1.3-2.3L13.3 4.2a1.5 1.5 0 0 0-2.6 0z" />
      <path d="M12 9.5v4M12 16.4h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2M12 7.9h.01" />
    </>
  ),

  // --------------------------------------------------------------- arrows ---
  'arrow-left': <path d="M19 12H5.5M11 5.5 4.5 12l6.5 6.5" />,
  'arrow-right': <path d="M5 12h13.5M13 5.5 19.5 12 13 18.5" />,
  'arrow-up': <path d="M12 19V5.5M5.5 12 12 5.5l6.5 6.5" />,
  'arrow-down': <path d="M12 5v13.5M5.5 12 12 18.5l6.5-6.5" />,
  'chevron-up': <path d="m6 14.5 6-6 6 6" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,

  // ---------------------------------------------------------------- brand ---
  brand: (
    <>
      <path d="M4 8.6 12 4.5l8 4.1-8 4.1z" />
      <path d="M4 8.6v6.8l8 4.1 8-4.1V8.6" />
      <path d="M12 12.7v6.8" />
    </>
  ),
};

/** Names that exist, so a typo shows up as a missing icon rather than silently. */
export const ICON_NAMES = Object.keys(P);

export function Icon({ name, size = 20, strokeWidth = 1.7, className = '', title }) {
  const shape = P[name];
  if (!shape) return null;

  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {shape}
    </svg>
  );
}

/**
 * Renders whatever was handed to an `icon` prop: a name from the set above, or
 * an already-built element. Anything else is dropped rather than printed, so a
 * stray character can never leak into the interface.
 */
export function renderIcon(icon, size) {
  if (!icon) return null;
  if (typeof icon === 'string') return <Icon name={icon} size={size} />;
  return icon;
}

export default Icon;
