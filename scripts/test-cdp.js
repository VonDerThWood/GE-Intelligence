// Runs JavaScript inside a GEnius test-mode window and prints the result.
//
//   npm run test-mode                      (separate instance, own data copy)
//   node scripts/test-cdp.js file.js       evaluate file.js in the renderer
//   node scripts/test-cdp.js -e "expr"     evaluate an inline expression
//
// The page exposes window.__geniusTest in test mode only:
//   goto(tabId), openItem(name), click(buttonText), state(), text(), tabs()
// Console errors/warnings and uncaught exceptions raised while the code runs
// are printed after the result. Close the test instance when finished:
//   node scripts/test-cdp.js -e "window.genius.quitApp()"
const fs = require('fs');
const PORT = process.env.GENIUS_CDP_PORT || 9333;

(async () => {
  const expr = process.argv[2] === '-e' ? process.argv[3] : fs.readFileSync(process.argv[2], 'utf8');
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('No GEnius page found — is test mode running?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown')
      logs.push('EXCEPTION: ' + m.params.exceptionDetails.exception?.description);
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const res = r.result;
  console.log(JSON.stringify(res.result?.value ?? res.exceptionDetails?.exception?.description ?? res.result, null, 1));
  await new Promise(r => setTimeout(r, 500));
  if (logs.length) console.log('CONSOLE:\n' + logs.join('\n'));
  process.exit(0);
})().catch(e => { console.log('CDP ERROR:', e.message); process.exit(1); });
