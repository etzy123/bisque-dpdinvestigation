// Tekst uit Help Scout-gesprekken halen en nummers herkennen.

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&euro;/g, '€')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(html = '') {
  const text = String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Geciteerde eerdere mails eraf knippen
function cutQuotedReply(text = '') {
  const markers = [
    /^On .{5,200} wrote:$/m,
    /^Op .{5,200} schreef .{0,200}:$/m,
    /^Am .{5,200} schrieb .{0,200}:$/m,
    /^-{2,}\s*(Original Message|Oorspronkelijk bericht|Forwarded message)/im,
    /^From: .+$/m,
    /^Van: .+$/m,
  ];
  let cut = text.length;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut).trim();
}

// DPD NL pakketnummers: 14 cijfers, beginnen met 0 (bijv. 05165897255876)
function findTrackingNumbers(text = '') {
  const out = new Set();
  for (const m of String(text).matchAll(/(?<!\d)(0\d{13})(?!\d)/g)) out.add(m[1]);
  return [...out];
}

// Ordernummers zoals #38084, order 38084, ordernummer: 38084
function findOrderNumbers(text = '') {
  const out = new Set();
  const re = /(?:#\s?|\border(?:nummer|nr\.?|\s+number|\s+no\.?)?\s*:?\s*#?\s?)(\d{4,6})(?!\d)/gi;
  for (const m of String(text).matchAll(re)) out.add(m[1]);
  return [...out];
}

// Interne notities met instructies, bijvoorbeeld:
//   DPD pakket: 05165897255876
//   DPD order: #38084
//   DPD ontbreekt: zwarte broek maat 32
//   DPD opmerking: klant heeft de doos bewaard
function parseNoteOverrides(noteTexts = []) {
  const o = { tracking: null, order: null, missing: [], remarks: [] };
  for (const raw of noteTexts) {
    for (const line of String(raw).split('\n')) {
      const m = line.match(/^\s*DPD\s+(pakket|pakketnummer|order|ontbreekt|opmerking)\s*:\s*(.+)$/i);
      if (!m) continue;
      const field = m[1].toLowerCase();
      const value = m[2].trim();
      if (field.startsWith('pakket')) o.tracking = findTrackingNumbers(value)[0] || o.tracking;
      else if (field === 'order') o.order = (value.match(/\d{4,6}/) || [])[0] || o.order;
      else if (field === 'ontbreekt') o.missing.push(value);
      else if (field === 'opmerking') o.remarks.push(value);
    }
  }
  return o;
}

module.exports = {
  stripHtml,
  cutQuotedReply,
  findTrackingNumbers,
  findOrderNumbers,
  parseNoteOverrides,
};
