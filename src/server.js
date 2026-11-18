const express = require('express');
const config = require('./config');
const helpscout = require('./helpscout');
const shopify = require('./shopify');
const scenarios = require('./scenarios');
const { processConversation, prepare, tagNames } = require('./process');
const { startPoller } = require('./poller');

const deps = { helpscout, shopify };
const app = express();

app.get('/health', (_req, res) => res.json({ ok: true, dryRun: config.dryRun }));

// Help Scout webhook (event: convo.tags)
app.post('/helpscout/webhook', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  console.log(`[webhook] ontvangen: ${req.get('X-HelpScout-Event')}`);
  if (!helpscout.verifySignature(req.body, req.get('X-HelpScout-Signature'))) {
    console.warn('[webhook] handtekening klopt niet: controleer HELPSCOUT_WEBHOOK_SECRET');
    return res.status(401).send('invalid signature');
  }
  res.status(200).send('ok'); // direct antwoorden, verwerking daarna
  if (req.get('X-HelpScout-Event') !== 'convo.tags') return;

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return;
  }
  const tags = tagNames(payload);
  if (!Object.keys(scenarios).some((t) => tags.includes(t))) return;

  processConversation(payload.id, deps)
    .then((r) => console.log(`[gesprek ${payload.id}]`, JSON.stringify(r)))
    .catch((e) => console.error(`[gesprek ${payload.id}] fout:`, e));
});

// Voorbeeld bekijken zonder te versturen: /preview/123456789?tag=dpd-niet-ontvangen
app.get('/preview/:id', async (req, res) => {
  const auth = Buffer.from((req.get('authorization') || '').replace(/^Basic /, ''), 'base64').toString();
  if (!config.adminPassword || auth.split(':').slice(1).join(':') !== config.adminPassword) {
    return res.set('WWW-Authenticate', 'Basic realm="dpd"').status(401).send('login nodig');
  }
  try {
    const conv = await helpscout.getConversation(req.params.id);
    const tag = req.query.tag || Object.keys(scenarios).find((t) => tagNames(conv).includes(t)) || 'dpd-niet-ontvangen';
    const scenario = scenarios[tag];
    if (!scenario) return res.status(400).send(`Onbekende tag ${tag}`);
    const { c, mail } = await prepare(conv, scenario, deps);
    const files = mail.attachments.map((a) => `- ${a.filename} (${Math.round(a.content.length / 1024)} kB)`).join('\n');
    const reply = c.customerReply
      ? `\n\n=== Conceptantwoord aan de klant (draft) ===\n\n${c.customerReply}`
      : c.claudeError ? `\n\n(Claude mislukt: ${c.claudeError})` : '\n\n(Geen ANTHROPIC_API_KEY: geen conceptantwoord)';
    res.type('text/plain').send(`Aan: ${config.dpdTo}\nOnderwerp: ${mail.subject}\n\n${mail.text}\n\n--- Bijlagen ---\n${files}${reply}`);
  } catch (e) {
    res.status(500).type('text/plain').send(e.message);
  }
});

app.listen(config.port, () => {
  console.log(`DPD-onderzoek-starter luistert op poort ${config.port} (DRY_RUN=${config.dryRun})`);
  startPoller(deps);
});
