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
  // The private project tracker. NOT in any role's list below: these two are
  // held only by the designated portal owner (`is_owner()` in
  // 20260928000200_owner_tracker.sql), whatever their role — a second
  // super_admin does not get them. See `canAccess`.
  | 'view_projects'
  | 'manage_projects'
  // The Impact pipeline, Impact projects and their market values. Owner-only
  // for now, for the same reason as projects: every table and function behind
  // it answers to `is_owner()` (20260929000300_impact_program.sql).
  | 'view_impact'
  // The private document library (Documents, and the Documents panel on a
  // project). Owner-only: every table, function and stored object behind it
  // answers to `is_owner()` (20260930000100_document_library.sql).
  | 'view_documents'
  // Inviting client accounts, assigning their projects and sharing documents
  // with them (20261001000100_client_portal.sql). Owner-only.
  | 'manage_client_accounts'
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
    'view_dashboard', 'view_leads', 'manage_leads',
    'view_clients', 'manage_clients', 'view_sales', 'manage_sales',
    'view_case_studies', 'manage_case_studies',
    'manage_content', 'view_media', 'manage_users', 'manage_settings', 'view_activity',
    'view_analytics', 'view_system',
  ],
  admin: [
    'view_dashboard', 'view_leads', 'manage_leads',
    'view_clients', 'manage_clients', 'view_sales', 'manage_sales',
    'view_case_studies', 'manage_case_studies',
    'manage_content', 'view_media', 'view_activity', 'view_analytics', 'view_system',
  ],
  // A team member does NOT see the commercial book. `opportunities` grants
  // select to `is_staff()`, so a team member CAN read the pipeline through
  // PostgREST; Sales is hidden here because a pipeline screen is not their work,
  // and the day that judgement changes it is one line in this matrix rather than
  // a migration. Projects are the owner's alone (see OWNER_CAPABILITIES).
  team_member: ['view_dashboard', 'view_case_studies', 'view_media'],
  // The client portal is scaffolded, not built. A client can sign in and reach
  // an overview; everything else is staff-only until the client features land.
  client: ['view_dashboard'],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role].includes(capability);
}

/**
 * Capabilities no ROLE carries. They follow `profiles.is_owner`, which the
 * AuthProvider reads from `is_owner()` — the same function every project
 * policy calls — so the screen and the database cannot disagree about who the
 * owner is. The role check is repeated because the database repeats it.
 */
export const OWNER_CAPABILITIES: readonly Capability[] = ['view_projects', 'manage_projects', 'view_impact', 'view_documents', 'manage_client_accounts'];

export function canAccess(
  profile: { role: Role; is_owner?: boolean } | null | undefined,
  capability: Capability,
): boolean {
  if (!profile) return false;
  if (OWNER_CAPABILITIES.includes(capability)) {
    // The owner (super_admin) or a named owner delegate (admin or super_admin,
    // 20261003000100_owner_delegates.sql). The role floor mirrors is_owner().
    return profile.is_owner === true && (profile.role === 'super_admin' || profile.role === 'admin');
  }
  return can(profile.role, capability);
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
