const config = require('./config');
const scenarios = require('./scenarios');
const { resolveCase, CaseError } = require('./resolve');
const { buildDpdEmail, euro } = require('./templates');
const { buildOrderPdf } = require('./pdf');
const claude = require('./claude');

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

    const triggerTag = Object.keys(scenarios).find((t) => tags.includes(t));
    if (!triggerTag) return { skipped: 'geen DPD-tag' };
    const scenario = scenarios[triggerTag];
    const keep = tags.filter((t) => t !== triggerTag && t !== config.tags.error);

    let prepared;
    try {
      prepared = await prepare(conv, scenario, deps);
    } catch (err) {
      const msg = err instanceof CaseError ? err.message : `Technische fout: ${err.message}`;
      await helpscout.addNote(convId, `DPD-onderzoek NIET gestart (${scenario.label}).\n${msg}`);
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

module.exports = { processConversation, prepare, tagNames };
