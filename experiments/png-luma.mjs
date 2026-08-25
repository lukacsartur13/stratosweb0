// A minimal PNG reader, for measuring what a capture actually contains.
//
// Playwright screenshots are PNGs and the page's own WebGL canvas cannot be read
// back (`preserveDrawingBuffer` is false, which is the correct setting for a
// renderer that is not meant to be photographed sixty times a second). So the
// measurement is taken off the file rather than off the context: decode the
// screenshot, convert to luminance, and answer questions about the distribution.
//
// Supports the two colour types Chromium emits — 8-bit RGB and RGBA, no
// interlace — and refuses anything else rather than returning a plausible wrong
// answer.
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

export function luminance(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);

  let off = 8;
  let w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8];
      colour = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
    throw new Error(`${path}: unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
  }

  const bpp = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);

  // Undo the per-scanline filters. The five are the whole of the PNG spec's
  // compression pre-pass and each one is defined against the pixel to the left
  // and the scanline above.
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }

  const lum = new Float64Array(w * h);
  for (let i = 0, p = 0; i < out.length; i += bpp, p++) {
    lum[p] = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
  }
  return { width: w, height: h, lum };
}

/** The distribution questions §25 and §53 ask about the instrument. */
export function stats(path) {
  const { lum } = luminance(path);
  const s = Array.from(lum).sort((a, b) => a - b);
  const q = (p) => Math.round(s[Math.floor(p * (s.length - 1))] * 10) / 10;
  const p05 = q(0.05), p99 = q(0.99);
  return {
    p05, p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99, max: q(1),
    spread: Math.round((p99 - p05) * 10) / 10,
    /** How much of the crop carries modelling rather than being flat field. */
    ink: Math.round((s.filter((v) => v > p05 + 4).length / s.length) * 1000) / 10,
    /** Anything this bright on a black object is a blown highlight. */
    blown: s.filter((v) => v > 235).length,
  };
}
