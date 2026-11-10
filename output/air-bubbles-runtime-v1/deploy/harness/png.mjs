// Minimal PNG (8-bit RGB/RGBA, non-interlaced, as Chrome writes them) decode + mask diff. No dependencies.
import zlib from 'node:zlib';
export function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw Error('not a png');
  let o = 8, w, h, depth, type, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw Error('interlaced'); }
    if (kind === 'IDAT') idat.push(data);
    if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || (type !== 6 && type !== 2)) throw Error(`unsupported png ${depth}/${type}`);
  const bpp = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const out = Buffer.alloc(w * h * 4), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = cur[x * bpp]; out[(y * w + x) * 4 + 1] = cur[x * bpp + 1]; out[(y * w + x) * 4 + 2] = cur[x * bpp + 2]; out[(y * w + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    cur.copy(prev);
  }
  return { width: w, height: h, data: out };
}
/** masks: [x0, y0, x1, y1) rectangles in this image's pixels; returns changed / outside counts, bounds and max channel delta. */
export function diff(a, b, masks = []) {
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: true };
  let changed = 0, outside = 0, inside = 0, maxDelta = 0; const bounds = [a.width, a.height, -1, -1], outBounds = [a.width, a.height, -1, -1];
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]));
    if (!d) continue;
    changed++;
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
    if (masks.some(m => typeof m === 'function' ? m(x, y) : x >= m[0] && x < m[2] && y >= m[1] && y < m[3])) { inside++; continue; }
    outside++; maxDelta = Math.max(maxDelta, d);
    outBounds[0] = Math.min(outBounds[0], x); outBounds[1] = Math.min(outBounds[1], y); outBounds[2] = Math.max(outBounds[2], x); outBounds[3] = Math.max(outBounds[3], y);
  }
  return { changed, inside, outside, outsideMaxDelta: maxDelta, bounds: changed ? bounds : null, outsideBounds: outside ? outBounds : null };
}
/** Raw RGBA crop + nearest scale into a new PNG (for review sheets). */
export function encode(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const chunk = (kind, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
