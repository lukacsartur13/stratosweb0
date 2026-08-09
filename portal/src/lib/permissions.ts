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
  | 'view_analytics';

const MATRIX: Record<Role, Capability[]> = {
  super_admin: [
    'view_dashboard', 'view_leads', 'manage_leads', 'view_projects', 'manage_projects',
    'view_clients', 'manage_clients', 'view_case_studies', 'manage_case_studies',
    'manage_content', 'view_media', 'manage_users', 'manage_settings', 'view_activity',
    'view_analytics',
  ],
  admin: [
    'view_dashboard', 'view_leads', 'manage_leads', 'view_projects', 'manage_projects',
    'view_clients', 'manage_clients', 'view_case_studies', 'manage_case_studies',
    'manage_content', 'view_media', 'view_activity', 'view_analytics',
  ],
  // A team member sees the work assigned to them. The RLS policy on `projects`
  // is what actually narrows the rows; this just hides the screens that would
  // be empty for them anyway.
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
