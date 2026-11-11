/**
 * google-auth.js: "Sign in with Google" for the desktop app, for Google Drive
 * sync (Ben, 2026-11-10). Main process only.
 *
 * Google's recommended flow for desktop apps: the browser opens Google's own
 * sign-in page, which sends the user back to a one-time local address
 * (http://127.0.0.1:<random port>) that this file listens on. PKCE protects the
 * exchange. GEnius never sees the password.
 *
 * Scope is drive.file: GEnius can only see files it created itself (its one sync
 * file), not the rest of the user's Drive. Plus "email", to show which account.
 *
 * The OAuth client (from Ben's Google Cloud project, see GOOGLE_DRIVE_SETUP.md)
 * lives in google-oauth.json next to the app data. For a desktop client Google
 * says the "secret" is not treated as secret. The refresh token is encrypted with
 * Windows' own protection (Electron safeStorage) before it's stored.
 */
const http = require('http');
const crypto = require('crypto');

const SCOPES = 'https://www.googleapis.com/auth/drive.file email';
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createGoogleAuth({ store, readConfig, openExternal, safeStorage }) {
  let access = null; // { token, expires }

  const config = () => { try { const c = readConfig(); return c && c.client_id ? c : null; } catch { return null; } };
  const saveRefresh = t => {
    const enc = safeStorage?.isEncryptionAvailable?.() ? { enc: true, v: safeStorage.encryptString(t).toString('base64') } : { enc: false, v: t };
    store.set('googleRefresh', enc);
  };
  const loadRefresh = () => {
    const r = store.get('googleRefresh', null);
    if (!r) return null;
    try { return r.enc ? safeStorage.decryptString(Buffer.from(r.v, 'base64')) : r.v; } catch { return null; }
  };

  async function tokenRequest(params) {
    const c = config();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), ...params }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.error || `Google sign-in failed (${res.status})`);
    return j;
  }

  // Opens the browser and waits (up to 5 minutes) for Google to send the user back.
  async function connect() {
    if (!config()) return { error: 'not_configured' };
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let server, timer;
    const code = await new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const okState = u.searchParams.get('state') === state;
        const err = u.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;background:#1a1209;color:#e8d5a3;text-align:center;padding-top:20vh">
          <h2>${err || !okState ? 'GEnius was not connected' : 'Signed in'}</h2><p>${err || !okState ? 'Go back to GEnius and try again.' : 'You can close this tab. GEnius is finishing the connection.'}</p></body></html>`);
        if (!okState) return reject(new Error('Sign-in check failed, try again'));
        if (err) return reject(new Error(err === 'access_denied' ? 'Sign-in was cancelled' : err));
        resolve(u.searchParams.get('code'));
      });
      server.listen(0, '127.0.0.1', () => {
        const redirect = `http://127.0.0.1:${server.address().port}`;
        server.redirect = redirect;
        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
          client_id: config().client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPES,
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        });
        openExternal(url);
      });
      timer = setTimeout(() => reject(new Error('Timed out waiting for Google sign-in')), 5 * 60 * 1000);
    }).finally(() => { clearTimeout(timer); setTimeout(() => server?.close(), 1000); });
    const t = await tokenRequest({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: server.redirect });
    if (!t.refresh_token) throw new Error('Google did not grant offline access; try again');
    saveRefresh(t.refresh_token);
    access = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
    let email = null;
    try { email = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64').toString()).email || null; } catch {}
    if (!email) {
      try { email = (await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json()).email || null; } catch {}
    }
    store.set('googleEmail', email);
    return { success: true, email };
  }

  async function getToken() {
    if (access && Date.now() < access.expires) return access.token;
    const refresh = loadRefresh();
    if (!refresh) throw new Error('Not connected to Google Drive');
    const t = await tokenRequest({ refresh_token: refresh, grant_type: 'refresh_token' });
    access = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
    return access.token;
  }

  async function disconnect() {
    const refresh = loadRefresh();
    if (refresh) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(refresh), { method: 'POST', signal: AbortSignal.timeout(10000) }); } catch {} }
    store.set('googleRefresh', null); store.set('googleEmail', null); store.set('cloudSyncFileId', null);
    access = null;
    return { success: true };
  }

  const status = () => ({ configured: !!config(), connected: !!loadRefresh(), email: store.get('googleEmail', null) });
  return { connect, getToken, disconnect, status };
}

module.exports = { createGoogleAuth };
