const PDFDocument = require('pdfkit');
const { euro, datum, address } = require('./templates');

// Orderoverzicht / pakbon als PDF-bijlage voor DPD.
function buildOrderPdf(c) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('Orderoverzicht / pakbon');
    doc.moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#444')
      .text('Bisque Golf and Leisure BV, Kuiperij 20, 1185 XS Amstelveen, Nederland')
      .text('support@bisquegolf.com | +31 20 261 0187 | bisquegolf.com');
    doc.fillColor('#000').moveDown(1.2);

    const row = (k, v) => {
      doc.font('Helvetica-Bold').text(k, { continued: true, width: 495 }).font('Helvetica').text(`  ${v}`);
    };
    row('Ordernummer:', c.order.name);
    row('Orderdatum:', datum(c.order.createdAt));
    if (c.scenario.key !== 'retour') row('Verzonden op:', datum(c.shipDate));
    row('DPD-pakketnummer:', c.tracking);
    row(c.scenario.key === 'retour' ? 'Klant (afzender retour):' : 'Ontvanger:', address(c.recipient));
    doc.moveDown(1.2);

    // Tabel
    const x = { qty: 50, product: 90, sku: 360, amount: 470 };
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Aantal', x.qty, y).text('Product', x.product, y).text('SKU', x.sku, y)
      .text('Bedrag', x.amount, y, { width: 75, align: 'right' });
    y += 16;
    doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor('#999').stroke();
    doc.font('Helvetica');
    for (const i of c.items) {
      const name = [i.title, i.variant && i.variant !== 'Default Title' ? i.variant : null].filter(Boolean).join(', ');
      const h = doc.heightOfString(name, { width: 260 });
      doc.text(String(i.qty), x.qty, y).text(name, x.product, y, { width: 260 })
        .text(i.sku || '', x.sku, y, { width: 105 })
        .text(euro(i.amount, i.currency), x.amount, y, { width: 75, align: 'right' });
      y += Math.max(h, 12) + 6;
    }
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 8;
    doc.font('Helvetica-Bold').text('Totale waarde', x.product, y)
      .text(euro(c.total, c.currency), x.amount, y, { width: 75, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('#666')
      .text('Bedragen zijn verkoopprijzen incl. btw zoals betaald door de klant, na eventuele korting.', 50, y + 24);
    doc.end();
  });
}

module.exports = { buildOrderPdf };
