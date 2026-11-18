// Uit een Help Scout-gesprek + Shopify de gegevens voor het DPD-onderzoek halen.
const { stripHtml, cutQuotedReply, findTrackingNumbers, findOrderNumbers, parseNoteOverrides } = require('./parse');

class CaseError extends Error {}

const threadsOf = (conv) => (conv._embedded && conv._embedded.threads) || [];
const isCustomer = (t) => t.type === 'customer';
const isNote = (t) => t.type === 'note';
const isDpd = (company = '') => /dpd/i.test(company);

function trackingNumbersOf(order) {
  return order.fulfillments.flatMap((f) => f.trackingInfo.map((t) => t.number)).filter(Boolean);
}

async function findOrder({ shopify, orderNumbers, trackingCandidates, email }) {
  if (orderNumbers.length) {
    const found = [];
    for (const n of orderNumbers) {
      const o = await shopify.findOrderByName(n);
      if (o) found.push(o);
    }
    if (found.length === 1) return found[0];
    if (found.length > 1) {
      // Meerdere ordernummers genoemd: kies de order waar een genoemd pakketnummer bij hoort
      const byTracking = found.filter((o) => trackingNumbersOf(o).some((t) => trackingCandidates.includes(t)));
      if (byTracking.length === 1) return byTracking[0];
      throw new CaseError(
        `In het gesprek staan meerdere orders (${found.map((o) => o.name).join(', ')}). Zet een notitie "DPD order: #12345" en tag opnieuw.`
      );
    }
  }
  for (const t of trackingCandidates) {
    const o = await shopify.findOrderByTracking(t);
    if (o) return o;
  }
  if (email) {
    const since = Date.now() - 60 * 864e5;
    const recent = (await shopify.findOrdersByEmail(email)).filter(
      (o) => new Date(o.createdAt).getTime() > since && o.fulfillments.some((f) => f.trackingInfo.some((t) => isDpd(t.company)))
    );
    if (recent.length === 1) return recent[0];
    if (recent.length > 1) {
      throw new CaseError(
        `Klant ${email} heeft meerdere verzonden orders in de afgelopen 60 dagen (${recent.map((o) => o.name).join(', ')}). Zet een notitie "DPD order: #12345" en tag opnieuw.`
      );
    }
  }
  throw new CaseError(
    'Geen Shopify-order gevonden bij dit gesprek. Zet een notitie "DPD order: #12345" (en eventueel "DPD pakket: 0516...") en tag opnieuw.'
  );
}

