// =============================================================================
// The authorization model, as the UI understands it.
//
// Read this alongside supabase/migrations/20260801000200_rls.sql. That file is
// the enforcement; this one is presentation. Everything here decides whether to
// draw a link or a button — nothing here decides whether data may be read. If
// the two ever disagree, the database wins and the user sees an empty table
// rather than someone else's records.
// =============================================================================

export type Role = 'super_admin' | 'admin' | 'team_member' | 'client';

export type Capability =
  | 'view_dashboard'
  | 'view_leads'
  | 'manage_leads'
  | 'view_projects'
  | 'manage_projects'
  // The commercial book: opportunities, the pipeline, follow-ups, performance.
  // A separate capability from `view_clients` even though the same two roles
  // hold both today, because they are different questions: "what are we likely
  // to close" and "who do we work for" are read by different people the moment
  // there is more than one of us. The RLS policies on `opportunities` are what
  // actually decide; this decides whether the nav item and the route are drawn.
  | 'view_sales'
  | 'manage_sales'
  | 'view_clients'
  | 'manage_clients'
  | 'view_case_studies'
  | 'manage_case_studies'
  | 'manage_content'
  | 'view_media'
  | 'manage_users'
  | 'manage_settings'
  | 'view_activity'
  // Property-wide traffic reporting. Staff-wide would be the easy default and
  // is the wrong one: this is a business-level view of the whole site, not the
  // work someone is assigned to. The same two roles are checked again, server
  // side, in netlify/functions/portal-analytics.mjs — hiding the nav item
  // decides what is drawn, and that check decides what can be read.
  | 'view_analytics'
  // Infrastructure diagnostics. A separate capability from `view_analytics`
  // even though the same two roles hold both today, because they are different
  // questions and will not always have the same answer: "how is the business
  // doing" and "which integrations are broken" are read by different people the
  // moment there is more than one of us. `netlify/functions/portal-health.mjs`
  // enforces super_admin/admin server-side; this decides whether the nav item
  // and the route are drawn.
  | 'view_system';

const MATRIX: Record<Role, Capability[]> = {
  super_admin: [
    'view_dashboard', 'view_leads', 'manage_leads', 'view_projects', 'manage_projects',
    'view_clients', 'manage_clients', 'view_sales', 'manage_sales',
    'view_case_studies', 'manage_case_studies',
    'manage_content', 'view_media', 'manage_users', 'manage_settings', 'view_activity',
    'view_analytics', 'view_system',
  ],
  admin: [
    'view_dashboard', 'view_leads', 'manage_leads', 'view_projects', 'manage_projects',
    'view_clients', 'manage_clients', 'view_sales', 'manage_sales',
    'view_case_studies', 'manage_case_studies',
    'manage_content', 'view_media', 'view_activity', 'view_analytics', 'view_system',
  ],
  // A team member sees the work assigned to them. The RLS policy on `projects`
  // is what actually narrows the rows; this just hides the screens that would
  // be empty for them anyway.
  // A team member sees the delivery work and NOT the commercial book. This
  // mirrors the database rather than merely agreeing with it: `opportunities`
  // grants select to `is_staff()`, so a team member CAN read the pipeline
  // through PostgREST — but `project_costs` is admin-only, which is the line
  // that actually matters. Sales is hidden here because a pipeline screen is not
  // the work they are assigned to, and the day that judgement changes it is one
  // line in this matrix rather than a migration.
  team_member: ['view_dashboard', 'view_projects', 'view_case_studies', 'view_media'],
  // The client portal is scaffolded, not built. A client can sign in and reach
  // their own overview; the rest of the screens are staff-only until the client
  // features in ARCHITECTURE.md land.
  client: ['view_dashboard', 'view_projects'],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role].includes(capability);
}

export function isStaff(role: Role | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'team_member';
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  team_member: 'Team member',
  client: 'Client',
};
