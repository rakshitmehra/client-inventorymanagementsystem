'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { initials } from '@/lib/format';
import { Button } from './ui';
import { Icon } from './Icon';

/**
 * The parts of the screen that outlive a page: the sidebar and the shell
 * around it.
 *
 * This is rendered by the route-group layout, not by the pages, and that is
 * the whole point. A layout stays mounted while you navigate between the
 * routes inside it, so the sidebar keeps its scroll position, its open/closed
 * state and its focus. When the sidebar lived inside each page it was torn
 * down and rebuilt on every click, and a brand-new element starts scrolled to
 * the top - so a long menu jumped back to the top every time you used it.
 *
 * Pages still render <Layout title subtitle actions>, which supplies only the
 * header and the content area and reaches the drawer through the context
 * below.
 */

const AppFrameContext = createContext({ open: false, setOpen: () => {} });

export function useAppFrame() {
  return useContext(AppFrameContext);
}

/** Remembered between visits, so the menu you shaped stays that shape. */
const COLLAPSED_KEY = 'kitchenstock.sidebar.collapsed';
const SECTIONS_KEY = 'kitchenstock.sidebar.sections';

function readStored(key, fallback) {
  // Private windows and cleared site data both make this throw or return
  // nothing, and neither is a reason to fail to draw a menu.
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a remembered preference is not worth an error */
  }
}

/**
 * Navigation is built from the signed-in role, and deliberately uses everyday
 * words rather than warehouse jargon ("Send to a Kitchen", not "Transfers
 * Out"). Icons come from one stroke set so the list can be scanned by shape.
 */
function navigationFor(user, isAdmin) {
  if (isAdmin) {
    return [
      {
        // Where the stock is. These four answer "what have we got, and who
        // is waiting on me", which is what the day starts with.
        section: null,
        items: [
          { href: '/dashboard', label: 'Home', icon: 'home' },
          { href: '/main-inventory', label: 'Main Store', icon: 'box' },
          { href: '/kitchen-stock', label: 'Kitchen Stock', icon: 'kitchen' },
        ],
      },
      {
        section: 'Move stock',
        items: [
          // One entry for the whole business of getting stock where it is
          // needed. Requests, the saved orders, sending to a kitchen and the
          // record of past deliveries are tabs across the top of that
          // section, not four separate places to remember.
          { href: '/requests', label: 'Stock', icon: 'request' },
          { href: '/goods-receipts/new', label: 'Receive Stock', icon: 'inbox' },
          { href: '/wastage', label: 'Record Waste', icon: 'trash' },
          { href: '/adjustments', label: 'Correct a Count', icon: 'adjust' },
        ],
      },
      {
        section: 'History & reports',
        items: [
          { href: '/movements', label: 'Stock History', icon: 'clock' },
          { href: '/reports', label: 'Reports', icon: 'chart' },
        ],
      },
      {
        // Things you set up once and rarely touch. Folded away by default
        // would be better still, and the section folds if they want that.
        section: 'Set-up',
        items: [
          { href: '/items', label: 'Items', icon: 'ingredient' },
          { href: '/kitchens', label: 'Kitchens', icon: 'kitchen' },
          { href: '/suppliers', label: 'Suppliers', icon: 'supplier' },
          { href: '/categories', label: 'Categories', icon: 'tag' },
          { href: '/users', label: 'People', icon: 'users' },
        ],
      },
    ];
  }

  const kitchenId = user?.kitchens?.[0]?.id;
  return [
    {
      // A kitchen manager has three jobs: see what they have, ask for more,
      // and say what went wrong. Everything else was somebody else's screen.
      section: null,
      items: [
        { href: '/dashboard', label: 'Home', icon: 'home' },
        ...(kitchenId
          ? [{ href: `/kitchens/${kitchenId}/inventory`, label: 'My Stock', icon: 'box' }]
          : []),
        // Same idea as the administrator's menu: asking, the requests you
        // have asked, and what has arrived are one section with tabs.
        { href: '/requests/new', label: 'Stock', icon: 'request' },
      ],
    },
    {
      section: 'Record',
      items: [
        { href: '/wastage', label: 'Record Waste', icon: 'trash' },
        { href: '/adjustments', label: 'Correct a Count', icon: 'adjust' },
      ],
    },
    {
      section: 'Look things up',
      items: [
        { href: '/movements', label: 'Stock History', icon: 'clock' },
      ],
    },
  ];
}

