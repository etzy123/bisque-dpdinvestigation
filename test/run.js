// Tests met nepdata (geen echte API's). Draai met: npm test
process.env.DRY_RUN = 'false';
process.env.HELPSCOUT_WEBHOOK_SECRET = 'geheim';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { processConversation, prepare } = require('../src/process');
const scenarios = require('../src/scenarios');
const helpscoutReal = require('../src/helpscout');
const { findOrderNumbers, findTrackingNumbers, parseNoteOverrides } = require('../src/parse');

const order = {
  name: '#38084',
  createdAt: '2026-10-11T10:00:00Z',
  email: 'klaus@example.de',
  shippingAddress: { name: 'Klaus Muster', address1: 'Hauptstrasse 1', zip: '10115', city: 'Berlin', country: 'Germany' },
  lineItems: { nodes: [
    { title: 'Malbon Buckets Polo', variantTitle: 'M / Navy', sku: 'MB-123', quantity: 1, discountedTotalSet: { shopMoney: { amount: '95.00', currencyCode: 'EUR' } } },
    { title: 'Titleist Pro V1', variantTitle: 'Default Title', sku: 'T-PV1', quantity: 1, discountedTotalSet: { shopMoney: { amount: '55.00', currencyCode: 'EUR' } } },
  ] },
  fulfillments: [{
    createdAt: '2026-10-12T14:00:00Z',
    trackingInfo: [{ number: '05165897255876', company: 'DPD', url: '' }],
    fulfillmentLineItems: { nodes: [
      { quantity: 1, lineItem: { title: 'Malbon Buckets Polo', variantTitle: 'M / Navy', sku: 'MB-123', quantity: 1, discountedTotalSet: { shopMoney: { amount: '105.00', currencyCode: 'EUR' } }, discountAllocations: [{ allocatedAmountSet: { shopMoney: { amount: '10.00' } } }] } },
      { quantity: 1, lineItem: { title: 'Titleist Pro V1', variantTitle: 'Default Title', sku: 'T-PV1', quantity: 2, discountedTotalSet: { shopMoney: { amount: '110.00', currencyCode: 'EUR' } }, discountAllocations: [] } },
    ] },
  }],
};

const shopify = {
  findOrderByName: async (n) => (n === '38084' ? order : null),
  findOrdersByEmail: async (e) => (e === order.email ? [order] : []),
  findOrderByTracking: async (t) => (t === '05165897255876' ? order : null),
};

function makeConv({ subject, customerBody, notes = [], tags, attachments = [] }) {
  return {
    id: 111, subject, primaryCustomer: { email: 'klaus@example.de' },
    tags: tags.map((t) => ({ tag: t })),
    _embedded: { threads: [
      { id: 1, type: 'customer', createdAt: '2026-11-15T09:00:00Z', body: customerBody, _embedded: { attachments } },
      ...notes.map((n, i) => ({ id: 10 + i, type: 'note', createdAt: '2026-11-16T09:00:00Z', body: n })),
    ] },
  };
}

function fakeHelpscout(conv, gm) {
  const log = { notes: [], tags: null, status: null };
  return {
    log,
    sendDpdEmail: async (m) => { gm && gm.sent.push(m); return { id: 999, number: 5000, webUrl: 'https://secure.helpscout.net/conversation/999/5000', attached: m.attachments.length, skipped: [] }; },
    getConversation: async () => conv,
    getAttachment: async () => Buffer.from('fakejpeg'),
    addNote: async (_id, t) => log.notes.push(t),
    setTags: async (_id, t) => { log.tags = t; },
    setStatus: async (_id, s) => { log.status = s; },
  };
}

const fakeGmail = () => ({ sent: [] });

