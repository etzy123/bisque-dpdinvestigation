// Claude (Anthropic API) schrijft twee stukken tekst per onderzoek:
// 1. een korte toelichting voor DPD op basis van het bericht van de klant (Nederlands);
// 2. een conceptantwoord aan de klant in de taal van de klant (komt als draft in Help Scout).
const config = require('./config');
const { euro, datum } = require('./templates');

const SYSTEM = `Je werkt voor de klantenservice van Bisque Golf, een Nederlandse golfwebshop (Amstelveen).
Er wordt een onderzoek gestart bij vervoerder DPD naar een pakket. Je schrijft twee teksten en geeft alleen JSON terug.

1. "dpd_toelichting": Nederlands, zakelijk, 1 tot 4 zinnen, voor de klantenservice van DPD.
   Beschrijf alleen wat de klant zelf meldt en wat nuttig is voor het onderzoek: wat er ontbreekt of beschadigd is,
   hoe de doos eruitzag, wat de tracking of de bezorger zei, waar het pakket volgens DPD is afgeleverd, datums.
   Verzin niets. Geen bedragen, geen ordergegevens, geen adres (die staan al in de mail).
   Staat er niets bruikbaars in het bericht, geef dan een lege string.

2. "klant_antwoord": een antwoord aan de klant, in dezelfde taal als het bericht van de klant.
   Toon: vriendelijk, kort, persoonlijk, niet overdreven verontschuldigend. Spreek de klant aan met de voornaam als die bekend is.
   Inhoud: bedank voor het melden, zeg dat we een onderzoek bij DPD zijn gestart voor het pakket van de genoemde order,
   dat dit meestal 5 tot 10 werkdagen duurt en dat we een update sturen zodra we iets horen.
   Bij een incompleet of beschadigd pakket: vraag de klant de doos en verpakking te bewaren tot het onderzoek klaar is.
   Bij een retour: zeg dat we het onderzoek naar de retourzending zijn gestart.
   Beloof NOOIT een terugbetaling, vervanging, vergoeding of uitkomst. Geef DPD of de klant geen schuld.
   Beantwoord wel kort andere concrete vragen uit het bericht als dat kan zonder iets te beloven.
   Sluit af met een groet en de naam "${config.senderName}" op een eigen regel, zonder bedrijfsgegevens.

Algemeen: platte tekst, geen markdown, geen gedachtestreepjes (geen "—" of "–"), gewone komma's en punten.
Antwoord uitsluitend met JSON: {"dpd_toelichting": "...", "klant_antwoord": "..."}`;

function buildPrompt(c, customerFirstName) {
  const items = c.items.map((i) => `- ${i.qty}x ${i.title}${i.variant && i.variant !== 'Default Title' ? `, ${i.variant}` : ''}`).join('\n');
  return [
    `Soort onderzoek: ${c.scenario.label}`,
    `Order: ${c.order.name}`,
    `Pakketnummer: ${c.tracking}`,
    `Verzonden op: ${datum(c.shipDate)}`,
    `Inhoud:\n${items}`,
    `Totale waarde: ${euro(c.total, c.currency)}`,
    c.missing.length ? `Volgens interne notitie ontbreekt: ${c.missing.join('; ')}` : '',
    c.remarks.length ? `Interne opmerking: ${c.remarks.join('; ')}` : '',
    `Voornaam klant: ${customerFirstName || 'onbekend'}`,
    '',
    'Bericht van de klant:',
    (c.customerStatement && c.customerStatement.text) || '(geen bericht)',
  ].filter((l) => l !== '').join('\n');
}

const clean = (t) =>
  String(t || '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/\s*[—–]\s*/g, ', ')
    .trim();

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Claude gaf geen JSON terug');
  return JSON.parse(text.slice(start, end + 1));
}

async function draftTexts(c, customerFirstName) {
  if (!config.anthropic.apiKey) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(c, customerFirstName) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = parseJson(text);
  return { dpdParagraph: clean(out.dpd_toelichting), customerReply: clean(out.klant_antwoord) };
}

module.exports = { draftTexts, buildPrompt, SYSTEM };
