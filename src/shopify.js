const config = require('./config');

let cached = { token: null, expiresAt: 0 };

async function getToken() {
  const s = config.shopify;
  if (s.accessToken) return s.accessToken;
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  // Client credentials grant (Dev Dashboard app in dezelfde Shopify-organisatie)
  const res = await fetch(`https://${s.shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: s.clientId,
      client_secret: s.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Shopify token mislukt: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

async function graphql(query, variables) {
  const s = config.shopify;
  const res = await fetch(`https://${s.shopDomain}/admin/api/${s.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await getToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const ORDER_FIELDS = `
  id name createdAt email
  totalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { name company address1 address2 zip city country countryCodeV2 }
  lineItems(first: 50) { nodes { title variantTitle sku quantity
    discountedTotalSet { shopMoney { amount currencyCode } }
    discountAllocations { allocatedAmountSet { shopMoney { amount } } } } }
  fulfillments {
    createdAt
    trackingInfo { number company url }
    fulfillmentLineItems(first: 50) { nodes { quantity
      lineItem { title variantTitle sku quantity
        discountedTotalSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount } } } } } }
  }`;

async function findOrders(searchQuery, first = 10) {
  const data = await graphql(
    `query($q: String!, $first: Int!) {
      orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } }
    }`,
    { q: searchQuery, first }
  );
  return data.orders.nodes;
}

const findOrderByName = async (number) => (await findOrders(`name:#${number}`, 1))[0] || null;

const findOrdersByEmail = (email) => findOrders(`email:"${email}"`, 10);

// Shopify kan niet zoeken op trackingnummer: recente verzonden orders doorlopen
async function findOrderByTracking(tracking, days = 58, maxPages = 5) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await graphql(
      `query($q: String!, $after: String) {
        orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes { ${ORDER_FIELDS} }
        }
      }`,
      { q: `created_at:>=${since} fulfillment_status:shipped`, after }
    );
    const hit = data.orders.nodes.find((o) =>
      o.fulfillments.some((f) => f.trackingInfo.some((t) => t.number === tracking))
    );
    if (hit) return hit;
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return null;
}

module.exports = { findOrderByName, findOrdersByEmail, findOrderByTracking };