(async () => {
  // Parser
  assert.deepStrictEqual(findTrackingNumbers('pakket 05165897255876 en 123'), ['05165897255876']);
  assert.deepStrictEqual(findOrderNumbers('Mijn order #38084 is niet aangekomen'), ['38084']);
  assert.deepStrictEqual(findOrderNumbers('Ordernummer: 38084'), ['38084']);
  const o = parseNoteOverrides(['DPD ontbreekt: zwarte broek\nDPD pakket: 05165897255209\nDPD order: #37308']);
  assert.strictEqual(o.tracking, '05165897255209'); assert.strictEqual(o.order, '37308'); assert.deepStrictEqual(o.missing, ['zwarte broek']);

  // 1. Niet ontvangen: order uit onderwerp
  {
    const conv = makeConv({ subject: 'Order #38084 niet ontvangen', customerBody: '<p>Hallo, ik heb mijn pakket nooit ontvangen.</p><p>Op 1 nov schreef Bisque:</p><blockquote>oud</blockquote>', tags: ['dpd-niet-ontvangen'] });
    const gm = fakeGmail(); const hs = fakeHelpscout(conv, gm);
    const r = await processConversation(111, { helpscout: hs, shopify });
    assert.strictEqual(r.tracking, '05165897255876');
    assert.strictEqual(gm.sent[0].to, 'customerservice@dpd.nl');
    assert.strictEqual(gm.sent[0].subject, '05165897255876');
    assert.match(gm.sent[0].text, /Totale waarde: € 150,00/);
    assert.match(gm.sent[0].text, /Verzonden op: 12-10-2026/);
    assert.ok(!gm.sent[0].text.includes('—'), 'geen em dash');
    assert.deepStrictEqual(hs.log.tags.sort(), ['dpd ticket', 'dpd-onderzoek-gestart', 'waiting on dpd']);
    assert.deepStrictEqual(gm.sent[0].tags, ['dpd-onderzoek', 'waiting on dpd']);
    assert.match(gm.sent[0].noteText, /Klantgesprek: https:\/\/secure\.helpscout\.net\/conversation\/111\//);
    assert.match(hs.log.notes[0], /conversation\/999\/5000/);
    assert.strictEqual(hs.log.status, 'pending');
    fs.writeFileSync(path.join(__dirname, 'voorbeeld-niet-ontvangen.txt'), gm.sent[0].text);
    fs.writeFileSync(path.join(__dirname, 'voorbeeld-orderoverzicht.pdf'), gm.sent[0].attachments[0].content);
  }

  // 2. Incompleet: geen ordernummer, wel e-mail en foto's, plus notitie
  {
    const conv = makeConv({ subject: 'Pakket open', customerBody: 'De doos was open en de polo ontbreekt.', notes: ['DPD ontbreekt: Malbon Buckets Polo M / Navy'], tags: ['dpd-incompleet', 'return'],
      attachments: [{ id: 5, filename: 'doos.jpg', mimeType: 'image/jpeg', size: 1000 }, { id: 6, filename: 'x.zip', mimeType: 'application/zip', size: 10 }] });
    const gm = fakeGmail(); const hs = fakeHelpscout(conv, gm);
    await processConversation(111, { helpscout: hs, shopify });
    const m = gm.sent[0];
    assert.match(m.text, /Volgens de ontvanger ontbreekt: Malbon Buckets Polo M \/ Navy/);
    assert.match(m.text, /1 foto van de ontvanger/);
    assert.strictEqual(m.attachments.length, 2);
    assert.ok(hs.log.tags.includes('return'));
    fs.writeFileSync(path.join(__dirname, 'voorbeeld-incompleet.txt'), m.text);
  }

  // 3. Pakketnummer in gesprek past niet bij order: niet versturen, notitie + fouttag
  {
    const conv = makeConv({ subject: 'Order #38084', customerBody: 'Tracking 05165897255999 zegt bezorgd', tags: ['dpd-niet-ontvangen'] });
    const gm = fakeGmail(); const hs = fakeHelpscout(conv, gm);
    const r = await processConversation(111, { helpscout: hs, shopify });
    assert.ok(r.error); assert.strictEqual(gm.sent.length, 0);
    assert.ok(hs.log.tags.includes('dpd-onderzoek-fout'));
    assert.match(hs.log.notes[0], /NIET gestart/);
  }

  // 4. Retour: pakketnummer via notitie
  {
    const conv = makeConv({ subject: 'Retour #38084', customerBody: 'Ik heb het teruggestuurd', notes: ['DPD pakket: 05165897299999'], tags: ['dpd-retour'] });
    const gm = fakeGmail(); const hs = fakeHelpscout(conv, gm);
    await processConversation(111, { helpscout: hs, shopify });
    assert.strictEqual(gm.sent[0].subject, '05165897299999');
    assert.match(gm.sent[0].text, /retour van onze klant/);
    fs.writeFileSync(path.join(__dirname, 'voorbeeld-retour.txt'), gm.sent[0].text);
  }

  // 5. Al gestart: niets doen
  {
    const conv = makeConv({ subject: '#38084', customerBody: 'x', tags: ['dpd-niet-ontvangen', 'dpd-onderzoek-gestart'] });
    const gm = fakeGmail();
    const r = await processConversation(111, { helpscout: fakeHelpscout(conv, gm), shopify });
    assert.strictEqual(r.skipped, 'al gestart'); assert.strictEqual(gm.sent.length, 0);
  }

  // 6. Webhook-handtekening
  const body = Buffer.from('{"id":1}');
  const sig = crypto.createHmac('sha1', 'geheim').update(body).digest('base64');
  assert.ok(helpscoutReal.verifySignature(body, sig));
  assert.ok(!helpscoutReal.verifySignature(body, 'fout'));

  // 7. sendDpdEmail: juiste API-aanroepen naar Help Scout (fetch gemockt)
  {
    process.env.HELPSCOUT_APP_ID = 'a'; process.env.HELPSCOUT_APP_SECRET = 'b';
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null });
      const H = (h) => ({ get: (k) => h[k.toLowerCase()] || null });
      if (url.endsWith('/oauth2/token')) return { ok: true, headers: H({}), text: async () => '', json: async () => ({ access_token: 't', expires_in: 7200 }) };
      if (url.endsWith('/v2/conversations') && opts.method === 'POST')
        return { ok: true, status: 201, headers: H({ 'resource-id': '777', 'web-location': 'https://secure.helpscout.net/conversation/777/42' }), text: async () => '' };
      if (url.endsWith('/v2/conversations/777')) return { ok: true, headers: H({}), text: async () => JSON.stringify({ id: 777, number: 42, primaryCustomer: { id: 55 } }) };
      if (url.endsWith('/v2/conversations/777/reply')) return { ok: true, status: 201, headers: H({}), text: async () => '' };
      throw new Error('onverwacht ' + url);
    };
    const big = Buffer.alloc(11 * 1024 * 1024);
    const r = await helpscoutReal.sendDpdEmail({ mailboxId: 1, to: 'customerservice@dpd.nl', subject: '05165897255876', text: 'Regel 1\nRegel <2>',
      attachments: [{ filename: 'a.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }, { filename: 'groot.jpg', content: big, contentType: 'image/jpeg' }],
      tags: ['dpd-onderzoek'], noteText: 'notitie' });
    const create = calls.find((c) => c.url.endsWith('/v2/conversations'));
    assert.strictEqual(create.body.customer.email, 'customerservice@dpd.nl');
    assert.strictEqual(create.body.threads[0].type, 'note');
    const reply = calls.find((c) => c.url.endsWith('/reply'));
    assert.deepStrictEqual(reply.body.customer, { id: 55 });
    assert.strictEqual(reply.body.text, 'Regel 1<br>Regel &lt;2&gt;');
    assert.strictEqual(reply.body.attachments.length, 1);
    assert.strictEqual(reply.body.attachments[0].data, Buffer.from('pdf').toString('base64'));
    assert.deepStrictEqual(r.skipped, ['groot.jpg']);
    assert.strictEqual(r.webUrl, 'https://secure.helpscout.net/conversation/777/42');
  }

  console.log('Alle tests geslaagd');
})().catch((e) => { console.error(e); process.exit(1); });
