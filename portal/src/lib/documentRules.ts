/**
 * The document library's pure rules — no network, no React, no Supabase — so
 * they can be tested directly (tests/portal-documents.spec.ts). `documents.ts`
 * re-exports all of it; import from there.
 */

import { t } from './i18n.ts';

export const DOCUMENT_BUCKET = 'project-documents';
/** Mirrors `document_max_bytes()`. The database and the bucket enforce it; this only answers early. */
export const MAX_DOCUMENT_BYTES = 52428800;
/** Download links live one minute: long enough to start the download, no longer. */
export const DOWNLOAD_URL_SECONDS = 60;
/** Larger files are not previewed in the browser; they download. */
export const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

/* ================================================================= types == */

export interface DocFolder {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  trashed_at: string | null;
  trashed_with: string | null;
  /** `client_uploads` for a project's "Ügyféltől érkezett nyersanyagok" folder (phase 4). */
  purpose?: string | null;
}

export interface Doc {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  byte_size: number;
  declared_type: string | null;
  content_kind: string;
  upload_state: 'pending' | 'ready' | 'failed';
  failure_reason: string | null;
  storage_path: string;
  created_at: string;
  completed_at: string | null;
  trashed_at: string | null;
  trashed_with: string | null;
  /** Set when a client handed this in through "Nyersanyag leadása". */
  client_account_id?: string | null;
  uploader?: { full_name: string } | null;
}

export const FOLDER_COLUMNS = 'id, project_id, parent_id, name, created_at, trashed_at, trashed_with, purpose';
export const DOC_COLUMNS = 'id, project_id, folder_id, name, byte_size, declared_type, content_kind, upload_state, failure_reason, '
  + 'storage_path, created_at, completed_at, trashed_at, trashed_with, client_account_id, '
  // Who handed it in, for a client's upload (phase 4). Owner-only, like the row.
  + 'uploader:client_accounts(full_name)';

/* ========================================================= pure rules == */

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * A file name as the database will accept it: no control characters (NUL
 * cannot even be sent to Postgres), no path separators. The database cleans it
 * again (`document_clean_name`); this keeps the request itself valid.
 */
export function cleanFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const n = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
  return n === '' || n === '.' || n === '..' ? 'file' : n;
}

/** `%` and `_` are wildcards to ILIKE, and `\` escapes them. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* ====================================================== allowed types == */

/**
 * The content kinds a file's first bytes can show (`sniffKind`).
 */
export type ContentKind =
  | 'pdf' | 'postscript' | 'png' | 'jpeg' | 'gif' | 'webp' | 'tiff' | 'psd' | 'svg'
  | 'zip' | 'ole' | 'rtf' | 'text' | 'isobmff' | 'mp3';

/**
 * THE ALLOWED FILE TYPES: extension → the content kinds it may carry. The same
 * list as `document_kinds_for()` in 20260930000100_document_library.sql
 * (asserted equal in tests/portal-documents-db.spec.ts), which refuses any
 * other pair in the database. Documented in supabase/DOCUMENTS.md §3.
 */
export const ALLOWED_TYPES: Record<string, readonly ContentKind[]> = {
  pdf: ['pdf'], ai: ['pdf', 'postscript'], eps: ['postscript'],
  png: ['png'], jpg: ['jpeg'], jpeg: ['jpeg'], gif: ['gif'], webp: ['webp'], tif: ['tiff'], tiff: ['tiff'],
  heic: ['isobmff'], psd: ['psd'], svg: ['svg'],
  docx: ['zip'], xlsx: ['zip'], pptx: ['zip'], odt: ['zip'], ods: ['zip'], odp: ['zip'], zip: ['zip'],
  doc: ['ole'], xls: ['ole'], ppt: ['ole'], rtf: ['rtf'],
  txt: ['text'], csv: ['text'], md: ['text'],
  mp4: ['isobmff'], mov: ['isobmff'], m4a: ['isobmff'], mp3: ['mp3'],
};

/** How many leading bytes are read to decide. */
export const SNIFF_BYTES = 4096;

/** Same rule as `document_extension()`: 1–8 letters or digits after the last dot. */
export const extensionOf = (name: string) => (name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? '').toLowerCase();

const startsWith = (head: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => head[offset + i] === b);
const asciiAt = (head: Uint8Array, text: string, offset = 0) =>
  startsWith(head, [...text].map((c) => c.charCodeAt(0)), offset);

function utf8Text(head: Uint8Array): string | null {
  if (head.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
  } catch {
    return null;
  }
}

/**
 * What the bytes ARE — from the file's own first bytes, never from its name or
 * the type the browser declares. `ext` only decides between the two text
 * readings (an SVG is text; so is a CSV). Returns null for anything that is
 * not one of the allowed kinds.
 *
 * What this cannot tell: whether a real PDF carries JavaScript, whether an
 * Office file carries macros, whether a ZIP holds something harmful, whether
 * anything is malware. A signature says what a file is, not that it is safe.
 */
