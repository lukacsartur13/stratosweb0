import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { downloadDocument, type UploadApi, type UploadText } from '@/lib/documents';
import { MAX_DOCUMENT_BYTES, formatBytes } from '@/lib/documentRules';
import { t } from '@/lib/i18n';

/**
 * THE CLIENT PORTAL — data.
 *
 * A client reads nothing but the `client_portal_*` functions
 * (20261001000100_client_portal.sql). Each returns a fixed set of columns — a
 * project's id and name, a shared document's name/size/date, the client's own
 * uploads — and re-checks the caller's CURRENT assignment on every call. No
 * table is ever queried from here: there is nothing on this side to hide.
 *
 * Uploads run the library's own lifecycle (`useUploader`) through the client's
 * functions, with the same types, the same 50 MB limit and the same direct,
 * signed, non-overwriting upload to the private bucket.
 */

export interface ClientProject { project_id: string; project_name: string }
export interface SharedDocument {
  document_id: string; project_id: string; project_name: string; name: string; byte_size: number;
  shared_at: string; via_folder: string | null;
}
export interface ClientUpload {
  document_id: string; project_id: string; project_name: string; name: string; byte_size: number;
  uploaded_at: string; state: 'pending' | 'ready' | 'failed'; failure_reason: string | null;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

export function useRpc<T>(fn: string, reloadToken: number) {
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const { data, error } = await supabase.rpc(fn);
    if (error) { console.error(`[client.${fn}]`, error.code); setState('error'); return; }
    setRows((data ?? []) as T[]);
    setState('ready');
  }, [fn, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

export const useClientMe = (t = 0) => useRpc<{ full_name: string; company: string }>('client_portal_me', t);
export const useClientProjects = (t = 0) => useRpc<ClientProject>('client_portal_projects', t);
export const useSharedDocuments = (t = 0) => useRpc<SharedDocument>('client_portal_documents', t);
export const useClientUploads = (t = 0) => useRpc<ClientUpload>('client_portal_uploads', t);

/** A one-minute attachment link, as for the owner. The key is derivable from the two ids the client already has. */
export async function downloadShared(d: Pick<SharedDocument, 'project_id' | 'document_id' | 'name'>) {
  const problem = await downloadDocument({ storage_path: `${d.project_id}/${d.document_id}`, name: d.name });
  return problem ? t('A letöltés nem indult el. Lehet, hogy a megosztás időközben megszűnt — frissítsd az oldalt.') : null;
}

/* ============================================================ uploads == */

export const CLIENT_UPLOAD_API: UploadApi = {
  async begin(a) {
    const { data, error } = await supabase.rpc('client_begin_upload', {
      p_project: a.projectId, p_name: a.name, p_size: a.size, p_type: a.type, p_kind: a.kind,
    });
    return { row: (data as { id: string; name: string; storage_path: string }[] | null)?.[0] ?? null, error };
  },
  async finish(id) {
    const { data, error } = await supabase.rpc('client_finish_upload', { p_id: id });
    if (error) { console.error('[client.finish]', error.code); return 'error'; }
    return data as 'ready' | 'missing' | 'failed';
  },
  async reason(id) {
    const { data } = await supabase.rpc('client_portal_uploads');
    return ((data ?? []) as ClientUpload[]).find((u) => u.document_id === id)?.failure_reason ?? null;
  },
  async mark(id, state, reason) {
    const { error } = await supabase.rpc('client_mark_upload', { p_id: id, p_state: state, p_reason: reason ?? null });
    if (error) console.error('[client.mark]', error.code);
  },
};

const HU_FAILURE: Record<string, string> = {
  network: 'Megszakadt a kapcsolat a feltöltés közben.',
  cancelled: 'A feltöltést megszakítottad.',
  expired: 'A feltöltés nem fejeződött be.',
  too_large: 'A fájl nagyobb, mint {max}.',
  size_mismatch: 'A beérkezett fájl mérete nem egyezik az elküldöttel. Töltsd fel újra.',
  storage_refused: 'A tárhely nem fogadta el a fájlt.',
  access_revoked: 'Ehhez a projekthez már nincs hozzáférésed, ezért a fájl nem került be.',
};
// Kept in Hungarian (module level); translated where read.
const failureText = (text: string) => t(text, { max: formatBytes(MAX_DOCUMENT_BYTES) });
export const failureHu = (reason: string | null) => failureText(HU_FAILURE[reason ?? ''] ?? HU_FAILURE.storage_refused);

export const CLIENT_UPLOAD_TEXT: UploadText = {
  refusal(error) {
    const m = error?.message ?? '';
    if (/document_too_large/.test(m)) return failureText(HU_FAILURE.too_large);
    if (/document_type_not_allowed/.test(m)) return t('Ez a fájltípus nem tölthető fel, vagy a tartalma nem egyezik a kiterjesztésével.');
    if (/client_upload_limit/.test(m)) return t('Elérted a feltöltési korlátot. Várd meg a folyamatban lévőket, vagy próbáld újra később.');
    if (/client_no_access/.test(m) || error?.code === '42501') return t('Ehhez a projekthez már nincs hozzáférésed.');
    return t('A feltöltés nem sikerült. Próbáld újra.');
  },
  failure: failureHu,
  typeRefused: (v) => (v.code === 'extension'
    ? (v.ext ? t('.{ext} típusú fájl nem tölthető fel.', { ext: v.ext }) : t('Kiterjesztés nélküli fájl nem tölthető fel.'))
    : t('A fájl tartalma nem egyezik a .{ext} kiterjesztéssel, ezért nem töltöttük fel.', { ext: v.ext })),
  // Getters: read at upload time, after the language is set.
  get unconfirmed() { return t('A fájl elküldve, de a visszaigazolás nem érkezett meg. Próbáld újra az ellenőrzéshez.'); },
  get unexpected() { return t('A feltöltés váratlanul megszakadt. Próbáld újra.'); },
};

export const CLIENT_ALLOWED_SUMMARY = 'PDF, Word/Excel/PowerPoint, szöveg és CSV, képek (PNG, JPG, GIF, WebP, TIFF, HEIC, SVG), '
  + 'PSD/AI/EPS, MP4/MOV/MP3, ZIP';

export const UPLOAD_STATE_HU: Record<ClientUpload['state'], string> = {
  pending: 'Folyamatban', ready: 'Leadva', failed: 'Sikertelen',
};
