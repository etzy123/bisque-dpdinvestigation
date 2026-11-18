const config = require('./config');
const scenarios = require('./scenarios');
const { resolveCase, CaseError } = require('./resolve');
const { buildDpdEmail, euro } = require('./templates');
const { buildOrderPdf } = require('./pdf');
const claude = require('./claude');
const { stripHtml, cutQuotedReply } = require('./parse');

const TRIGGERS = [...Object.keys(scenarios), config.tags.auto];
const tagForKey = Object.fromEntries(Object.entries(scenarios).map(([tag, s]) => [s.key, tag]));

// Gesprek als leesbare tekst voor Claude (oudste eerst, zonder geciteerde mails)
function conversationText(conv) {
  const threads = ((conv._embedded && conv._embedded.threads) || [])
    .filter((t) => ['customer', 'reply', 'note', 'message'].includes(t.type))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const who = (t) => (t.type === 'customer' ? 'Klant' : t.type === 'note' ? 'Interne notitie' : 'Bisque Golf');
  return [`Onderwerp: ${conv.subject || ''}`, ...threads.map((t) => `${who(t)}:\n${cutQuotedReply(stripHtml(t.body))}`)].join('\n\n');
}

// Welk scenario? Specifieke tag wint; bij de algemene tag beslist Claude.
async function chooseScenario(conv, triggerTag, deps) {
  if (triggerTag !== config.tags.auto) return { scenario: scenarios[triggerTag], how: null };
  const drafter = deps.claude || claude;
  const cls = await drafter.classify(conversationText(conv));
  if (cls.soort === 'onzeker') {
    const err = new CaseError(
      `Claude kon niet bepalen welk onderzoek nodig is (${cls.reden}). Draai een specifieke workflow: niet ontvangen, incompleet, beschadigd of retour.`
    );
    throw err;
  }
  const scenario = scenarios[tagForKey[cls.soort]];
  return { scenario, how: `Soort bepaald door Claude: ${scenario.label} (${cls.reden})` };
}

const busy = new Set();

const tagNames = (conv) => (conv.tags || []).map((t) => String(t.tag || t.name || t).toLowerCase());

async function loadAttachments(c, convId, helpscout) {
  let bytes = 0;
  for (const ref of c.attachmentRefs.slice(0, config.maxCustomerAttachments)) {
    if (bytes + (ref.size || 0) > config.maxAttachmentBytes) break;
    const content = await helpscout.getAttachment(convId, ref.id);
    bytes += content.length;
    c.attachments.push({ filename: ref.filename, content, contentType: ref.mimeType });
  }
}

// Bouwt de complete mail (onderwerp, tekst, bijlagen) voor een gesprek.
async function prepare(conv, scenario, deps) {
  const c = await resolveCase(conv, scenario, deps);
  await loadAttachments(c, conv.id, deps.helpscout);

  // Claude: toelichting voor DPD en conceptantwoord voor de klant (optioneel, mag mislukken)
  c.claudeError = null;
  c.customerReply = null;
  const drafter = deps.claude || claude;
  try {
    const firstName = conv.primaryCustomer && conv.primaryCustomer.first;
    const texts = await drafter.draftTexts(c, firstName);
    if (texts) {
      c.dpdParagraph = texts.dpdParagraph;
      c.customerReply = texts.customerReply;
    }
  } catch (e) {
    c.claudeError = e.message;
    console.error(`[gesprek ${conv.id}] Claude mislukt:`, e.message);
  }

  const mail = buildDpdEmail(c);
  const pdf = await buildOrderPdf(c);
  const safeOrder = c.order.name.replace(/[^\w-]/g, '');
  mail.attachments = [
    { filename: `Orderoverzicht ${safeOrder} ${c.tracking}.pdf`, content: pdf, contentType: 'application/pdf' },
    ...c.attachments,
  ];
  return { c, mail };
}

