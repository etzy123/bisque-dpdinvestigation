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

function fakeHelpscout(conv) {
  const log = { notes: [], tags: null, status: null };
  return {
    log,
    getConversation: async () => conv,
    getAttachment: async () => Buffer.from('fakejpeg'),
    addNote: async (_id, t) => log.notes.push(t),
    setTags: async (_id, t) => { log.tags = t; },
    setStatus: async (_id, s) => { log.status = s; },
  };
}

const fakeGmail = () => { const sent = []; return { sent, sendMail: async (m) => { sent.push(m); return { id: 'msg1' }; } }; };

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
    const hs = fakeHelpscout(conv); const gm = fakeGmail();
    const r = await processConversation(111, { helpscout: hs, shopify, gmail: gm });
    assert.strictEqual(r.tracking, '05165897255876');
    assert.strictEqual(gm.sent[0].to, 'customerservice@dpd.nl');
    assert.strictEqual(gm.sent[0].subject, '05165897255876');
    assert.match(gm.sent[0].text, /Totale waarde: € 150,00/);
    assert.match(gm.sent[0].text, /Verzonden op: 12-10-2026/);
    assert.ok(!gm.sent[0].text.includes('—'), 'geen em dash');
    assert.deepStrictEqual(hs.log.tags.sort(), ['dpd ticket', 'dpd-onderzoek-gestart', 'waiting on dpd']);
    assert.strictEqual(hs.log.status, 'pending');
    fs.writeFileSync(path.join(__dirname, 'voorbeeld-niet-ontvangen.txt'), gm.sent[0].text);
    fs.writeFileSync(path.join(__dirname, 'voorbeeld-orderoverzicht.pdf'), gm.sent[0].attachments[0].content);
  }

  // 2. Incompleet: geen ordernummer, wel e-mail en foto's, plus notitie
  {
    const conv = makeConv({ subject: 'Pakket open', customerBody: 'De doos was open en de polo ontbreekt.', notes: ['DPD ontbreekt: Malbon Buckets Polo M / Navy'], tags: ['dpd-incompleet', 'return'],
      attachments: [{ id: 5, filename: 'doos.jpg', mimeType: 'image/jpeg', size: 1000 }, { id: 6, filename: 'x.zip', mimeType: 'application/zip', size: 10 }] });
    const hs = fakeHelpscout(conv); const gm = fakeGmail();
    await processConversation(111, { helpscout: hs, shopify, gmail: gm });
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
    const hs = fakeHelpscout(conv); const gm = fakeGmail();
    const r = await processConversation(111, { helpscout: hs, shopify, gmail: gm });
    assert.ok(r.error); assert.strictEqual(gm.sent.length, 0);
    assert.ok(hs.log.tags.includes('dpd-onderzoek-fout'));
    assert.match(hs.log.notes[0], /NIET gestart/);
  }

  // 4. Retour: pakketnummer via notitie
  {
    const conv = makeConv({ subject: 'Retour #38084', customerBody: 'Ik heb het teruggestuurd', notes: ['DPD pakket: 05165897299999'], tags: ['dpd-retour'] });
    const hs = fakeHelpscout(conv); const gm = fakeGmail();
    await processConversation(111, { helpscout: hs, shopify, gmail: gm });
    assert.strictEqual(gm.sent[0].subject, '05165897299999');
    assert.match(gm.sent[0].text, /retour van onze klant/);
    fs.writeFileSync(path.join(__dirname, 'voorbeeld-retour.txt'), gm.sent[0].text);
  }

  // 5. Al gestart: niets doen
  {
    const conv = makeConv({ subject: '#38084', customerBody: 'x', tags: ['dpd-niet-ontvangen', 'dpd-onderzoek-gestart'] });
    const gm = fakeGmail();
    const r = await processConversation(111, { helpscout: fakeHelpscout(conv), shopify, gmail: gm });
    assert.strictEqual(r.skipped, 'al gestart'); assert.strictEqual(gm.sent.length, 0);
  }

  // 6. Webhook-handtekening
  const body = Buffer.from('{"id":1}');
  const sig = crypto.createHmac('sha1', 'geheim').update(body).digest('base64');
  assert.ok(helpscoutReal.verifySignature(body, sig));
  assert.ok(!helpscoutReal.verifySignature(body, 'fout'));

  // 7. Volledige MIME-mail kan gebouwd worden
  const { buildRaw } = require('../src/gmail');
  const conv = makeConv({ subject: '#38084', customerBody: 'niet ontvangen', tags: ['dpd-beschadigd'] });
  const { mail } = await prepare(conv, scenarios['dpd-beschadigd'], { helpscout: fakeHelpscout(conv), shopify });
  const raw = await buildRaw({ ...mail, to: 'test@example.com' });
  assert.match(raw.toString(), /Subject: 05165897255876/);

  console.log('Alle tests geslaagd');
})().catch((e) => { console.error(e); process.exit(1); });
