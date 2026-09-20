'use client';

import { useAppFrame } from './AppFrame';
import { Icon } from './Icon';

/**
 * The part of the screen that belongs to one page: its header and its content.
 *
 * The sidebar deliberately is NOT here. It lives in AppFrame, rendered by the
 * route-group layout, so that it survives navigation instead of being rebuilt
 * on every click - which used to reset its scroll position to the top. The
 * menu button below reaches that persistent drawer through the frame context.
 *
 * Pages use this exactly as before: <Layout title subtitle actions>.
 */
export default function Layout({ title, subtitle, actions, children }) {
  const { setOpen } = useAppFrame();

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="menu-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open the menu"
        >
          <Icon name="menu" size={24} />
        </button>
        <div className="topbar-heading">
          <h1 className="topbar-title">{title}</h1>
          {subtitle && <div className="topbar-sub">{subtitle}</div>}
        </div>
        {actions && <div className="topbar-actions">{actions}</div>}
      </header>

      <main className="content">{children}</main>
    </>
  );
}
