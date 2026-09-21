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

/**
 * Navigation is built from the signed-in role, and deliberately uses everyday
 * words rather than warehouse jargon ("Send to a Kitchen", not "Transfers
 * Out"). Icons come from one stroke set so the list can be scanned by shape.
 */
function navigationFor(user, isAdmin) {
  if (isAdmin) {
    return [
      {
        // Same reasoning as the kitchen menu below: the two screens an
        // administrator opens most - what the main store is holding, and what
        // the kitchens are waiting on them for - sit above any heading.
        section: null,
        items: [
          { href: '/dashboard', label: 'Home', icon: 'home' },
          { href: '/main-inventory', label: 'Main Store', icon: 'box' },
          { href: '/requests', label: 'Stock Requests', icon: 'request' },
        ],
      },
      {
        section: 'Everyday jobs',
        items: [
          { href: '/goods-receipts/new', label: 'Receive Stock', icon: 'inbox' },
          { href: '/transfers/new', label: 'Send to a Kitchen', icon: 'truck' },
          { href: '/wastage', label: 'Record Waste', icon: 'trash' },
          { href: '/adjustments', label: 'Correct a Count', icon: 'adjust' },
        ],
      },
      {
        section: 'Look things up',
        items: [
          { href: '/kitchens', label: 'Kitchens', icon: 'kitchen' },
          { href: '/transfers', label: 'Past Deliveries', icon: 'documents' },
          { href: '/movements', label: 'Stock History', icon: 'clock' },
          { href: '/reports', label: 'Reports', icon: 'chart' },
        ],
      },
      {
        section: 'Set-up',
        items: [
          { href: '/items', label: 'Ingredients', icon: 'ingredient' },
          { href: '/products', label: 'Recipes', icon: 'recipe' },
          { href: '/categories', label: 'Categories', icon: 'tag' },
          { href: '/suppliers', label: 'Suppliers', icon: 'supplier' },
          { href: '/users', label: 'People', icon: 'users' },
        ],
      },
    ];
  }

  const kitchenId = user?.kitchens?.[0]?.id;
  return [
    {
      // The two things a kitchen manager opens most - what have I got, and
      // what is on its way - sit at the very top, above the fold on a phone,
      // rather than buried under a heading further down.
      section: null,
      items: [
        { href: '/dashboard', label: 'Home', icon: 'home' },
        ...(kitchenId
          ? [{ href: `/kitchens/${kitchenId}/inventory`, label: 'My Stock', icon: 'box' }]
          : []),
        { href: '/transfers', label: 'Deliveries to Me', icon: 'truck' },
      ],
    },
    {
      section: 'Everyday jobs',
      items: [
        { href: '/requests/new', label: 'Ask for Stock', icon: 'request' },
        { href: '/production/new', label: 'Record Production', icon: 'cooking' },
        { href: '/wastage', label: 'Record Waste', icon: 'trash' },
        { href: '/adjustments', label: 'Correct a Count', icon: 'adjust' },
      ],
    },
    {
      section: 'Look things up',
      items: [
        { href: '/requests', label: 'My Requests', icon: 'documents' },
        { href: '/production', label: 'Production History', icon: 'history' },
        { href: '/products', label: 'Recipes', icon: 'recipe' },
        { href: '/movements', label: 'Stock History', icon: 'clock' },
        { href: '/reports', label: 'Reports', icon: 'chart' },
      ],
    },
  ];
}

export default function AppFrame({ children }) {
  const { user, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Close the drawer when the route changes, so tapping a link on a phone
  // does not leave the menu covering the page you just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const groups = navigationFor(user, isAdmin);

  // "/transfers/new" should not also light up "/transfers".
  const isActive = (href) => pathname === href;

  return (
    <AppFrameContext.Provider value={{ open, setOpen }}>
      <div className="app">
        {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}

        <aside className={`sidebar${open ? ' open' : ''}`}>
          <div className="sidebar-brand">
            <div className="sidebar-logo">
              <Icon name="brand" size={26} />
            </div>
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-name">KitchenStock</div>
              <div className="sidebar-brand-sub">
                {/* "Manager view" meant manager-of-everything, but next to a
                    role literally called Kitchen Manager it read as the
                    opposite of what an administrator is. Say which it is. */}
                {isAdmin ? 'Administrator' : user?.kitchens?.[0]?.name ?? 'Kitchen view'}
              </div>
            </div>
            <button
              type="button"
              className="sidebar-close mobile-only"
              onClick={() => setOpen(false)}
              aria-label="Close the menu"
            >
              <Icon name="close" size={22} />
            </button>
          </div>

          <nav className="sidebar-nav" aria-label="Main menu">
            {groups.map((group, index) => (
              <div key={group.section ?? index}>
                {group.section && <div className="nav-section">{group.section}</div>}
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${isActive(item.href) ? ' active' : ''}`}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                  >
                    <span className="nav-item-icon" aria-hidden="true">
                      <Icon name={item.icon} size={21} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="avatar">{initials(user?.full_name)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
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