export function sniffKind(head: Uint8Array, ext: string): ContentKind | null {
  if (asciiAt(head, '%PDF-')) return 'pdf';
  if (asciiAt(head, '%!PS') || startsWith(head, [0xc5, 0xd0, 0xd3, 0xc6])) return 'postscript';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (asciiAt(head, 'GIF87a') || asciiAt(head, 'GIF89a')) return 'gif';
  if (asciiAt(head, 'RIFF') && asciiAt(head, 'WEBP', 8)) return 'webp';
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (asciiAt(head, '8BPS')) return 'psd';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return 'zip';
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (asciiAt(head, '{\\rtf')) return 'rtf';
  if (asciiAt(head, 'ftyp', 4)) return 'isobmff';
  if (asciiAt(head, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'mp3';

  const text = utf8Text(head);
  if (text === null) return null;
  if (ext === 'svg') return /<svg[\s>]/i.test(text) ? 'svg' : null;
  // A "text" file that is really markup would render if opened locally.
  if (/^\s*<(?:!doctype|html|script|svg|\?xml)/i.test(text)) return null;
  return 'text';
}

/** May this file be uploaded? Decided from its name AND its first bytes. */
export function checkUploadable(name: string, head: Uint8Array):
{ ok: true; kind: ContentKind } | { ok: false; reason: string; code: 'extension' | 'content'; ext: string } {
  const ext = extensionOf(name);
  const allowed = ALLOWED_TYPES[ext];
  if (!allowed) {
    return { ok: false, code: 'extension', ext,
      reason: ext ? t('.{ext} files are not accepted.', { ext }) : t('Files without an extension are not accepted.') };
  }
  const kind = sniffKind(head, ext);
  if (!kind || !allowed.includes(kind)) {
    return { ok: false, code: 'content', ext, reason: t('This file\'s content does not match .{ext}, so it was not uploaded.', { ext }) };
  }
  return { ok: true, kind };
}

/** For the upload hint. */
export const ALLOWED_SUMMARY = 'PDF, Office/OpenDocument, text/CSV, images (PNG, JPG, GIF, WebP, TIFF, HEIC, SVG), '
  + 'PSD/AI/EPS, MP4/MOV/MP3, ZIP';

/* ============================================================= preview == */

export type PreviewKind =
  | { kind: 'image'; mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }
  | { kind: 'text' };

const TEXT_PREVIEW = ['txt', 'csv', 'md'];
const PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', ...TEXT_PREVIEW];

/** Worth offering a preview for — the bytes still decide (`sniffPreview`). */
export const mayPreview = (d: Pick<Doc, 'name' | 'byte_size'>) =>
  PREVIEW_EXTENSIONS.includes(extensionOf(d.name)) && d.byte_size <= MAX_PREVIEW_BYTES;

/**
 * Only two things are ever shown inside the Portal: raster images (as an
 * `<img>` of a blob re-typed from the sniffed bytes — an image element runs no
 * script) and plain text (as a React text node in a `<pre>`, never as HTML).
 * PDF, SVG, HTML, Office files, archives and everything else only download,
 * as an attachment. Nothing is unpacked: a ZIP is bytes to the Portal.
 */
export function sniffPreview(head: Uint8Array, name: string): PreviewKind | null {
  const ext = extensionOf(name);
  if (!PREVIEW_EXTENSIONS.includes(ext)) return null;
  const kind = sniffKind(head, ext);
  if (kind === 'png') return { kind: 'image', mime: 'image/png' };
  if (kind === 'jpeg') return { kind: 'image', mime: 'image/jpeg' };
  if (kind === 'gif') return { kind: 'image', mime: 'image/gif' };
  if (kind === 'webp') return { kind: 'image', mime: 'image/webp' };
  if (kind === 'text' && TEXT_PREVIEW.includes(ext)) return { kind: 'text' };
  return null;
}

/** Plain words for every refusal the library can meet. */
export function documentRefusal(error: { code?: string; message?: string } | null | undefined): string {
  const m = error?.message ?? '';
  if (/client_no_access|share_not_assigned/.test(m)) return t('This client account is not assigned to this project.');
  if (/document_type_not_allowed/.test(m)) return t('This file type is not accepted, or its content does not match its extension.');
  if (/document_too_large/.test(m)) return t('The file is larger than {max}, the upload limit.', { max: formatBytes(MAX_DOCUMENT_BYTES) });
  if (/document_folder_trashed/.test(m)) return t('That folder is in the trash. Restore it first.');
  if (/document_folder_cycle/.test(m)) return t('A folder cannot be moved inside itself.');
  if (/document_project_fixed/.test(m)) return t('Files and folders stay in their own project.');
  if (/document_ready_final|document_fact_fixed/.test(m)) return t('A finished upload cannot be changed. Upload a new file instead.');
  if (/document_not_uploaded/.test(m)) return t('The stored file is missing or incomplete, so it was not marked as uploaded.');
  if (/document_name_valid|check constraint/.test(m) || error?.code === '23514') {
    return t('Use a name of 1–200 characters without / or \\.');
  }
  if (error?.code === '23505') return t('Something in this folder already has that name.');
  if (error?.code === '23503') return t('That folder belongs to another project.');
  if (error?.code === '42501' || /document_owner_only/.test(m)) return t('Only the portal owner can do this.');
  if (error?.code === 'P0002') return t('It no longer exists, or this account may not see it.');
  return t('The change could not be saved. Try again.');
}

export const FAILURE_LABEL: Record<string, string> = {
  network: 'The connection dropped during the upload.',
  cancelled: 'The upload was cancelled.',
  expired: 'The upload was never completed.',
  too_large: `The stored file is larger than ${formatBytes(MAX_DOCUMENT_BYTES)}.`,
  size_mismatch: 'The stored file is not the size that was sent. Upload it again.',
  storage_refused: 'Storage refused the file.',
  access_revoked: 'Access to this project was withdrawn before the upload finished.',
};

/** Folder id → its path from the project root, for breadcrumbs and pickers. */
export function folderPath(folders: DocFolder[], id: string | null): DocFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: DocFolder[] = [];
  const seen = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}
