// De vier soorten onderzoek. De Help Scout-tag start het bijbehorende scenario.
module.exports = {
  'dpd-niet-ontvangen': {
    key: 'niet-ontvangen',
    label: 'pakket niet ontvangen',
    intro:
      'Graag starten wij een onderzoek naar onderstaand pakket. De ontvanger heeft het pakket niet ontvangen.',
    usesFulfillment: true,
  },
  'dpd-incompleet': {
    key: 'incompleet',
    label: 'pakket geopend, leeg of incompleet',
    intro:
      'Graag starten wij een onderzoek naar onderstaand pakket. Het pakket is geopend, leeg of incompleet bij de ontvanger aangekomen.',
    usesFulfillment: true,
  },
  'dpd-beschadigd': {
    key: 'beschadigd',
    label: 'pakket beschadigd',
    intro:
      "Graag starten wij een onderzoek naar onderstaand pakket. Het pakket is beschadigd bij de ontvanger aangekomen. Foto's van de verpakking en de inhoud zitten in de bijlage.",
    usesFulfillment: true,
  },
  'dpd-retour': {
    key: 'retour',
    label: 'retourzending niet aangekomen',
    intro:
      'Graag starten wij een onderzoek naar onderstaand pakket. Dit is een retourzending van onze klant naar ons magazijn (Kuiperij 20, 1185 XS Amstelveen), maar het pakket is nog niet bij ons aangekomen.',
    // Retourlabels staan niet in Shopify: pakketnummer moet uit het gesprek of een notitie komen
    usesFulfillment: false,
  },
};
