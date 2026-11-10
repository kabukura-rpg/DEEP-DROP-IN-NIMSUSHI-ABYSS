// Minimal CDP helper shared by the capture scripts.
export async function connect(port = 9341) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let serial = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    if (d.id) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(d.error) : p.resolve(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? JSON.stringify(d.params));
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = async expression => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async (expression, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = await ev(expression).catch(() => null); if (v) return v; await sleep(50); }
    throw Error('Timed out: ' + expression + ' ' + JSON.stringify(errors));
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  return { ws, cdp, ev, until, sleep, errors };
}