export default function AppFrame({ children }) {
  const { user, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [shut, setShut] = useState({});
  const pathname = usePathname();
  const router = useRouter();

  // Read the remembered state after mount. Reading it during the first render
  // would make the server's markup and the browser's disagree.
  useEffect(() => {
    setCollapsed(readStored(COLLAPSED_KEY, false));
    setShut(readStored(SECTIONS_KEY, {}));
  }, []);

  // Close the drawer when the route changes, so tapping a link on a phone
  // does not leave the menu covering the page you just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const groups = navigationFor(user, isAdmin);

  // "/transfers/new" should not also light up "/transfers".
  const isActive = (href) => pathname === href;

  function toggleSection(name) {
    setShut((current) => {
      const next = { ...current, [name]: !current[name] };
      writeStored(SECTIONS_KEY, next);
      return next;
    });
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      writeStored(COLLAPSED_KEY, !current);
      return !current;
    });
  }

  return (
    <AppFrameContext.Provider value={{ open, setOpen }}>
      <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`}>
        {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}

        <aside className={`sidebar${open ? ' open' : ''}`}>
          <div className="sidebar-brand">
            <div className="sidebar-logo">
              <Icon name="brand" size={22} />
            </div>
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-name">KitchenStock</div>
              <div className="sidebar-brand-sub">
                {isAdmin ? 'Administrator' : user?.kitchens?.[0]?.name ?? 'Kitchen view'}
              </div>
            </div>

            {/* Narrows the menu to icons on a desktop. On a phone the same
                corner needs to dismiss the drawer instead, which is a
                different job, so they are two buttons rather than one that
                changes meaning with the screen width. */}
            <button
              type="button"
              className="sidebar-collapse desktop-only"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Widen the menu' : 'Narrow the menu'}
              title={collapsed ? 'Widen the menu' : 'Narrow the menu'}
            >
              <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
            </button>

            <button
              type="button"
              className="sidebar-close mobile-only"
              onClick={() => setOpen(false)}
              aria-label="Close the menu"
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          <nav className="sidebar-nav" aria-label="Main menu">
            {groups.map((group, index) => {
              const folded = !!group.section && !!shut[group.section];
              return (
                <div key={group.section ?? index} className="nav-group">
                  {group.section && (
                    <button
                      type="button"
                      className={`nav-section${folded ? ' folded' : ''}`}
                      onClick={() => toggleSection(group.section)}
                      aria-expanded={!folded}
                    >
                      <span className="nav-section-label">{group.section}</span>
                      <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={15} />
                    </button>
                  )}

                  {/* A folded section keeps its links in the document so the
                      collapsed rail can still show them as icons - only the
                      full-width list is hidden. */}
                  <div className={`nav-links${folded ? ' folded' : ''}`}>
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`nav-item${isActive(item.href) ? ' active' : ''}`}
                        aria-current={isActive(item.href) ? 'page' : undefined}
                        title={item.label}
                      >
                        <span className="nav-item-icon" aria-hidden="true">
                          <Icon name={item.icon} size={19} />
                        </span>
                        <span className="nav-item-label">{item.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="avatar">{initials(user?.full_name)}</div>
              <div style={{ minWidth: 0, flex: 1 }} className="sidebar-user-text">
                <div className="sidebar-user-name">{user?.full_name}</div>
                <div className="sidebar-user-role">
                  {isAdmin ? 'Sees every kitchen' : 'Sees one kitchen'}
                </div>
              </div>
            </div>

            <div className="sidebar-account">
              <Button onClick={() => router.push('/profile')} icon="user">
                My Account
              </Button>
              <Button onClick={() => signOut()} icon="logout">
                Sign Out
              </Button>
            </div>
          </div>
        </aside>

        <div className="main">{children}</div>
      </div>
    </AppFrameContext.Provider>
  );
}
