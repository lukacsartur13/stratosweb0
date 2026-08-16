import { Component, lazy, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/pages';
import { PortalShell } from '@/components/shell/PortalShell';
import { ScopeProvider } from '@/lib/scope';
import { DashboardScreen } from '@/pages/dashboard';
import { LeadsScreen } from '@/pages/leads';
import { LeadDetailScreen } from '@/pages/lead-detail';
import { SystemScreen } from '@/pages/system';
import { NotFoundScreen } from '@/pages/not-found';

/**
 * WHAT IS AND IS NOT IN THE FIRST BUNDLE
 *
 * The Dashboard is the only render that is ever on somebody's critical path:
 * everything else in this product is reached by clicking, by which time a chunk
 * has had time to arrive. So the entry bundle carries the shell, the Dashboard,
 * Leads and System — the four things an operator opens without thinking — and
 * everything else is split.
 *
 * Analytics is the largest single screen in the product (six sections, five
 * tables, the chart) and is never a landing page. The six record screens are
 * one chunk between them because they are one module and are opened rarely.
 */
const AnalyticsScreen = lazy(() =>
  import('@/pages/analytics').then((m) => ({ default: m.AnalyticsScreen })));

const ProjectsScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.ProjectsScreen })));
const ClientsScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.ClientsScreen })));
const CaseStudiesScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.CaseStudiesScreen })));
const UsersScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.UsersScreen })));
const ActivityScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.ActivityScreen })));
const SettingsScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.SettingsScreen })));

/**
 * Nothing below this should ever show a visitor a stack trace. React unmounts
 * the whole tree on an uncaught render error, so without a boundary a single
 * bad row of data turns the portal into a blank white page.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The detail goes to the console for whoever is debugging, and nowhere else.
    console.error('Portal crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-md">
          <p className="font-data text-[11px] uppercase tracking-[0.18em] text-danger">Something broke</p>
          <p className="mt-2 text-sm text-haze">
            The portal hit an error it could not recover from. Reloading usually clears it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-sm border border-hair px-4 py-2 font-data text-[11px] uppercase tracking-[0.14em] hover:bg-flare"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* basename keeps every route under /portal, so the static site keeps the
          root and a direct hit on /portal/leads still resolves. */}
      <BrowserRouter basename="/portal">
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route
              element={
                <ProtectedRoute>
                  {/* Scope wraps the shell rather than the app: it is the
                      Control Room's state, and the sign-in screen has no
                      period, no deployment and nothing to refresh. */}
                  <ScopeProvider><PortalShell /></ScopeProvider>
                </ProtectedRoute>
              }
            >
              {/* ---------------------------------------- the four products */}
              <Route index element={<DashboardScreen />} />
              <Route path="analytics" element={
                <ProtectedRoute capability="view_analytics"><AnalyticsScreen /></ProtectedRoute>} />
              <Route path="leads" element={
                <ProtectedRoute capability="view_leads"><LeadsScreen /></ProtectedRoute>} />
              <Route path="leads/:id" element={
                <ProtectedRoute capability="view_leads"><LeadDetailScreen /></ProtectedRoute>} />
              <Route path="system" element={
                <ProtectedRoute capability="view_system"><SystemScreen /></ProtectedRoute>} />

              {/* -------------------------------------------- the records */}
              <Route path="projects" element={
                <ProtectedRoute capability="view_projects"><ProjectsScreen /></ProtectedRoute>} />
              <Route path="clients" element={
                <ProtectedRoute capability="view_clients"><ClientsScreen /></ProtectedRoute>} />
              <Route path="case-studies" element={
                <ProtectedRoute capability="view_case_studies"><CaseStudiesScreen /></ProtectedRoute>} />
              <Route path="users" element={
                <ProtectedRoute capability="manage_users"><UsersScreen /></ProtectedRoute>} />
              <Route path="activity" element={
                <ProtectedRoute capability="view_activity"><ActivityScreen /></ProtectedRoute>} />
              <Route path="settings" element={
                <ProtectedRoute capability="manage_settings"><SettingsScreen /></ProtectedRoute>} />

              <Route path="*" element={<NotFoundScreen />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
