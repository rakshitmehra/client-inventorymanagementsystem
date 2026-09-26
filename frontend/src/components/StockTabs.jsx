'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * One section, several pages.
 *
 * Asking for stock, the saved orders and sending to a kitchen were three
 * separate menu entries, which made them look like three unrelated parts of
 * the system. They are one job - getting stock from where it is to where it
 * is needed - so the menu now has a single entry and the parts are tabs
 * across the top of it. You can see all of them from any of them, which is
 * the thing a menu entry each never gave you.
 */
const ADMIN_TABS = [
  { href: '/requests', label: 'Requests', icon: 'request' },
  { href: '/standard-lists', label: 'Standard Lists', icon: 'documents' },
  { href: '/transfers/new', label: 'Send to a Kitchen', icon: 'truck' },
  { href: '/transfers', label: 'Past Deliveries', icon: 'clock' },
];

const MANAGER_TABS = [
  { href: '/requests/new', label: 'Ask for Stock', icon: 'request' },
  { href: '/requests', label: 'My Requests', icon: 'documents' },
  { href: '/transfers', label: 'Deliveries to Me', icon: 'truck' },
];

export function StockTabs() {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const tabs = isAdmin ? ADMIN_TABS : MANAGER_TABS;

  return (
    <div className="section-tabs no-print" role="tablist">
      {tabs.map((tab) => {
        // "/requests/new" must not also light up "/requests".
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`section-tab${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
