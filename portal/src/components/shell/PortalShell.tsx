import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useMatch } from 'react-router-dom';
import {
  Activity, Building2, ChartLine, FolderKanban, Image, Inbox, LayoutDashboard, LogOut,
  Menu, RefreshCw, ScrollText, Settings, Users, X,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can, ROLE_LABELS, type Capability } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { useHealth } from '@/lib/health';
import { ENVIRONMENTS, RANGES } from '@/lib/analytics';
import { Button, Select, Skeleton, cn } from '@/components/ui';

/**
 * The Control Room shell.
 *
 * ## The two halves of the navigation, and why there are two
 *
 * The Portal has four PRODUCTS and a number of RECORDS, and before this they
 * were one flat list of nine equal items in which "Case studies" sat at the
 * same weight as "Leads". The four below answer four different questions and
 * that is the whole information architecture:
 *
 *     Dashboard   decisions      what is happening right now
 *     Analytics   analysis       what happened, and why
 *     Leads       work           who needs action
 *     System      diagnostics    is the infrastructure up
 *
 * Everything under the divider is a table of records that exists, works, and is
 * not one of those four questions. It is not hidden — removing a working screen
 * because its presentation changed would be the wrong trade — but it is drawn
 * quieter and lower, which is what "subordinate" means in a list.
 *
 * Clients is deliberately NOT a fifth product. `organizations` is a real table
 * with real policies, but an organisation list is not a client portal: there is
 * no client account, no client-facing surface and no client workflow yet. A
 * top-level Clients item today would be a promise the product cannot keep.
 *
 * ## The command bar
 *
 * Application chrome, not a page header. It holds the one thing that says where
 * you are and the two controls that change what every data screen is showing —
 * the period and the deployment — so that those read as global state rather
 * than as furniture belonging to whichever screen happened to draw them.
 */

interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; cap: Capability }

/** The four products. Order is the reading order of the whole product. */
const PRIMARY: NavItem[] = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard, cap: 'view_dashboard' },
  { to: '/analytics', label: 'Analytics', icon: ChartLine,       cap: 'view_analytics' },
  { to: '/leads',     label: 'Leads',     icon: Inbox,           cap: 'view_leads' },
  { to: '/system',    label: 'System',    icon: Activity,        cap: 'view_system' },
];

/** Records and administration. Real screens, subordinate weight. */
const SECONDARY: NavItem[] = [
  { to: '/projects',     label: 'Projects',     icon: FolderKanban, cap: 'view_projects' },
  { to: '/clients',      label: 'Clients',      icon: Building2,    cap: 'view_clients' },
  { to: '/case-studies', label: 'Case studies', icon: Image,        cap: 'view_case_studies' },
  { to: '/users',        label: 'Users',        icon: Users,        cap: 'manage_users' },
  { to: '/activity',     label: 'Activity',     icon: ScrollText,   cap: 'view_activity' },
  { to: '/settings',     label: 'Settings',     icon: Settings,     cap: 'manage_settings' },
];

/**
 * What the command bar calls the screen you are on.
 *
 * A lookup rather than a `document.title` side effect: the bar renders the
 * page's `<h1>`, so it has to be right on the first paint and not one frame
 * after it.
 */
const TITLES: { path: string; title: string }[] = [
  { path: '/analytics', title: 'Analytics' },
  { path: '/leads', title: 'Leads' },
  { path: '/system', title: 'System' },
  { path: '/projects', title: 'Projects' },
  { path: '/clients', title: 'Clients' },
  { path: '/case-studies', title: 'Case studies' },
  { path: '/users', title: 'Users' },
  { path: '/activity', title: 'Activity' },
  { path: '/settings', title: 'Settings' },
];

/** The screens the period and environment controls actually apply to. */
const SCOPED = ['/', '/analytics'];

