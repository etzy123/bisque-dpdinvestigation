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
   Eindig met de laatste inhoudelijke zin. Geen afsluitende groet (dus geen "Kind regards", "Met vriendelijke groet", "Best"), geen naam, geen bedrijfsgegevens: de handtekening van Help Scout bevat de groet al.

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

// Groet en naam onderaan weghalen: de Help Scout-handtekening bevat die al
function stripName(text) {
  const lines = text.split('\n');
  const greetings = [
    'kind regards', 'best regards', 'regards', 'best', 'best wishes', 'warm regards', 'cheers', 'thanks', 'thank you',
    'met vriendelijke groet', 'met vriendelijke groeten', 'vriendelijke groet', 'groeten', 'groet', 'hartelijke groet',
    'mit freundlichen grüßen', 'mit freundlichen gruessen', 'viele grüße', 'beste grüße', 'liebe grüße',
    'cordialement', 'bien cordialement', 'saludos', 'un saludo', 'cordiali saluti', 'saluti', 'med vänliga hälsningar', 'venlig hilsen', 'med venlig hilsen',
  ];
  const drop = new RegExp(
    `^(${config.senderName}|Bisque Golf|Team Bisque Golf|Bisque Golf Support|${greetings.join('|')})[.,!]?$`,
    'i'
  );
  while (lines.length && (lines[lines.length - 1].trim() === '' || drop.test(lines[lines.length - 1].trim()))) lines.pop();
  return lines.join('\n');
}

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Claude gaf geen JSON terug');
  return JSON.parse(text.slice(start, end + 1));
}

async function draftTexts(c, customerFirstName) {
  if (!config.anthropic.apiKey) return null;
  const text = await callClaude(SYSTEM, buildPrompt(c, customerFirstName), 1500);
  const out = parseJson(text);
  return { dpdParagraph: clean(out.dpd_toelichting), customerReply: stripName(clean(out.klant_antwoord)) };
}

const CLASSIFY_SYSTEM = `Je helpt de klantenservice van Bisque Golf, een golfwebshop die pakketten met DPD verstuurt.
Lees het gesprek met de klant en bepaal welk soort DPD-onderzoek nodig is. Kies precies één:
- "niet-ontvangen": de klant heeft het pakket (nog) niet ontvangen, het is zoek, of volgens DPD bezorgd maar niet bij de klant.
- "incompleet": het pakket is aangekomen maar was geopend, leeg, of er ontbreekt iets.
- "beschadigd": het pakket of de inhoud is beschadigd aangekomen.
- "retour": de klant heeft iets TERUGGESTUURD naar Bisque Golf en die retourzending is niet aangekomen.
- "onzeker": het is niet duidelijk, het gaat om iets anders (verkeerde maat, verkeerd product, vraag over levertijd zonder probleem), of meerdere soorten tegelijk.
Kies alleen iets anders dan "onzeker" als het duidelijk uit het gesprek blijkt. Kies "retour" alleen als de klant expliciet iets heeft teruggestuurd.
Antwoord uitsluitend met JSON: {"soort": "...", "reden": "één korte zin in het Nederlands"}`;

async function callClaude(system, user, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Bepaalt het scenario: 'niet-ontvangen' | 'incompleet' | 'beschadigd' | 'retour' | 'onzeker'
async function classify(conversationText) {
  if (!config.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY ontbreekt');
  const out = parseJson(await callClaude(CLASSIFY_SYSTEM, conversationText.slice(0, 12000), 300));
  const allowed = ['niet-ontvangen', 'incompleet', 'beschadigd', 'retour', 'onzeker'];
  const soort = allowed.includes(out.soort) ? out.soort : 'onzeker';
  return { soort, reden: clean(out.reden) };
}

module.exports = { classify, draftTexts, buildPrompt, SYSTEM, stripName };
