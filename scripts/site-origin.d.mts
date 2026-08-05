// Types for site-origin.mjs, which is plain JavaScript because two of its three
// consumers are plain JavaScript (scripts/assemble.mjs) or Python
// (_build/build.py). Only the Vite config is TypeScript, and it needs this.

/** The intended main domain, used when nothing in the environment says otherwise. */
export declare const FALLBACK_ORIGIN: string;

/** The site's origin, with no trailing slash. */
export declare function siteOrigin(env?: NodeJS.ProcessEnv): string;

/** True for a netlify.app address or any non-production Netlify context. */
export declare function isPreviewOrigin(env?: NodeJS.ProcessEnv): boolean;
