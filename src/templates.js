const config = require('./config');

const euro = (amount, currency = 'EUR') =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(Number(amount || 0)).replace(/\s/g, ' ');

const datum = (iso) => {
  if (!iso) return 'onbekend';
  const d = new Date(iso);
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Amsterdam' });
};

const address = (a = {}) =>
  [a.name, a.company, [a.address1, a.address2].filter(Boolean).join(' '), [a.zip, a.city].filter(Boolean).join(' '), a.country]
    .filter(Boolean)
    .join(', ');

function itemLine(i) {
  const name = [i.title, i.variant && i.variant !== 'Default Title' ? i.variant : null].filter(Boolean).join(', ');
  const sku = i.sku ? ` (SKU ${i.sku})` : '';
  return `- ${i.qty}x ${name}${sku}: ${euro(i.amount, i.currency)}`;
}

// Bouwt onderwerp en tekst van de mail aan DPD.
function buildDpdEmail(c) {
  const s = c.scenario;
  const L = [];
  L.push('Goedemiddag,', '', s.intro, '');

  L.push('Pakketgegevens');
  L.push(`- Pakketnummer: ${c.tracking}`);
  if (s.key === 'retour') {
    L.push('- Soort zending: retour van onze klant naar Bisque Golf');
    if (c.shipDate) L.push(`- Verzonden op: ${datum(c.shipDate)}`);
    L.push(`- Oorspronkelijke order: ${c.order.name}`);
    L.push(`- Afzender (onze klant): ${address(c.recipient)}`);
    L.push('- Ontvanger: Bisque Golf and Leisure BV, Kuiperij 20, 1185 XS Amstelveen, Nederland');
  } else {
    L.push(`- Verzonden op: ${datum(c.shipDate)}`);
    L.push(`- Ordernummer: ${c.order.name}`);
    L.push(`- Ontvanger: ${address(c.recipient)}`);
  }
  L.push('');

  L.push('Inhoud en waarde');
  for (const i of c.items) L.push(itemLine(i));
  L.push(`Totale waarde: ${euro(c.total, c.currency)} (verkoopwaarde incl. btw, zie orderoverzicht in de bijlage)`);
  L.push('');

  if (c.missing.length) {
    L.push(`Volgens de ontvanger ontbreekt: ${c.missing.join('; ')}`, '');
  } else if (s.key === 'incompleet') {
    L.push('Wat er volgens de ontvanger ontbreekt, staat in het bericht van de ontvanger hieronder.', '');
  }

  L.push('Verpakking');
  L.push(config.packaging, '');

  for (const r of c.remarks) L.push(`Opmerking: ${r}`);
  if (c.remarks.length) L.push('');

  L.push('Bijlagen');
  L.push(`- Orderoverzicht / pakbon van order ${c.order.name}`);
  const photos = c.attachments.filter((a) => /^image\//.test(a.contentType)).length;
  const others = c.attachments.length - photos;
  if (photos) L.push(`- ${photos} foto${photos === 1 ? '' : "'s"} van de ontvanger`);
  if (others) L.push(`- ${others} ander${others === 1 ? '' : 'e'} bestand${others === 1 ? '' : 'en'} van de ontvanger`);
  L.push('');

  if (c.customerStatement && c.customerStatement.text) {
    const who = s.key === 'retour' ? 'onze klant' : 'de ontvanger';
    L.push(`Bericht van ${who} aan onze klantenservice (${datum(c.customerStatement.date)}):`);
    L.push(c.customerStatement.text.split('\n').map((l) => `> ${l}`).join('\n'));
    L.push('');
  }

  L.push('Hiermee is alle informatie compleet om het onderzoek direct te starten.', '');
  L.push('Met vriendelijke groet,', '');
  L.push(config.senderName);
  L.push('Bisque Golf and Leisure BV');
  L.push('support@bisquegolf.com | +31 20 261 0187');
  L.push('Kuiperij 20, 1185 XS Amstelveen');

  return { subject: c.tracking, text: L.join('\n') };
}

module.exports = { buildDpdEmail, euro, datum, address };
