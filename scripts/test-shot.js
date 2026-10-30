// Screenshot part of a GEnius test-mode window, cropped to one element.
//
//   node scripts/test-shot.js out.png "<js expression returning an Element>"
//
// e.g. node scripts/test-shot.js cal.png "document.querySelector('.content')"
// The expression is evaluated in the page; the shot is clipped to that
// element's bounding box (plus a small margin) and scrolled into view.
const fs = require('fs');
const PORT = process.env.GENIUS_CDP_PORT || 9333;

(async () => {
  const [out, expr] = process.argv.slice(2);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const el = await (${expr});
    if (!el) return null;
    el.scrollIntoView({block: 'start'});
    await new Promise(r => setTimeout(r, 300));
    const b = el.getBoundingClientRect();
    return { x: Math.max(0, b.x - 6), y: Math.max(0, b.y - 6), width: Math.min(b.width + 12, innerWidth), height: Math.min(b.height + 12, innerHeight - Math.max(0, b.y - 6)) };
  })()` });
  const clip = r.result.result.value;
  if (!clip) { console.log('Element not found'); process.exit(1); }
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out, Math.round(clip.width) + 'x' + Math.round(clip.height));
  process.exit(0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
