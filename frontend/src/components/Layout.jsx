'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { initials } from '@/lib/format';
import { Button } from './ui';
import { Icon } from './Icon';

/**
 * Navigation is built from the signed-in role, and deliberately uses everyday
 * words rather than warehouse jargon ("Send to Kitchen", not "Transfers Out").
 * Icons are large and pictorial so the list can be scanned by shape.
 */
function navigationFor(user, isAdmin) {
  if (isAdmin) {
    return [
      { section: null, items: [{ href: '/dashboard', label: 'Home', icon: 'home' }] },
      {
        section: 'Everyday jobs',
        items: [
          { href: '/goods-receipts/new', label: 'Receive Stock', icon: 'inbox' },
          { href: '/transfers/new', label: 'Send to a Kitchen', icon: 'truck' },
          { href: '/production/new', label: 'Record Cooking', icon: 'cooking' },
          { href: '/wastage', label: 'Record Waste', icon: 'trash' },
          { href: '/adjustments', label: 'Correct a Count', icon: 'adjust' },
        ],
      },
      {
        section: 'Look things up',
        items: [
          { href: '/main-inventory', label: 'Main Store', icon: 'box' },
          { href: '/kitchens', label: 'Kitchens', icon: 'kitchen' },
          { href: '/transfers', label: 'Past Deliveries', icon: 'documents' },
          { href: '/production', label: 'Past Cooking', icon: 'history' },
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
          { href: '/audit-logs', label: 'Activity Log', icon: 'audit' },
        ],
      },
    ];
  }

  const kitchenId = user?.kitchens?.[0]?.id;
  return [
    { section: null, items: [{ href: '/dashboard', label: 'Home', icon: 'home' }] },
    {
      section: 'Everyday jobs',
      items: [
        { href: '/production/new', label: 'Record Cooking', icon: 'cooking' },
        { href: '/wastage', label: 'Record Waste', icon: 'trash' },
        { href: '/adjustments', label: 'Correct a Count', icon: 'adjust' },
      ],
    },
    {
      section: 'Look things up',
      items: [
        ...(kitchenId
          ? [{ href: `/kitchens/${kitchenId}/inventory`, label: 'My Stock', icon: 'box' }]
          : []),
        { href: '/transfers', label: 'Deliveries to Me', icon: 'truck' },
        { href: '/production', label: 'Past Cooking', icon: 'history' },
        { href: '/products', label: 'Recipes', icon: 'recipe' },
        { href: '/movements', label: 'Stock History', icon: 'clock' },
        { href: '/reports', label: 'Reports', icon: 'chart' },
      ],
    },
  ];
}

export default function Layout({ title, subtitle, actions, children }) {
  const { user, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Close the drawer whenever the route changes on small screens.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const groups = navigationFor(user, isAdmin);

  // "/transfers/new" should not also light up "/transfers".
  const isActive = (href) => pathname === href;

  return (
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
              {isAdmin ? 'Manager view' : user?.kitchens?.[0]?.name ?? 'Kitchen view'}
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

      <div className="main">
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
      </div>
    </div>
  );
}
