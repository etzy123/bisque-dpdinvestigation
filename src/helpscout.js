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

async function hsRaw(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Help Scout ${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return { body: text ? JSON.parse(text) : null, headers: res.headers };
}

const hs = async (path, opts) => (await hsRaw(path, opts)).body;

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

const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (text) => escapeHtml(text).replace(/\n/g, '<br>');

// Help Scout weigert grote bijlagen; alles boven deze grens wordt overgeslagen
const MAX_HS_ATTACHMENT = 10 * 1024 * 1024;

// Stuurt de mail aan DPD als nieuw Help Scout-gesprek vanuit de support-mailbox.
// Stap 1: gesprek aanmaken met een interne notitie (verwijzing naar het klantgesprek).
// Stap 2: antwoord (reply) met tekst en bijlagen: dit is de mail die naar DPD gaat.
async function sendDpdEmail({ mailboxId, to, subject, text, attachments = [], tags = [], noteText, status = 'pending' }) {
  const created = await hsRaw('/conversations', {
    method: 'POST',
    body: {
      subject,
      type: 'email',
      mailboxId,
      status,
      customer: { email: to },
      tags,
      threads: [{ type: 'note', text: toHtml(noteText || subject) }],
    },
  });
  const id = Number(created.headers.get('resource-id'));
  const webUrl = created.headers.get('web-location');
  const conv = await hs(`/conversations/${id}`);
  const customerId = conv.primaryCustomer && conv.primaryCustomer.id;

  const used = attachments.filter((a) => a.content.length <= MAX_HS_ATTACHMENT);
  const skipped = attachments.filter((a) => a.content.length > MAX_HS_ATTACHMENT).map((a) => a.filename);

  await hs(`/conversations/${id}/reply`, {
    method: 'POST',
    body: {
      customer: customerId ? { id: customerId } : { email: to },
      text: toHtml(text),
      status,
      attachments: used.map((a) => ({
        fileName: a.filename,
        mimeType: a.contentType,
        data: a.content.toString('base64'),
      })),
    },
  });
  return { id, number: conv.number, webUrl, attached: used.length, skipped };
}

module.exports = { verifySignature, getConversation, getAttachment, addNote, setTags, setStatus, sendDpdEmail };
