import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity, Building2, FileText, FolderKanban, Image, LayoutDashboard, LogOut,
  Menu, Settings, Users, X,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can, ROLE_LABELS, type Capability } from '@/lib/permissions';
import { Button, cn } from '@/components/ui';

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; cap: Capability }[] = [
  { to: '/',              label: 'Overview',     icon: LayoutDashboard, cap: 'view_dashboard' },
  { to: '/leads',         label: 'Leads',        icon: FileText,        cap: 'view_leads' },
  { to: '/projects',      label: 'Projects',     icon: FolderKanban,    cap: 'view_projects' },
  { to: '/clients',       label: 'Clients',      icon: Building2,       cap: 'view_clients' },
  { to: '/case-studies',  label: 'Case studies', icon: Image,           cap: 'view_case_studies' },
  { to: '/users',         label: 'Users',        icon: Users,           cap: 'manage_users' },
  { to: '/activity',      label: 'Activity',     icon: Activity,        cap: 'view_activity' },
  { to: '/settings',      label: 'Settings',     icon: Settings,        cap: 'manage_settings' },
];

export function AdminLayout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);

  const items = NAV.filter((n) => can(profile?.role, n.cap));

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
    <nav aria-label="Portal sections" className="grid gap-0.5">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
            isActive
              ? 'bg-white/[0.07] text-paper'
              : 'text-haze hover:bg-white/[0.04] hover:text-paper',
          )}
        >
          {({ isActive }) => (
            <>
              <Icon size={15} strokeWidth={1.75} className={isActive ? 'text-signal' : ''} aria-hidden="true" />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-signal focus:px-3 focus:py-2 focus:text-xs focus:text-black"
      >
        Skip to content
      </a>

      {/* ------------------------------------------------ desktop sidebar */}
      <aside className="hidden border-r border-hair bg-black/25 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 border-b border-hair px-5 py-4">
          <span className="font-data text-[13px] tracking-[0.3em] text-paper">STRATOS</span>
          <span className="label text-signal">PORTAL</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{nav}</div>
        <Footer profile={profile} onSignOut={signOut} />
      </aside>

      {/* ------------------------------------------------- mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-hair bg-ink/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="font-data text-[12px] tracking-[0.3em]">STRATOS</span>
        <Button size="sm" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="portal-drawer">
          <Menu size={14} aria-hidden="true" /> Menu
        </Button>
      </header>

      {/* --------------------------------------------------- mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            id="portal-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Portal navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-hair bg-ink"
          >
            <div className="flex items-center justify-between border-b border-hair px-4 py-3">
              <span className="font-data text-[12px] tracking-[0.3em]">STRATOS</span>
              <Button ref={closeRef} size="sm" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X size={14} aria-hidden="true" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">{nav}</div>
            <Footer profile={profile} onSignOut={signOut} />
          </div>
        </div>
      )}

      <main id="portal-main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function Footer({
  profile, onSignOut,
}: { profile: ReturnType<typeof useAuth>['profile']; onSignOut: () => void }) {
  return (
    <div className="border-t border-hair p-3">
      <div className="mb-2 px-2">
        <p className="truncate text-xs text-paper">{profile?.full_name || profile?.email}</p>
        <p className="label">{profile ? ROLE_LABELS[profile.role] : '—'}</p>
      </div>
      <Button size="sm" className="w-full" onClick={onSignOut}>
        <LogOut size={13} aria-hidden="true" /> Sign out
      </Button>
    </div>
  );
}
