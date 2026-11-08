// Local review art. Each character occupies 2 × 2 native pixels.
const patterns = {
  A: [
    '...rrrr...',
    '..r....r..',
    '.r.h....r.',
    'r.h......r',
    'r........r',
    'r........r',
    'r........r',
    '.r......r.',
    '..r....r..',
    '...rrrr...',
  ],
  B: [
    '...hhh...',
    '..hsshr..',
    '.hs....r.',
    'hs......r',
    'h.......r',
    'r.......r',
    'r......sr',
    '.r....sr.',
    '..rrrrr..',
    '...rrr...',
  ],
};

const palettes = {
  A: { r: [0x9fe8f5, 1], h: [0xf0ffff, 0.9] },
  B: { r: [0x2f728c, 1], s: [0x69dece, 0.96], h: [0xd3ffed, 1] },
};

// Coalesce same-color horizontal runs vertically. No array/object creation in the draw loop.
function compile(rows, palette) {
  const inks = [];
  for (const [symbol, [color, opacity]] of Object.entries(palette)) {
    const rects = [];
    const active = new Map();
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let left = 0; left < row.length;) {
        if (row[left] !== symbol) { left++; continue; }
        let right = left + 1;
        while (row[right] === symbol) right++;
        const key = left + ':' + right;
        const prev = active.get(key);
        if (prev && prev.y + prev.h === y * 2 - rows.length) prev.h += 2;
        else {
          const rect = { x: left * 2 - row.length, y: y * 2 - rows.length, w: (right - left) * 2, h: 2 };
          active.set(key, rect);
          rects.push(rect);
        }
        left = right;
      }
    }
    inks.push({ color, opacity, rects });
  }
  return inks;
}

const art = { A: compile(patterns.A, palettes.A), B: compile(patterns.B, palettes.B) };
export const rectCounts = Object.fromEntries(Object.entries(art).map(([key, inks]) => [
  key, inks.reduce((n, ink) => n + ink.rects.length, 0),
]));

export function drawAirReview(g, cx, cy, fade, variant) {
  const x = Math.round(cx + g.x) - g.x;
  const y = Math.round(cy + g.y) - g.y;
  const inks = art[variant];
  for (let i = 0; i < inks.length; i++) {
    const ink = inks[i];
    g.fillStyle(ink.color, ink.opacity * fade);
    for (let j = 0; j < ink.rects.length; j++) {
      const r = ink.rects[j];
      g.fillRect(x + r.x, y + r.y, r.w, r.h);
    }
  }
}
