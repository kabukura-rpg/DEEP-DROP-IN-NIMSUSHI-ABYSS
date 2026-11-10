// serve.mjs <dist> <port> [<dist> <port> ...]: serves untouched builds under the Pages base path, loopback only.
// Nothing is injected: the review builds carry their own fixture (build-review.mjs); production builds are as built.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = '/DEEP-DROP-IN-NIMSUSHI-ABYSS/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ogg': 'audio/ogg' };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const dist = path.resolve(args[i]), port = Number(args[i + 1]);
  http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/build.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ label: path.basename(dist), port }));
      if (!pathname.startsWith(base)) throw Error('outside base');
      const rel = pathname.slice(base.length);
      const file = path.resolve(dist, !rel || rel.endsWith('/') ? rel + 'index.html' : rel);
      if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(await fs.readFile(file));
    } catch { res.writeHead(404).end('File unavailable'); }
  }).listen(port, '127.0.0.1', () => console.log(`${path.basename(dist)} http://127.0.0.1:${port}${base}`));
}
