// Alle instellingen komen uit environment variables (Railway > Variables).
const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};

const bool = (name, fallback) => {
  const v = env(name);
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'ja'].includes(String(v).toLowerCase());
};

module.exports = {
  port: Number(env('PORT', 3000)),

  // Help Scout
  helpscout: {
    appId: env('HELPSCOUT_APP_ID'),
    appSecret: env('HELPSCOUT_APP_SECRET'),
    webhookSecret: env('HELPSCOUT_WEBHOOK_SECRET'),
  },

  // Shopify: of een vaste token, of client credentials (Dev Dashboard app)
  shopify: {
    shopDomain: env('SHOPIFY_SHOP_DOMAIN', 'bisquegolfdev.myshopify.com'),
    accessToken: env('SHOPIFY_ACCESS_TOKEN'),
    clientId: env('SHOPIFY_CLIENT_ID'),
    clientSecret: env('SHOPIFY_CLIENT_SECRET'),
    apiVersion: env('SHOPIFY_API_VERSION', '2026-10'),
  },

  // Gmail (support@bisquegolf.com), scope gmail.send
  gmail: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    refreshToken: env('GOOGLE_REFRESH_TOKEN'),
    from: env('MAIL_FROM', 'Bisque Golf Support <support@bisquegolf.com>'),
  },

  dpdTo: env('DPD_TO', 'customerservice@dpd.nl'),
  // Testmodus: mail gaat naar DRY_RUN_TO in plaats van DPD
  dryRun: bool('DRY_RUN', true),
  dryRunTo: env('DRY_RUN_TO', 'jelle@bisquegolf.com'),

  senderName: env('SENDER_NAME', 'Jelle'),
  packaging: env(
    'PACKAGING_DESCRIPTION',
    'Lage rechthoekige kartonnen doos (autolock), zonder logo, dichtgeplakt met groene Bisque Golf tape. Transparante tape of een andere doos betekent dat het pakket na vertrek bij ons is geopend en opnieuw verpakt.'
  ),

  setPending: bool('SET_PENDING', true),
  adminPassword: env('ADMIN_PASSWORD'),

  // Tags in Help Scout
  tags: {
    done: 'dpd-onderzoek-gestart',
    error: 'dpd-onderzoek-fout',
    test: 'dpd-onderzoek-test',
    addOnSuccess: ['dpd ticket', 'waiting on dpd'],
  },

  // Max bijlagen van de klant (foto's) die mee gaan naar DPD
  maxCustomerAttachments: Number(env('MAX_CUSTOMER_ATTACHMENTS', 8)),
  maxAttachmentBytes: Number(env('MAX_ATTACHMENT_BYTES', 18 * 1024 * 1024)),
};
