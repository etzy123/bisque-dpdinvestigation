const crypto = require('crypto');
const config = require('./config');

const API = 'https://api.helpscout.net/v2';
let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.helpscout.appId,
      client_secret: config.helpscout.appSecret,
    }),
  });
  if (!res.ok) throw new Error(`Help Scout token mislukt: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

async function hs(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Help Scout ${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function verifySignature(rawBody, signature) {
  if (!config.helpscout.webhookSecret || !signature) return false;
  const expected = crypto
    .createHmac('sha1', config.helpscout.webhookSecret)
    .update(rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const getConversation = (id) => hs(`/conversations/${id}?embed=threads`);

async function getAttachment(conversationId, attachmentId) {
  const json = await hs(`/conversations/${conversationId}/attachments/${attachmentId}/data`);
  return Buffer.from(json.data, 'base64');
}

const addNote = (id, text) => hs(`/conversations/${id}/notes`, { method: 'POST', body: { text } });

const setTags = (id, tags) => hs(`/conversations/${id}/tags`, { method: 'PUT', body: { tags } });

const setStatus = (id, status) =>
  hs(`/conversations/${id}`, { method: 'PATCH', body: { op: 'replace', path: '/status', value: status } });

module.exports = { verifySignature, getConversation, getAttachment, addNote, setTags, setStatus };
