import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/pages';
import { PortalShell } from '@/components/shell/PortalShell';
import { useAuth } from '@/features/auth/AuthProvider';
import { ScopeProvider } from '@/lib/scope';
import { LanguageGate } from '@/features/i18n/LanguageGate';
import { t } from '@/lib/i18n';
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
 * tables, the chart) and is never a landing page. Sales, Clients and Projects
 * are one chunk each. The remaining record screens are one chunk between them
 * because they are one module and are opened rarely.
 *
 * P2 added three modules and did NOT add them to the entry bundle. The Dashboard
 * shows a pipeline summary and an active-projects list, and both come from a
 * server-side aggregate rather than from the modules' own code — so opening the
 * Portal costs the same JavaScript it did before this phase.
 */
const AnalyticsScreen = lazy(() =>
  import('@/pages/analytics').then((m) => ({ default: m.AnalyticsScreen })));

// The three P2 modules. Each is its own chunk, and each list ships with its own
// detail screen rather than in a separate one: opening a record from a list is
// the single most likely next click, and splitting the two would mean a second
// network round trip at exactly that moment.
const SalesScreen = lazy(() => import('@/pages/sales').then((m) => ({ default: m.SalesScreen })));
const OpportunityDetailScreen = lazy(() =>
  import('@/pages/opportunity-detail').then((m) => ({ default: m.OpportunityDetailScreen })));
const ClientsScreen = lazy(() => import('@/pages/clients').then((m) => ({ default: m.ClientsScreen })));
const ClientDetailScreen = lazy(() =>
  import('@/pages/clients').then((m) => ({ default: m.ClientDetailScreen })));
const ProjectsScreen = lazy(() => import('@/pages/projects').then((m) => ({ default: m.ProjectsScreen })));
const ProjectDetailScreen = lazy(() =>
  import('@/pages/projects').then((m) => ({ default: m.ProjectDetailScreen })));
const ProjectTemplatesScreen = lazy(() =>
  import('@/pages/projects').then((m) => ({ default: m.ProjectTemplatesScreen })));

// The Impact Program: its own chunk, owner-only. Its projects open in the
// project screen above, which adapts to `program`.
const ImpactScreen = lazy(() => import('@/pages/impact').then((m) => ({ default: m.ImpactScreen })));
const ImpactApplicationScreen = lazy(() =>
  import('@/pages/impact').then((m) => ({ default: m.ImpactApplicationScreen })));

// The document library: its own chunk, owner-only. The project screen embeds
// the same `ProjectLibrary` component, over the same rows.
const DocumentsScreen = lazy(() => import('@/pages/documents').then((m) => ({ default: m.DocumentsScreen })));
const DocumentsProjectScreen = lazy(() =>
  import('@/pages/documents').then((m) => ({ default: m.DocumentsProjectScreen })));

// The client portal: a separate, Hungarian surface for `client` accounts, and
// the page an invitation link opens. Their own chunk: staff never load them.
const HelpCentreScreen = lazy(() => import('@/pages/help').then((m) => ({ default: m.HelpCentreScreen })));
const ClientApp = lazy(() => import('@/features/client/ClientApp').then((m) => ({ default: m.ClientApp })));
const AcceptInvitePage = lazy(() =>
  import('@/features/client/AcceptInvite').then((m) => ({ default: m.AcceptInvitePage })));

/**
 * Who gets which portal. A `client` account never renders the staff shell or
 * any staff screen — the layout itself is swapped, so no staff route can be
 * reached by typing its address. What a client can READ is decided in the
 * database regardless (the client_portal_* functions).
 */
function PortalRoot() {
  const { profile } = useAuth();
  if (profile?.role === 'client') return <Suspense fallback={null}><ClientApp /></Suspense>;
  return <ScopeProvider><PortalShell /></ScopeProvider>;
}

const CaseStudiesScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.CaseStudiesScreen })));
const UsersScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.UsersScreen })));
const ActivityScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.ActivityScreen })));
const SettingsScreen = lazy(() => import('@/pages/screens').then((m) => ({ default: m.SettingsScreen })));
// Projects, clients and leads moved to the Trash (20261007000100_trash.sql).
// Each section inside checks its own capability.
const TrashScreen = lazy(() => import('@/pages/trash').then((m) => ({ default: m.TrashScreen })));
// Notes, checklists and tasks (20261011000100_notes_tasks_activity.sql).
const NotesScreen = lazy(() => import('@/pages/notes').then((m) => ({ default: m.NotesScreen })));
const TodayScreen = lazy(() => import('@/pages/today').then((m) => ({ default: m.TodayScreen })));
// Hours worked, per person per day (20261012000100_time_entries.sql).
const HoursScreen = lazy(() => import('@/pages/hours').then((m) => ({ default: m.HoursScreen })));
const DataScreen = lazy(() => import('@/pages/data').then((m) => ({ default: m.DataScreen })));
const RevenueScreen = lazy(() => import('@/pages/revenue').then((m) => ({ default: m.RevenueScreen })));

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
          <p className="font-data text-[11px] uppercase tracking-[0.18em] text-danger">{t('Something broke')}</p>
          <p className="mt-2 text-sm text-haze">
            {t('The portal hit an error it could not recover from. Reloading usually clears it.')}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-sm border border-hair px-4 py-2 font-data text-[11px] uppercase tracking-[0.14em] hover:bg-flare"
          >
            {t('Reload')}
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
          <LanguageGate>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/accept-invite" element={<Suspense fallback={null}><AcceptInvitePage /></Suspense>} />

            <Route
              element={
                <ProtectedRoute>
                  {/* Scope wraps the shell rather than the app: it is the
                      Control Room's state, and the sign-in screen has no
                      period, no deployment and nothing to refresh. A client
                      gets the client portal instead of the shell. */}
                  <PortalRoot />
                </ProtectedRoute>
              }
            >
              {/* ------------------------------------------- the products */}
              <Route index element={<DashboardScreen />} />
              <Route path="analytics" element={
                <ProtectedRoute capability="view_analytics"><AnalyticsScreen /></ProtectedRoute>} />
              <Route path="leads" element={
                <ProtectedRoute capability="view_leads"><LeadsScreen /></ProtectedRoute>} />
              <Route path="leads/:id" element={
                <ProtectedRoute capability="view_leads"><LeadDetailScreen /></ProtectedRoute>} />
              <Route path="system" element={
                <ProtectedRoute capability="view_system"><SystemScreen /></ProtectedRoute>} />

              {/* ------------------------------ revenue and operations (P2) */}
              <Route path="sales" element={
                <ProtectedRoute capability="view_sales"><SalesScreen /></ProtectedRoute>} />
              <Route path="sales/:id" element={
                <ProtectedRoute capability="view_sales"><OpportunityDetailScreen /></ProtectedRoute>} />
              <Route path="clients" element={
                <ProtectedRoute capability="view_clients"><ClientsScreen /></ProtectedRoute>} />
              <Route path="clients/:id" element={
                <ProtectedRoute capability="view_clients"><ClientDetailScreen /></ProtectedRoute>} />
              <Route path="projects" element={
                <ProtectedRoute capability="view_projects"><ProjectsScreen /></ProtectedRoute>} />
              {/* Owner-only: `view_projects` belongs to no role, only to the
                  designated portal owner (see canAccess in lib/permissions). */}
              <Route path="projects/templates" element={
                <ProtectedRoute capability="manage_projects"><ProjectTemplatesScreen /></ProtectedRoute>} />
              <Route path="projects/:id" element={
                <ProtectedRoute capability="view_projects"><ProjectDetailScreen /></ProtectedRoute>} />
              {/* The revenue report: made of the payments, so owner-only like them. */}
              <Route path="revenue" element={
                <ProtectedRoute capability="view_projects"><RevenueScreen /></ProtectedRoute>} />

              {/* ------------------------------------ the Impact Program */}
              <Route path="impact" element={
                <ProtectedRoute capability="view_impact"><ImpactScreen /></ProtectedRoute>} />
              <Route path="impact/applications/:id" element={
                <ProtectedRoute capability="view_impact"><ImpactApplicationScreen /></ProtectedRoute>} />

              {/* ------------------------------ the document library */}
              <Route path="documents" element={
                <ProtectedRoute capability="view_documents"><DocumentsScreen /></ProtectedRoute>} />
              <Route path="documents/:id" element={
                <ProtectedRoute capability="view_documents"><DocumentsProjectScreen /></ProtectedRoute>} />

              {/* ---------------------------------------- the help centre */}
              <Route path="help" element={
                <ProtectedRoute capability="manage_help"><HelpCentreScreen /></ProtectedRoute>} />

              {/* -------------------------------------------- the records */}
              <Route path="case-studies" element={
                <ProtectedRoute capability="view_case_studies"><CaseStudiesScreen /></ProtectedRoute>} />
              <Route path="users" element={
                <ProtectedRoute capability="manage_users"><UsersScreen /></ProtectedRoute>} />
              <Route path="activity" element={
                <ProtectedRoute capability="view_activity"><ActivityScreen /></ProtectedRoute>} />
              <Route path="data" element={
                <ProtectedRoute capability="manage_clients"><DataScreen /></ProtectedRoute>} />
              <Route path="settings" element={
                <ProtectedRoute capability="manage_settings"><SettingsScreen /></ProtectedRoute>} />
              <Route path="today" element={
                <ProtectedRoute capability="manage_clients"><TodayScreen /></ProtectedRoute>} />
              <Route path="hours" element={
                <ProtectedRoute capability="manage_clients"><HoursScreen /></ProtectedRoute>} />
              <Route path="notes" element={
                <ProtectedRoute capability="manage_clients"><NotesScreen /></ProtectedRoute>} />
              <Route path="trash" element={
                <ProtectedRoute capability="manage_leads"><TrashScreen /></ProtectedRoute>} />

              <Route path="*" element={<NotFoundScreen />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </LanguageGate>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
