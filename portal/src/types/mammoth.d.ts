// mammoth ships no types. Only what features/documents/FileViewer.tsx uses.
declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}
