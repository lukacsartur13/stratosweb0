/**
 * The three public settings (mobile/.env.example). Expo inlines an
 * EXPO_PUBLIC_ variable only when it is read by its full name, so each is
 * spelled out here once.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_ORIGIN || 'https://stratosweb.hu').replace(/\/+$/, '');

export const isConfigured = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

/** The full Portal, for everything the app does not do itself. */
export const PORTAL_URL = 'https://stratosweb.hu/portal/';