export function PortalShell() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const leadDetail = useMatch('/leads/:id');

  const primary = PRIMARY.filter((n) => can(profile?.role, n.cap));
  const secondary = SECONDARY.filter((n) => can(profile?.role, n.cap));

  const title = leadDetail
    ? 'Lead'
    : TITLES.find((t) => location.pathname.startsWith(t.path))?.title ?? 'Dashboard';

  // Route change closes the drawer, otherwise it stays open over the page the
  // visitor just asked for.
  useEffect(() => setOpen(false), [location.pathname]);

  // While the drawer is open it owns the screen: the page behind must not
  // scroll, Escape must close it, and focus moves to the close control so a
  // keyboard user is inside the thing that just appeared.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nav = (
    <div className="grid gap-5">
      <NavGroup items={primary} label="Portal sections" />
      {secondary.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <p className="t-section mb-1.5 px-2.5 text-haze/70">Records</p>
          <NavGroup items={secondary} label="Records and administration" subdued />
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[228px_1fr]">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-signal focus:px-3 focus:py-2 focus:text-xs focus:text-black"
      >
        Skip to content
      </a>

      {/* ------------------------------------------------ desktop sidebar */}
      <aside className="hidden border-r border-hair bg-deck lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <Lockup />
        <div className="flex-1 overflow-y-auto px-2.5 py-4">{nav}</div>
        <SidebarFooter profile={profile} onSignOut={signOut} />
      </aside>

      {/* ------------------------------------------------- mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-hair bg-ink/95 px-4 py-2.5 backdrop-blur lg:hidden">
        {/* The mark only. The section name is the command bar's `h1`, which
            sits directly beneath this on a phone, and printing it twice in
            forty pixels of vertical space is two lines saying one thing. */}
        <span className="font-mark text-[13px] tracking-[0.24em] text-paper">STRATOS</span>
        <Button size="sm" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="portal-drawer">
          <Menu size={13} aria-hidden="true" /> Menu
        </Button>
      </header>

      {/* --------------------------------------------------- mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            id="portal-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Portal navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-hair bg-deck"
          >
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <span className="font-mark text-[13px] tracking-[0.24em] text-paper">STRATOS</span>
              <Button ref={closeRef} size="sm" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X size={13} aria-hidden="true" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2.5 py-4">{nav}</div>
            <SidebarFooter profile={profile} onSignOut={signOut} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <CommandBar title={title} scoped={SCOPED.includes(location.pathname)} />
        <main id="portal-main" className="min-w-0 flex-1 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
          {/* One boundary for every split route (see App.tsx). A reserved block
              rather than a spinner: the shell is already drawn, and the thing
              arriving is a screen, so the layout should not jump when it does. */}
          <Suspense fallback={<Skeleton className="h-[60dvh] w-full" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/* ================================================================== brand == */

/**
 * The mark, and it is the only Aboreto in the product.
 *
 * `PORTAL` under it in the section face rather than beside it in yellow: the
 * accent has exactly one job in this sidebar, which is to say which section you
 * are in, and a permanently yellow word two centimetres above the active item
 * makes that job harder.
 */
function Lockup() {
  return (
    <div className="border-b border-hairline px-4 py-3.5">
      <p className="font-mark text-[15px] leading-none tracking-[0.26em] text-paper">STRATOS</p>
      <p className="t-section mt-1.5 text-haze/80">Portal</p>
    </div>
  );
}

/* ============================================================= navigation == */

function NavGroup({ items, label, subdued = false }: { items: NavItem[]; label: string; subdued?: boolean }) {
  return (
    <nav aria-label={label} className="grid gap-px">
      {items.map(({ to, label: text, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => cn(
            'group relative flex items-center gap-2.5 rounded-sm py-1.5 pl-2.5 pr-2 transition-colors',
            subdued ? 'text-[12px]' : 'text-[13px]',
            isActive
              ? 'bg-flare text-paper'
              : cn('hover:bg-flare hover:text-paper', subdued ? 'text-haze/80' : 'text-haze'),
          )}
        >
          {({ isActive }) => (
            <>
              {/* The active marker: a 2px rule at the leading edge. The one
                  piece of yellow in the sidebar, and it is here because "which
                  section am I in" is the question the sidebar exists to answer. */}
              <span
                className={cn(
                  'absolute inset-y-1 left-0 w-0.5 rounded-full',
                  isActive ? 'bg-signal' : 'bg-transparent',
                )}
                aria-hidden="true"
              />
              <Icon
                size={subdued ? 13 : 14}
                strokeWidth={1.75}
                className={isActive ? 'text-paper' : 'text-haze/70'}
                aria-hidden="true"
              />
              <span className="truncate">{text}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/* ================================================================= footer == */

/**
 * Environment, identity, sign out — in that order.
 *
 * The environment comes from `/api/portal-health`, which the System page is
 * already reading, so this costs no extra request on any screen that shows it
 * and simply renders nothing until it lands. A hard-coded "Production" would be
 * a label that is wrong on every deploy preview.
 */
function SidebarFooter({
  profile, onSignOut,
}: { profile: ReturnType<typeof useAuth>['profile']; onSignOut: () => void }) {
  const staff = can(profile?.role, 'view_system');
  const { state } = useHealth(staff);
  const environment = state.kind === 'ready' ? state.data.environment : null;

  return (
    <div className="border-t border-hairline px-4 py-3">
      {environment && (
        <p className="mb-2 flex items-center gap-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              environment === 'production' ? 'bg-good' : 'bg-chrome/60',
            )}
            aria-hidden="true"
          />
          <span className="t-section capitalize text-haze">{environment}</span>
        </p>
      )}
      <p className="truncate text-[12px] text-paper">{profile?.full_name || profile?.email || '—'}</p>
      <p className="t-note mb-2 truncate">{profile ? ROLE_LABELS[profile.role] : '—'}</p>
      <Button size="sm" variant="quiet" className="-ml-2 w-[calc(100%+0.5rem)] justify-start" onClick={onSignOut}>
        <LogOut size={12} aria-hidden="true" /> Sign out
      </Button>
    </div>
  );
}

/* ============================================================ command bar == */

/**
 * Thin application chrome: where you are on the left, what you are looking at
 * on the right.
 *
 * 56px, and it holds three controls at most. Everything that belongs to ONE
 * screen — a metric switch, a page-view tab, a search box — stays on that
 * screen; the moment a page-specific control appears up here the bar stops
 * meaning "global" and becomes a second, higher-status page header.
 */
function CommandBar({ title, scoped }: { title: string; scoped: boolean }) {
  const { range, setRange, environment, setEnvironment, refresh } = useScope();

  return (
    <div className="sticky top-0 z-20 flex min-h-[56px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hair bg-ink/95 px-4 py-2.5 backdrop-blur sm:px-5 lg:px-6">
      <h1 className="t-page">{title}</h1>

      {scoped && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="scope-range">Period</label>
          <Select
            id="scope-range"
            value={range}
            onChange={(e) => setRange(e.target.value as typeof range)}
          >
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.long}</option>)}
          </Select>

          <label className="sr-only" htmlFor="scope-environment">Environment</label>
          <Select
            id="scope-environment"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as typeof environment)}
          >
            {ENVIRONMENTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </Select>

          <Button size="sm" variant="quiet" onClick={refresh} aria-label="Refresh data">
            <RefreshCw size={12} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      )}
    </div>
  );
}

/* ================================================================ helpers == */

/**
 * The 12-column grid every screen lays out on.
 *
 * Twelve at every width, with children declaring `col-span-12 lg:col-span-8`
 * rather than the grid itself changing shape — see the note in styles.css.
 */
export function Grid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid-12', className)}>{children}</div>;
}
