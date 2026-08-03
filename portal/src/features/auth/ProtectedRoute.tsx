import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { can, type Capability } from '@/lib/permissions';
import { Skeleton } from '@/components/ui';

/**
 * Route-level gate.
 *
 * This is a usability control, not a security control. It stops a signed-out
 * visitor seeing a flash of an admin screen and stops a client clicking through
 * to a page that would only show them an empty table. Anyone who wants to skip
 * it can — the bundle is public and the routes are in it. What they cannot skip
 * is RLS, which is why every screen behind this guard reads its data through
 * policies that re-check the same thing server-side.
 */
export function ProtectedRoute({
  children, capability,
}: { children: ReactNode; capability?: Capability }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center p-8">
        <div className="w-full max-w-md space-y-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!session) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Signed in, but the profile row did not load. Usually a project that has run
  // auth migrations but not the schema ones. Fail closed with something the
  // person can act on rather than an empty screen.
  if (!profile) {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="max-w-md">
          <p className="font-data text-[11px] uppercase tracking-[0.18em] text-danger">No profile</p>
          <p className="mt-2 text-sm text-haze">
            You are signed in, but this account has no profile record. An administrator needs to
            finish setting it up.
          </p>
        </div>
      </div>
    );
  }

  if (capability && !can(profile.role, capability)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