async function resolveCase(conv, scenario, { shopify }) {
  const threads = threadsOf(conv);
  const notes = threads.filter(isNote).map((t) => stripHtml(t.body));
  const overrides = parseNoteOverrides(notes);

  // Alle tekst uit klant- en agentberichten (incl. citaten: daar staat vaak de verzendbevestiging in)
  const convText = [conv.subject || '', ...threads.filter((t) => !isNote(t)).map((t) => stripHtml(t.body))].join('\n');
  const trackingCandidates = overrides.tracking ? [overrides.tracking] : findTrackingNumbers(convText);
  const orderNumbers = overrides.order ? [overrides.order] : findOrderNumbers(convText);
  const email = conv.primaryCustomer && conv.primaryCustomer.email;

  const order = await findOrder({ shopify, orderNumbers, trackingCandidates, email });

  // Welk pakket?
  let tracking = null;
  let fulfillment = null;
  const fulfillmentFor = (num) => order.fulfillments.find((f) => f.trackingInfo.some((t) => t.number === num)) || null;

  if (overrides.tracking) {
    tracking = overrides.tracking;
    fulfillment = scenario.usesFulfillment ? fulfillmentFor(tracking) : null;
  } else if (!scenario.usesFulfillment) {
    const outbound = trackingNumbersOf(order);
    const returns = trackingCandidates.filter((t) => !outbound.includes(t));
    if (returns.length !== 1) {
      throw new CaseError(
        returns.length
          ? `Meerdere mogelijke retour-pakketnummers gevonden (${returns.join(', ')}). Zet een notitie "DPD pakket: 0516..." en tag opnieuw.`
          : 'Geen retour-pakketnummer gevonden in het gesprek. Retourlabels staan niet in Shopify: zet een notitie "DPD pakket: 0516..." en tag opnieuw.'
      );
    }
    tracking = returns[0];
  } else {
    const withTracking = order.fulfillments.filter((f) => f.trackingInfo.length);
    const matched = withTracking.filter((f) => f.trackingInfo.some((t) => trackingCandidates.includes(t.number)));
    if (matched.length === 1) {
      fulfillment = matched[0];
      tracking = fulfillment.trackingInfo.find((t) => trackingCandidates.includes(t.number)).number;
    } else if (trackingCandidates.length && !matched.length) {
      throw new CaseError(
        `Pakketnummer uit het gesprek (${trackingCandidates.join(', ')}) hoort niet bij order ${order.name} (Shopify: ${trackingNumbersOf(order).join(', ') || 'geen'}). Controleer en zet een notitie "DPD pakket: 0516..." en tag opnieuw.`
      );
    } else if (withTracking.length === 1 && withTracking[0].trackingInfo.length === 1) {
      fulfillment = withTracking[0];
      tracking = fulfillment.trackingInfo[0].number;
    } else {
      throw new CaseError(
        withTracking.length
          ? `Order ${order.name} heeft meerdere pakketten (${trackingNumbersOf(order).join(', ')}). Zet een notitie "DPD pakket: 0516..." en tag opnieuw.`
          : `Order ${order.name} heeft geen pakketnummer in Shopify. Zet een notitie "DPD pakket: 0516..." en tag opnieuw.`
      );
    }
    const info = fulfillment.trackingInfo.find((t) => t.number === tracking);
    if (info && info.company && !isDpd(info.company)) {
      throw new CaseError(
        `Pakket ${tracking} is volgens Shopify verstuurd met ${info.company}, niet met DPD. Klopt dit wel, zet dan een notitie "DPD pakket: ${tracking}" en tag opnieuw.`
      );
    }
  }

  // Inhoud: alleen de artikelen in dit pakket als die bekend zijn, anders de hele order.
  // Bedrag = wat de klant betaalde: regelprijs na regelkorting, min ordercodes (discountAllocations).
  const netLine = (li) => {
    const m = (li.discountedTotalSet && li.discountedTotalSet.shopMoney) || { amount: 0, currencyCode: 'EUR' };
    const alloc = (li.discountAllocations || []).reduce((s, a) => s + Number(a.allocatedAmountSet.shopMoney.amount), 0);
    return { amount: Number(m.amount) - alloc, currency: m.currencyCode };
  };
  const toItem = (li, qty) => {
    const net = netLine(li);
    const share = li.quantity ? qty / li.quantity : 1;
    return {
      qty,
      title: li.title,
      variant: li.variantTitle,
      sku: li.sku,
      amount: Math.round(net.amount * share * 100) / 100,
      currency: net.currency,
    };
  };
  const items = fulfillment
    ? fulfillment.fulfillmentLineItems.nodes.map((n) => toItem(n.lineItem, n.quantity))
    : order.lineItems.nodes.map((n) => toItem(n, n.quantity));
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;

  // Laatste bericht van de klant (zonder citaten) als verklaring
  const customerThreads = threads.filter(isCustomer).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const last = customerThreads[0];
  let statementText = last ? cutQuotedReply(stripHtml(last.body)) : '';
  if (statementText.length > 2000) statementText = `${statementText.slice(0, 2000)}...`;

  // Foto's en PDF's van de klant
  const attachmentRefs = customerThreads
    .flatMap((t) => ((t._embedded && t._embedded.attachments) || []).map((a) => ({ ...a, threadId: t.id })))
    .filter((a) => /^image\//.test(a.mimeType) || a.mimeType === 'application/pdf');

  return {
    scenario,
    tracking,
    shipDate: fulfillment ? fulfillment.createdAt : null,
    order: { name: order.name, createdAt: order.createdAt },
    recipient: order.shippingAddress || {},
    items,
    total,
    currency: (items[0] && items[0].currency) || 'EUR',
    missing: overrides.missing,
    remarks: overrides.remarks,
    customerStatement: last ? { date: last.createdAt, text: statementText } : null,
    attachmentRefs,
    attachments: [],
  };
}

module.exports = { resolveCase, CaseError };
