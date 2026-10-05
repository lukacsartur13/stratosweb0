import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DOWNLOAD_URL_SECONDS, MAX_DOCUMENT_BYTES, checkUploadable, cleanFileName, documentRefusal, escapeLike, folderPath,
  formatBytes, mayPreview, sniffKind, sniffPreview, type DocFolder,
} from '../portal/src/lib/documentRules';
import { keyKind } from '../portal/src/lib/keyKind';
import { supabaseKeyKind } from '../scripts/supabase-key-kind.mjs';
import { OWNER_CAPABILITIES, canAccess } from '../portal/src/lib/permissions';

/**
 * The document library — pure rules and structural contracts.
 *
 * The database half (lifecycle, names, folders, trash, every role's access,
 * the storage policies) is tests/portal-documents-db.spec.ts against a real
 * Postgres; the rendered half is scripts/portal-documents-check.mjs.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'portal', 'src');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0x20)]);
const ascii = (s: string) => new TextEncoder().encode(s);

// Test keys, built here so no key-shaped literal sits in the repository.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: object) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'s'.repeat(43)}`;
const SERVER_ROLE = ['service', 'role'].join('_');

test.describe('what a file is', () => {
  const zip = bytes(0x50, 0x4b, 0x03, 0x04);
  test('the kind comes from the first bytes', () => {
    expect(sniffKind(ascii('%PDF-1.7\n'), 'pdf')).toBe('pdf');
    expect(sniffKind(ascii('%!PS-Adobe-3.0 EPSF'), 'eps')).toBe('postscript');
    expect(sniffKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'png')).toBe('png');
    expect(sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0), 'jpg')).toBe('jpeg');
    expect(sniffKind(ascii('GIF89a......'), 'gif')).toBe('gif');
    expect(sniffKind(ascii('RIFF\0\0\0\0WEBPVP8 '), 'webp')).toBe('webp');
    expect(sniffKind(bytes(0x49, 0x49, 0x2a, 0x00), 'tif')).toBe('tiff');
    expect(sniffKind(ascii('8BPS'), 'psd')).toBe('psd');
    expect(sniffKind(zip, 'docx')).toBe('zip');
    expect(sniffKind(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), 'doc')).toBe('ole');
    expect(sniffKind(ascii('{\\rtf1\\ansi'), 'rtf')).toBe('rtf');
    expect(sniffKind(ascii('\0\0\0\x18ftypmp42'), 'mp4')).toBe('isobmff');
    expect(sniffKind(ascii('ID3\x04'), 'mp3')).toBe('mp3');
    expect(sniffKind(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'svg')).toBe('svg');
    expect(sniffKind(ascii('név;összeg\nA;1'), 'csv')).toBe('text');
    // Markup is never "text", invalid UTF-8 and NULs are nothing.
    expect(sniffKind(ascii('<!doctype html><script>'), 'txt')).toBeNull();
    expect(sniffKind(ascii('<html>'), 'md')).toBeNull();
    expect(sniffKind(new Uint8Array([0x61, 0x00, 0x62]), 'txt')).toBeNull();
    expect(sniffKind(new Uint8Array([0xc3, 0x28]), 'txt')).toBeNull();
    expect(sniffKind(ascii('MZ\x90\0'), 'exe')).toBeNull();
  });

  test('an upload needs an allowed extension AND matching content', () => {
    expect(checkUploadable('Árajánlat.pdf', ascii('%PDF-1.4'))).toEqual({ ok: true, kind: 'pdf' });
    expect(checkUploadable('brand.zip', zip)).toEqual({ ok: true, kind: 'zip' });
    expect(checkUploadable('Logo.AI', ascii('%PDF-1.5'))).toEqual({ ok: true, kind: 'pdf' });
    for (const [name, head] of [
      ['invoice.pdf', ascii('<html><script>alert(1)</script>')],   // disguised
      ['report.docx', ascii('%PDF-1.4')],                           // the wrong real type
      ['logo.svg', ascii('plain words')],
      ['setup.exe', ascii('MZ')],
      ['page.html', ascii('<!doctype html>')],
      ['README', ascii('hello')],
      ['archive.rar', ascii('Rar!')],
    ] as [string, Uint8Array][]) {
      const v = checkUploadable(name, head);
      expect(v.ok, name).toBe(false);
      if (!v.ok) expect(v.reason, name).toMatch(/^[A-Z.].*\.$/);
    }
  });

  test('previews: images, text, PDF, .docx and .xlsx — when name and bytes agree; never SVG or HTML', () => {
    expect(sniffPreview(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'x.png')).toEqual({ kind: 'image', mime: 'image/png' });
    expect(sniffPreview(bytes(0xff, 0xd8, 0xff, 0xe0), 'x.jpg')).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(sniffPreview(ascii('Első sor'), 'notes.txt')).toEqual({ kind: 'text' });
    // PDF is drawn by PDF.js onto canvases; .docx/.xlsx are ZIPs rebuilt as text (FileViewer.tsx).
    expect(sniffPreview(ascii('%PDF-1.7'), 'a.pdf')).toEqual({ kind: 'pdf' });
    expect(sniffPreview(bytes(0x50, 0x4b, 0x03, 0x04), 'offer.docx')).toEqual({ kind: 'docx' });
    expect(sniffPreview(bytes(0x50, 0x4b, 0x03, 0x04), 'prices.xlsx')).toEqual({ kind: 'xlsx' });
    // The name and the bytes must agree.
    expect(sniffPreview(ascii('%PDF-1.7'), 'a.docx')).toBeNull();
    expect(sniffPreview(bytes(0x50, 0x4b, 0x03, 0x04), 'a.pdf')).toBeNull();
    expect(sniffPreview(bytes(0x50, 0x4b, 0x03, 0x04), 'a.zip')).toBeNull();
    // Old binary Office files are not opened.
    expect(sniffPreview(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), 'old.doc')).toBeNull();
    expect(sniffPreview(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.svg')).toBeNull();
    expect(sniffPreview(ascii('<html><script>'), 'x.png')).toBeNull();
    expect(sniffPreview(ascii('<html>'), 'notes.txt')).toBeNull();
    expect(mayPreview({ name: 'a.PNG', byte_size: 10 })).toBe(true);
    for (const name of ['a.svg', 'a.zip', 'a.html', 'a.doc', 'a.xls', 'a.pptx']) expect(mayPreview({ name, byte_size: 10 }), name).toBe(false);
    for (const name of ['a.pdf', 'a.docx', 'a.xlsx']) expect(mayPreview({ name, byte_size: 10 }), name).toBe(true);
    expect(mayPreview({ name: 'a.png', byte_size: 30 * 1024 * 1024 })).toBe(false);
  });

  test('nothing active is put into the Portal page, nothing is unpacked, nothing is framed', () => {
    const ui = ['features/documents/ProjectLibrary.tsx', 'features/documents/ProjectFacts.tsx', 'pages/documents.tsx', 'lib/documents.ts']
      .map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(ui).not.toMatch(/dangerouslySetInnerHTML|innerHTML|<iframe|<object|<embed|srcdoc|DOMParser/);
    expect(ui).not.toMatch(/unzip|jszip|fflate|DecompressionStream|zip\.js/i);
    // The CSP was not loosened for this library.
    const csp = read('netlify.toml');
    expect(csp).not.toMatch(/frame-src/);
    expect(csp).toMatch(/object-src 'none'/);
    // Exactly three document-rendering libraries, for opening files without
    // downloading them — and nothing that unpacks archives for the Portal.
    const deps = JSON.parse(read('portal', 'package.json')).dependencies as Record<string, string>;
    expect(Object.keys(deps).filter((d) => /zip|pdf|office|docx|xlsx|excel|mammoth/i.test(d)).sort())
      .toEqual(['mammoth', 'pdfjs-dist', 'read-excel-file']);
  });

  test('the file viewer renders without running anything from the file', () => {
    const viewer = fs.readFileSync(path.join(SRC, 'features', 'documents', 'FileViewer.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No markup is inserted and nothing is framed: the .docx is PARSED (an inert
    // document) and rebuilt from an allow-list as React elements.
    expect(viewer).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|<iframe|<object|<embed|srcdoc/);
    expect(viewer).toMatch(/new DOMParser\(\)\.parseFromString\(html, 'text\/html'\)/);
    // PDF.js never evaluates code from a file, and XFA forms are off.
    expect(viewer).toMatch(/isEvalSupported: false/);
    expect(viewer).toMatch(/enableXfa: false/);
    // Only embedded raster images survive from a .docx; links lose their target.
    expect(viewer).toMatch(/SAFE_IMAGE = \/\^data:image\\\/\(png\|jpeg\|gif\|webp\);base64,/);
    expect(viewer).toMatch(/if \(tag === 'a'\) return createElement\('span'/);
    // The three libraries load only when a file is opened.
    for (const lib of ['pdfjs-dist', 'mammoth', 'read-excel-file']) {
      expect(viewer, lib).not.toMatch(new RegExp(`^import[^\\n]*'${lib}`, 'm'));
      expect(viewer, lib).toMatch(new RegExp(`await import\\('${lib}`));
    }
    // And no other file imports them.
    const others = ['features/documents/ProjectLibrary.tsx', 'features/client/ClientApp.tsx', 'lib/documents.ts', 'pages/documents.tsx']
      .map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(others).not.toMatch(/pdfjs-dist|mammoth|read-excel-file/);
  });
});

test.describe('names and paths', () => {
  test('a browser file name is made sendable', () => {
    expect(cleanFileName('a/b\\c.pdf')).toBe('a_b_c.pdf');
    expect(cleanFileName('bad\u0000name.txt')).toBe('bad_name.txt');
    expect(cleanFileName('  ')).toBe('file');
    expect(cleanFileName('..')).toBe('file');
    expect(cleanFileName('Árajánlat (végleges).pdf')).toBe('Árajánlat (végleges).pdf');
  });

  test('a search term cannot become a wildcard', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  test('folder paths walk up to the project, and a bad cycle cannot hang the screen', () => {
    const f = (id: string, parent: string | null): DocFolder => ({
      id, parent_id: parent, project_id: 'p', name: id.toUpperCase(), created_at: '', trashed_at: null, trashed_with: null,
    });
    expect(folderPath([f('a', null), f('b', 'a'), f('c', 'b')], 'c').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(folderPath([f('a', 'b'), f('b', 'a')], 'a').length).toBe(2);
    expect(folderPath([], null)).toEqual([]);
  });

  test('the limits match the database', () => {
    const migration = read('supabase', 'migrations', '20260930000100_document_library.sql');
    expect(migration).toContain(`select ${MAX_DOCUMENT_BYTES}::bigint`);
    expect(formatBytes(MAX_DOCUMENT_BYTES)).toBe('50 MB');
    expect(DOWNLOAD_URL_SECONDS).toBeLessThanOrEqual(60);
    // The key is generated from ids; no name is ever part of it.
    expect(migration).toMatch(/storage_path\s+text generated always as \(project_id::text \|\| '\/' \|\| id::text\) stored/);
    expect(migration).toMatch(/values \(document_bucket\(\), document_bucket\(\), false,/);
  });

  test('refusals are sentences, never raw database text', () => {
    for (const e of [{ code: '23505' }, { code: '42501' }, { message: 'stratos:document_folder_cycle' }, { code: 'XX000', message: 'boom' }]) {
      const s = documentRefusal(e);
      expect(s).toMatch(/^[A-Z].*\.$/);
      expect(s).not.toMatch(/stratos:|violates|constraint/);
    }
  });
});

test.describe('who sees the library', () => {
  test('view_documents is an owner capability, not a role one', () => {
    expect(OWNER_CAPABILITIES).toContain('view_documents');
    expect(canAccess({ role: 'super_admin', is_owner: true }, 'view_documents')).toBe(true);
    for (const role of ['super_admin', 'admin', 'team_member', 'client'] as const) {
      expect(canAccess({ role, is_owner: false }, 'view_documents'), role).toBe(false);
    }
    // A named owner delegate is an admin whom is_owner() answers for.
    expect(canAccess({ role: 'admin', is_owner: true }, 'view_documents')).toBe(true);
    expect(canAccess({ role: 'team_member', is_owner: true }, 'view_documents')).toBe(false);
  });

  test('both routes are guarded, and the project screen draws the panel only for the capability', () => {
    const app = read('portal', 'src', 'App.tsx');
    expect(app).toMatch(/path="documents" element=\{\s*<ProtectedRoute capability="view_documents">/);
    expect(app).toMatch(/path="documents\/:id" element=\{\s*<ProtectedRoute capability="view_documents">/);
    expect(read('portal', 'src', 'pages', 'projects.tsx')).toMatch(/canAccess\(profile, 'view_documents'\) && \(\s*<div[^>]*>\s*<ProjectLibrary/);
  });

  test('no server function touches documents, and none receives a file', () => {
    const dir = path.join(ROOT, 'netlify', 'functions');
    for (const f of fs.readdirSync(dir).filter((n) => !/ \d+\./.test(n))) {
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(body, f).not.toMatch(/project[-_]documents|document_folders|\.storage\b|multipart/);
    }
  });
});

test.describe('signed URLs', () => {
  const lib = fs.readFileSync(path.join(SRC, 'lib', 'documents.ts'), 'utf8');
  const ui = [
    fs.readFileSync(path.join(SRC, 'features', 'documents', 'ProjectLibrary.tsx'), 'utf8'),
    fs.readFileSync(path.join(SRC, 'pages', 'documents.tsx'), 'utf8'),
  ].join('\n');

  test('downloads use the one-minute constant and ask for an attachment', () => {
    const calls = [...lib.matchAll(/createSignedUrl\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('DOWNLOAD_URL_SECONDS');
    // Still an attachment from Storage…
    expect(calls[0]).toContain('{ download: true }');
    // …and saved by the page under the real name, from bytes typed so that no
    // browser renders them (Storage double-encodes non-ASCII download names).
    const fn = lib.slice(lib.indexOf('export async function downloadDocument'), lib.indexOf('/** The bytes, as the owner, for a preview.'));
    expect(fn).toContain("new Blob([await res.arrayBuffer()], { type: 'application/octet-stream' })");
    expect(fn).toContain('a.download = doc.name;');
    expect(fn).toContain('URL.revokeObjectURL(url)');
    expect(fn).not.toMatch(/window\.open|iframe|location\.href/);
  });

  test('never upsert, never logged, never kept', () => {
    expect(lib).not.toMatch(/upsert:\s*true|'x-upsert', 'true'/);
    expect(lib).toContain("xhr.setRequestHeader('x-upsert', 'false')");
    // Every console call in the library passes a label and a code — never the URL or the data.
    for (const m of lib.matchAll(/console\.(?:log|info|warn|error)\(([^;]*)\);/g)) {
      expect(m[1], m[0]).not.toMatch(/signed|url|token|data\b(?!\?)/i);
    }
    // Signed URLs are not put in React state or storage.
    expect(lib + ui).not.toMatch(/set\w*\([^)]*signed/i);
    expect(lib + ui).not.toMatch(/localStorage|sessionStorage/);
  });

  test('uploads go straight to Storage as octet-stream', () => {
    expect(lib).toContain("xhr.setRequestHeader('content-type', 'application/octet-stream')");
    expect(lib).toMatch(/createSignedUploadUrl\(path\)/);
    expect(lib).not.toMatch(/\/api\/|\.netlify\/functions/);
  });
});

test.describe('public key vs secret key', () => {
  const samples: [string, 'missing' | 'public' | 'secret' | 'unknown'][] = [
    ['', 'missing'],
    [jwt({ iss: 'supabase', role: 'anon' }), 'public'],
    [jwt({ iss: 'supabase', role: SERVER_ROLE }), 'secret'],
    [jwt({ iss: 'supabase', role: 'authenticated' }), 'secret'],
    [`eyJ${'x'.repeat(20)}.not-json-${'y'.repeat(12)}.${'z'.repeat(12)}`, 'secret'],
    [`sb_publishable_${'a'.repeat(24)}`, 'public'],
    [`sb_${'secret'}_${'a'.repeat(24)}`, 'secret'],
    ['mock-anon-key-not-shaped-like-one', 'unknown'],
  ];

  test('the build, the scanner and the browser classify every sample the same way', () => {
    for (const [key, kind] of samples) {
      expect(supabaseKeyKind(key), key.slice(0, 20)).toBe(kind);
      expect(keyKind(key), key.slice(0, 20)).toBe(kind);
    }
  });

  test('the scanner lets the anon JWT through and still catches every other JWT', () => {
    const scan = read('scripts', 'secret-scan.mjs');
    expect(scan).toMatch(/import \{ supabaseKeyKind \} from '\.\/supabase-key-kind\.mjs'/);
    expect(scan).toMatch(/isPublic: \(match\) => supabaseKeyKind\(match\) === 'public'/);
    expect(scan).toMatch(/every\(\(m\) => rule\.isPublic\(m\[0\]\)\)/);
  });

  test('the Portal build refuses a secret key and does not print it', () => {
    const secret = jwt({ iss: 'supabase', role: SERVER_ROLE, ref: 'unit-test' });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stratos-secret-build-'));
    const run = spawnSync('npx', ['vite', 'build', '--outDir', out], {
      cwd: path.join(ROOT, 'portal'),
      env: { ...process.env, VITE_SUPABASE_URL: 'https://mock.supabase.invalid', VITE_SUPABASE_ANON_KEY: secret },
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain('VITE_SUPABASE_ANON_KEY holds a Supabase SECRET key');
    expect(`${run.stdout}${run.stderr}`).not.toContain(secret.split('.')[1]);
    expect(fs.readdirSync(out)).toEqual([]);
  });
});