// Hoofdflow: aangeroepen bij elke "tags gewijzigd"-webhook.
async function processConversation(convId, deps) {
  if (busy.has(convId)) return { skipped: 'bezig' };
  busy.add(convId);
  try {
    const { helpscout } = deps;
    const conv = await helpscout.getConversation(convId);
    const tags = tagNames(conv);
    if (tags.includes(config.tags.done)) return { skipped: 'al gestart' };

    const triggerTag = TRIGGERS.find((t) => tags.includes(t));
    if (!triggerTag) return { skipped: 'geen DPD-tag' };
    const keep = tags.filter((t) => !TRIGGERS.includes(t) && t !== config.tags.error);

    let prepared;
    let scenario = scenarios[triggerTag];
    let how = null;
    try {
      ({ scenario, how } = await chooseScenario(conv, triggerTag, deps));
      prepared = await prepare(conv, scenario, deps);
    } catch (err) {
      const msg = err instanceof CaseError ? err.message : `Technische fout: ${err.message}`;
      const label = scenario ? ` (${scenario.label})` : '';
      await helpscout.addNote(convId, `DPD-onderzoek NIET gestart${label}.${how ? `\n${how}` : ''}\n${msg}`);
      await helpscout.setTags(convId, [...keep, config.tags.error]);
      return { error: msg };
    }

    const { c, mail } = prepared;
    const to = config.dryRun ? config.dryRunTo : config.dpdTo;
    const customerConvUrl = `https://secure.helpscout.net/conversation/${conv.id}/${conv.number}`;
    let sent;
    try {
      sent = await helpscout.sendDpdEmail({
      mailboxId: config.helpscout.mailboxId || conv.mailboxId,
      to,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments,
      tags: config.dryRun ? [config.tags.test] : config.tags.onDpdConversation,
      noteText: `DPD-onderzoek (${scenario.label}) voor order ${c.order.name}, pakket ${c.tracking}.\nKlantgesprek: ${customerConvUrl}`,
      });
    } catch (err) {
      // Niet blijven herhalen: trigger-tag eraf, fouttag erop, reden in een notitie
      console.error(`[gesprek ${convId}] verzenden mislukt:`, err.message);
      await helpscout.addNote(convId, `DPD-onderzoek NIET gestart (${scenario.label}): verzenden via Help Scout mislukt.\n${err.message}`);
      await helpscout.setTags(convId, [...keep, config.tags.error]);
      return { error: err.message };
    }

    const summary = [
      `${config.dryRun ? '[TEST, niet naar DPD] ' : ''}DPD-onderzoek gestart: ${scenario.label}.`,
      how || '',
      `Mail naar ${to} verstuurd in een nieuw gesprek, onderwerp ${mail.subject}: ${sent.webUrl || `gesprek #${sent.number}`}`,
      `Order ${c.order.name}, pakket ${c.tracking}, waarde ${euro(c.total, c.currency)}, ${sent.attached} bijlage(n).`,
      sent.skipped.length ? `Niet meegestuurd (groter dan 10 MB): ${sent.skipped.join(', ')}` : '',
      config.dryRun ? '' : 'Antwoorden van DPD (casenummer, updates) komen binnen in dat DPD-gesprek.',
    ].filter(Boolean).join('\n');
    // Conceptantwoord aan de klant als draft in het klantgesprek
    let draftInfo = '';
    if (config.customerDraft && c.customerReply && conv.primaryCustomer && conv.primaryCustomer.id) {
      try {
        await helpscout.createDraftReply(convId, conv.primaryCustomer.id, c.customerReply);
        draftInfo = 'Conceptantwoord voor de klant staat klaar als draft: nalezen en versturen.';
      } catch (e) {
        draftInfo = `Conceptantwoord maken mislukt: ${e.message}`;
      }
    } else if (c.claudeError) {
      draftInfo = `Claude niet beschikbaar (${c.claudeError}); mail is zonder toelichting verstuurd en er is geen conceptantwoord.`;
    }

    await helpscout.addNote(convId, draftInfo ? `${summary}\n${draftInfo}` : summary);

    const newTags = config.dryRun
      ? [...keep, config.tags.test]
      : [...new Set([...keep, config.tags.done, ...config.tags.addOnSuccess])];
    await helpscout.setTags(convId, newTags);
    if (!config.dryRun && config.setPending) await helpscout.setStatus(convId, 'pending');

    return { sent: sent.id, tracking: c.tracking, order: c.order.name, dryRun: config.dryRun };
  } finally {
    busy.delete(convId);
  }
}

module.exports = { processConversation, prepare, tagNames, chooseScenario, conversationText, TRIGGERS };
