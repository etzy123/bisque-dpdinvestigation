// Vangnet naast de webhook: elke paar minuten zoeken naar gesprekken met een DPD-tag.
// Zo start het onderzoek ook als Help Scout geen webhook stuurt (bijv. bij tags van een workflow).
const config = require('./config');
const { processConversation, TRIGGERS } = require('./process');

async function pollOnce(deps) {
  for (const tag of TRIGGERS) {
    let list;
    try {
      list = await deps.helpscout.listConversationsByTag(tag);
    } catch (e) {
      console.error(`[poller] ophalen tag ${tag} mislukt:`, e.message);
      continue;
    }
    for (const conv of list) {
      try {
        const r = await processConversation(conv.id, deps);
        if (!r.skipped) console.log(`[gesprek ${conv.id}] (poller)`, JSON.stringify(r));
      } catch (e) {
        console.error(`[gesprek ${conv.id}] (poller) fout:`, e.message);
      }
    }
  }
}

function startPoller(deps) {
  const seconds = config.pollSeconds;
  if (!seconds) return;
  console.log(`[poller] zoekt elke ${seconds} seconden naar DPD-tags`);
  const run = () => pollOnce(deps).catch((e) => console.error('[poller]', e.message));
  setTimeout(run, 5000);
  setInterval(run, seconds * 1000);
}

module.exports = { startPoller, pollOnce };
