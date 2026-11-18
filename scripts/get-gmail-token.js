// Eenmalig lokaal draaien om een refresh token voor support@bisquegolf.com te krijgen.
// Gebruik: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-gmail-token.js
// De OAuth-client moet van het type "Desktop app" zijn.
const http = require('http');
const { execSync } = require('child_process');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Zet eerst GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET.');
  process.exit(1);
}
const port = 5555;
const redirect = `http://localhost:${port}/callback`;
const url =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    login_hint: 'support@bisquegolf.com',
  });

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, redirect);
    if (u.pathname !== '/callback') return res.end();
    const code = u.searchParams.get('code');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const json = await r.json();
    res.end('Klaar, je kunt dit venster sluiten.');
    console.log('\nGOOGLE_REFRESH_TOKEN=' + json.refresh_token + '\n');
    process.exit(0);
  })
  .listen(port, () => {
    console.log('Log in als support@bisquegolf.com via:\n' + url);
    try { execSync(`open "${url}"`); } catch {}
  });
