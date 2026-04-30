import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function formatMXN(amount: number | null | undefined): string {
  if (amount == null) return 'N/D';
  return `$${Number(amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/D';
  return new Date(date).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function todayMX(): string {
  return new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
}

function writtenCityDate(city = 'Ciudad de México'): string {
  return `${city}, a ${todayMX()}`;
}

// Draws a section heading
function sectionTitle(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(11).text(text.toUpperCase(), { underline: true });
  doc.font('Helvetica').fontSize(10);
  doc.moveDown(0.3);
}

// Draws a numbered clause
function clause(doc: PDFKit.PDFDocument, number: number, title: string, body: string) {
  doc.font('Helvetica-Bold').fontSize(10).text(`CLÁUSULA ${number}. – ${title}`);
  doc.font('Helvetica').fontSize(10).text(body, { align: 'justify' });
  doc.moveDown(0.5);
}

// Signature block
function signatureBlock(doc: PDFKit.PDFDocument, labelLeft: string, labelRight: string) {
  doc.moveDown(2);
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const col = pageWidth / 2 - 20;

  // Left sig
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + col, doc.y).stroke();
  doc.font('Helvetica').fontSize(9).text(labelLeft, { width: col, align: 'center' });

  // Right sig — move back up and draw on the right
  doc.moveUp(1.5);
  const rightX = doc.page.margins.left + col + 40;
  doc.moveTo(rightX, doc.y + doc.currentLineHeight(true) * 1.5).lineTo(rightX + col, doc.y + doc.currentLineHeight(true) * 1.5).stroke();
  doc.text(labelRight, rightX, doc.y + doc.currentLineHeight(true) * 2, { width: col, align: 'center' });
  doc.moveDown(2);
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.font('Helvetica-Bold').fontSize(14).text('Casa-MX.com', { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(12).text(title, { align: 'center' });
  if (subtitle) doc.font('Helvetica').fontSize(10).text(subtitle, { align: 'center' });
  doc.moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10);
}

// ────────────────────────────────────────────────────────
// RENTAL CONTRACT — Contrato de Arrendamiento
// ────────────────────────────────────────────────────────

export async function generateRentalContract(prisma: PrismaClient, applicationId: string): Promise<Buffer> {
  const app = await prisma.rentalApplication.findUnique({
    where: { id: applicationId },
    include: { property: true },
  });

  if (!app) throw new Error('Application not found');

  const p = app.property;
  const landlordUser = await prisma.user.findUnique({ where: { id: p.sellerId }, select: { name: true, email: true } });
  const landlord = landlordUser ?? { name: 'El Arrendador', email: '' };
  const address = [p.address, p.colonia, p.ciudad, p.estado].filter(Boolean).join(', ');
  const rent = formatMXN(p.monthlyRent);
  const deposit = formatMXN(p.securityDeposit);
  const moveIn = formatDate(app.desiredMoveInDate);
  const duration = `${app.desiredLeaseTerm} ${app.desiredLeaseTerm === 1 ? 'mes' : 'meses'}`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    header(doc, 'CONTRATO DE ARRENDAMIENTO', 'República Mexicana');

    doc.text(`En ${writtenCityDate(p.ciudad ?? undefined)}, comparecen las partes que se señalan a continuación, quienes libre y voluntariamente convienen en celebrar el presente Contrato de Arrendamiento, al tenor de las siguientes declaraciones y cláusulas:`, { align: 'justify' });
    doc.moveDown(0.5);

    sectionTitle(doc, 'DECLARACIONES');
    doc.text(`I. EL ARRENDADOR: ${landlord.name}, en adelante "EL ARRENDADOR", manifiesta ser el legítimo propietario o representante autorizado del inmueble objeto del presente contrato.`);
    doc.moveDown(0.3);
    doc.text(`II. EL ARRENDATARIO: ${app.fullName}, correo: ${app.email}, teléfono: ${app.phone}, en adelante "EL ARRENDATARIO".`);
    doc.moveDown(0.8);

    sectionTitle(doc, 'CLÁUSULAS');

    clause(doc, 1, 'OBJETO', `El ARRENDADOR da en arrendamiento al ARRENDATARIO el inmueble ubicado en: ${address}, con clave de propiedad: ${p.id.substring(0, 8).toUpperCase()}. El inmueble se destinará exclusivamente para uso habitacional.`);

    clause(doc, 2, 'VIGENCIA DEL CONTRATO', `El presente contrato tendrá una vigencia de ${duration}, iniciando el ${moveIn}. Al término del plazo pactado, el contrato podrá renovarse por períodos iguales previo acuerdo escrito de las partes.`);

    clause(doc, 3, 'RENTA MENSUAL', `El ARRENDATARIO se obliga a pagar la cantidad de ${rent} mensualmente como renta del inmueble arrendado.${app.offeredMonthlyRent ? ` Renta acordada por el arrendatario: ${formatMXN(app.offeredMonthlyRent)}.` : ''} Los pagos deberán realizarse dentro de los primeros cinco días naturales de cada mes.`);

    clause(doc, 4, 'DEPÓSITO EN GARANTÍA', `El ARRENDATARIO entrega en este acto la cantidad de ${deposit} como depósito en garantía, el cual le será devuelto al término del contrato, previa verificación de que el inmueble se encuentra en buen estado y sin adeudos.`);

    clause(doc, 5, 'OCUPANTES', `El número de personas que habitarán el inmueble será de ${app.numberOfOccupants}. El ARRENDATARIO no podrá subarrendar total ni parcialmente sin autorización escrita del ARRENDADOR.`);

    clause(doc, 6, 'SERVICIOS E IMPUESTOS', `Los servicios de luz, agua, gas y demás que se generen en el inmueble durante el arrendamiento serán a cargo y responsabilidad del ARRENDATARIO.${p.utilitiesIncluded ? ' El ARRENDADOR ha indicado que algunos servicios están incluidos en la renta.' : ''}`);

    clause(doc, 7, 'CONSERVACIÓN Y MANTENIMIENTO', `El ARRENDATARIO recibirá el inmueble en buen estado de conservación y se obliga a mantenerlo en las mismas condiciones. Las reparaciones menores serán por cuenta del ARRENDATARIO; las mayores corresponderán al ARRENDADOR siempre que no deriven de descuido o mal uso por parte del ARRENDATARIO.`);

    clause(doc, 8, 'TERMINACIÓN ANTICIPADA', `En caso de rescisión anticipada por parte del ARRENDATARIO, se perderá el depósito en garantía como penalidad, sin perjuicio de los demás adeudos. El ARRENDADOR podrá rescindir el contrato por falta de pago de dos mensualidades consecutivas.`);

    clause(doc, 9, 'ENTREGA DEL INMUEBLE', `Al término del contrato, el ARRENDATARIO entregará el inmueble libre de personas, bienes muebles, en buen estado de conservación y al corriente en el pago de todos los servicios.`);

    clause(doc, 10, 'JURISDICCIÓN', `En todo lo relacionado con la interpretación y cumplimiento del presente contrato, las partes se someten expresamente a las leyes y tribunales competentes del fuero común del Estado de ${p.estado ?? 'México'}, renunciando al fuero que por razón de su domicilio presente o futuro pudiera corresponderles.`);

    doc.addPage();
    doc.font('Helvetica').fontSize(10).text('Leído el presente instrumento por las partes y enteradas de su contenido, valor y alcance legal, lo firman de conformidad en la ciudad y fecha indicados al inicio.', { align: 'justify' });

    signatureBlock(doc, `EL ARRENDADOR\n${landlord.name}`, `EL ARRENDATARIO\n${app.fullName}`);

    doc.fontSize(8).fillColor('grey').text('Contrato generado por Casa-MX.com · Plataforma de bienes raíces · México', { align: 'center' });

    doc.end();
  });
}

// ────────────────────────────────────────────────────────
// SALE CONTRACT — Contrato de Compraventa
// ────────────────────────────────────────────────────────

export async function generateSaleContract(prisma: PrismaClient, offerId: string): Promise<Buffer> {
  const offer = await prisma.propertyOffer.findUnique({
    where: { id: offerId },
    include: { property: true },
  });

  if (!offer) throw new Error('Offer not found');

  const p = offer.property;
  const sellerUser = await prisma.user.findUnique({ where: { id: p.sellerId }, select: { name: true, email: true } });
  const seller = sellerUser ?? { name: 'El Vendedor', email: '' };
  const address = [p.address, p.colonia, p.ciudad, p.estado].filter(Boolean).join(', ');
  const price = formatMXN(offer.offerAmount);
  const closingDate = formatDate(offer.closingDate);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    header(doc, 'CONTRATO DE COMPRAVENTA', 'República Mexicana');

    doc.text(`En ${writtenCityDate(p.ciudad ?? undefined)}, comparecen las partes que a continuación se señalan, quienes convienen libremente en celebrar el presente Contrato de Compraventa de conformidad con lo establecido por los artículos 2248 y siguientes del Código Civil Federal.`, { align: 'justify' });
    doc.moveDown(0.5);

    sectionTitle(doc, 'DECLARACIONES');
    doc.text(`I. EL VENDEDOR: ${seller.name}, correo: ${seller.email}, en adelante "EL VENDEDOR", manifiesta ser el legítimo propietario del inmueble objeto de este contrato.`);
    doc.moveDown(0.3);
    doc.text(`II. EL COMPRADOR: ${offer.buyerName}, correo: ${offer.buyerEmail}, teléfono: ${offer.buyerPhone}, en adelante "EL COMPRADOR".`);
    doc.moveDown(0.8);

    sectionTitle(doc, 'CLÁUSULAS');

    clause(doc, 1, 'OBJETO', `El VENDEDOR transmite la propiedad del inmueble ubicado en: ${address}, con clave Casa-MX.com: ${p.id.substring(0, 8).toUpperCase()}, tipo: ${p.propertyType ?? 'inmueble'}, con ${p.bedrooms ?? 'N/D'} recámaras, ${p.bathrooms ?? 'N/D'} baños y ${p.squareMeters ?? 'N/D'} m².`);

    clause(doc, 2, 'PRECIO Y FORMA DE PAGO', `Las partes acuerdan como precio de venta la cantidad de ${price}. Forma de financiamiento: ${offer.financing}. La totalidad del precio deberá cubrirse a más tardar el ${closingDate}.`);

    clause(doc, 3, 'ESCRITURACIÓN', `Las partes se obligan a comparecer ante Notario Público para la formalización de la escritura traslativa de dominio dentro de un plazo de 30 días hábiles a partir de la firma del presente contrato.`);

    clause(doc, 4, 'POSESIÓN', `La entrega material del inmueble se realizará en la fecha de cierre acordada (${closingDate}), libre de personas, bienes muebles y gravámenes, salvo los que hubieran sido informados previamente al COMPRADOR.`);

    clause(doc, 5, 'ESTADO DEL INMUEBLE', `El VENDEDOR declara que el inmueble se encuentra en buenas condiciones de habitabilidad al momento de la firma. El COMPRADOR declara haber visitado e inspeccionado el inmueble y aceptarlo en el estado en que se encuentra.`);

    clause(doc, 6, 'GASTOS DE ESCRITURACIÓN', `Los gastos de escrituración, impuestos y derechos notariales correrán por cuenta del COMPRADOR, salvo pacto en contrario. El Impuesto sobre la Renta (ISR) del VENDEDOR será cubierto por éste conforme a la ley.`);

    clause(doc, 7, 'GARANTÍAS', `El VENDEDOR garantiza la titularidad del inmueble, que el mismo se encuentra libre de gravámenes, hipotecas, embargos o cualquier limitación de dominio al momento de la firma, salvo los ya informados.`);

    clause(doc, 8, 'PENA CONVENCIONAL', `En caso de incumplimiento por parte del COMPRADOR, el VENDEDOR tendrá derecho a retener el diez por ciento (10%) del precio como pena convencional. En caso de incumplimiento por parte del VENDEDOR, éste deberá reembolsar el doble de cualquier anticipo recibido.`);

    clause(doc, 9, 'CESIÓN DE DERECHOS', `Los derechos derivados del presente contrato no podrán cederse sin previa autorización escrita de la otra parte.`);

    clause(doc, 10, 'JURISDICCIÓN', `Para la interpretación y cumplimiento del presente contrato, las partes se someten a las leyes y tribunales de ${p.estado ?? 'México'}, renunciando a cualquier otro fuero que pudiera corresponderles.`);

    if (offer.message) {
      doc.moveDown(0.5);
      doc.font('Helvetica-Oblique').fontSize(9).text(`Nota adicional del comprador: "${offer.message}"`, { align: 'justify' });
    }

    doc.addPage();
    doc.font('Helvetica').fontSize(10).text('Leído el presente instrumento por las partes y enteradas de su contenido, valor y alcance legal, lo firman de conformidad en la ciudad y fecha indicados al inicio.', { align: 'justify' });

    signatureBlock(doc, `EL VENDEDOR\n${seller.name}`, `EL COMPRADOR\n${offer.buyerName}`);

    doc.fontSize(8).fillColor('grey').text('Contrato generado por Casa-MX.com · Plataforma de bienes raíces · México', { align: 'center' });

    doc.end();
  });
}

// ────────────────────────────────────────────────────────
// PROMESA DE COMPRAVENTA — Payment Plan Contract
// ────────────────────────────────────────────────────────

export async function generatePromesaContract(prisma: PrismaClient, offerId: string): Promise<Buffer> {
  const offer = await prisma.propertyOffer.findUnique({
    where: { id: offerId },
    include: { property: true },
  });

  if (!offer) throw new Error('Offer not found');

  const p = offer.property;
  const sellerUser = await prisma.user.findUnique({ where: { id: p.sellerId }, select: { name: true, email: true } });
  const seller = sellerUser ?? { name: 'El Vendedor', email: '' };
  const address = [p.address, p.colonia, p.ciudad, p.estado].filter(Boolean).join(', ');
  const price = formatMXN(offer.offerAmount);
  const enganche = formatMXN(offer.enganche);
  const plazo = offer.plazoMeses ?? 0;
  const cuota = formatMXN(offer.cuotaMensual);
  const closingDate = formatDate(offer.closingDate);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    header(doc, 'PROMESA DE COMPRAVENTA', 'Con Plan de Pagos · República Mexicana');

    doc.text(`En ${writtenCityDate(p.ciudad ?? undefined)}, las partes que a continuación se identifican celebran la presente Promesa de Compraventa, obligándose a firmar el contrato definitivo de compraventa una vez cubierta la totalidad del precio pactado.`, { align: 'justify' });
    doc.moveDown(0.5);

    sectionTitle(doc, 'DECLARACIONES');
    doc.text(`I. EL PROMITENTE VENDEDOR: ${seller.name}, correo: ${seller.email}, en adelante "EL VENDEDOR".`);
    doc.moveDown(0.3);
    doc.text(`II. EL PROMITENTE COMPRADOR: ${offer.buyerName}, correo: ${offer.buyerEmail}, teléfono: ${offer.buyerPhone}, en adelante "EL COMPRADOR".`);
    doc.moveDown(0.8);

    sectionTitle(doc, 'CLÁUSULAS');

    clause(doc, 1, 'OBJETO', `El VENDEDOR promete vender y el COMPRADOR promete comprar el inmueble ubicado en: ${address}, clave Casa-MX.com: ${p.id.substring(0, 8).toUpperCase()}, tipo: ${p.propertyType ?? 'inmueble'}, de ${p.squareMeters ?? 'N/D'} m².`);

    clause(doc, 2, 'PRECIO TOTAL', `El precio total de venta acordado es de ${price}. Las partes convienen en el siguiente plan de pagos:`);

    // Payment schedule table
    doc.moveDown(0.3);
    const tableX = doc.page.margins.left;
    const colW = [180, 140, 140];
    const rowH = 18;
    const headers = ['Concepto', 'Monto', 'Condición'];
    const rows: [string, string, string][] = [
      ['Enganche (pago inicial)', enganche, 'A la firma del contrato'],
      [`${plazo} pagos mensuales`, cuota, 'Del mes 1 al mes ' + plazo],
      ['Precio total', price, 'Al complete el plan'],
    ];

    // header row
    doc.font('Helvetica-Bold').fontSize(9);
    let tx = tableX;
    headers.forEach((h, i) => {
      doc.rect(tx, doc.y, colW[i], rowH).fillAndStroke('#f5f5f5', '#cccccc');
      doc.fillColor('black').text(h, tx + 4, doc.y - rowH + 4, { width: colW[i] - 8 });
      tx += colW[i];
    });
    doc.moveDown(0.1);

    // data rows
    doc.font('Helvetica').fontSize(9);
    rows.forEach((row) => {
      tx = tableX;
      const y = doc.y;
      row.forEach((cell, i) => {
        doc.rect(tx, y, colW[i], rowH).stroke('#cccccc');
        doc.fillColor('black').text(cell, tx + 4, y + 4, { width: colW[i] - 8 });
        tx += colW[i];
      });
      doc.moveDown(0.05);
      doc.y = y + rowH;
    });
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(10);

    clause(doc, 3, 'FORMA DE PAGO', `El enganche será pagado a la firma del presente contrato. Las mensualidades se pagarán los primeros cinco días de cada mes, comenzando el mes siguiente a la firma. Sin intereses, salvo mora.`);

    clause(doc, 4, 'MORA', `En caso de retraso en el pago de cualquier mensualidad, el COMPRADOR pagará un interés moratorio del 1.5% mensual sobre el saldo insoluto, sin necesidad de requerimiento judicial.`);

    clause(doc, 5, 'ESCRITURACIÓN', `Una vez cubierto el total del precio, las partes comparecerán ante Notario Público para la formalización de la escritura traslativa de dominio dentro de 30 días hábiles.`);

    clause(doc, 6, 'POSESIÓN', `El COMPRADOR podrá tomar posesión del inmueble ${offer.enganche ? 'al momento de cubrir el enganche' : 'al término del plan de pagos'}, previa firma de este instrumento.`);

    clause(doc, 7, 'RESCISIÓN POR INCUMPLIMIENTO', `El incumplimiento en el pago de tres mensualidades consecutivas o cinco no consecutivas faculta al VENDEDOR a rescindir el presente contrato reteniiendo los pagos efectuados como pena convencional, sin necesidad de declaración judicial.`);

    clause(doc, 8, 'FECHA DE CIERRE ESTIMADA', `Las partes estiman que la escrituración definitiva se realizará, como máximo, el ${closingDate}.`);

    clause(doc, 9, 'JURISDICCIÓN', `Para la interpretación y cumplimiento, las partes se someten a las leyes y tribunales del Estado de ${p.estado ?? 'México'}.`);

    if (offer.message) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Oblique').fontSize(9).text(`Nota del comprador: "${offer.message}"`, { align: 'justify' });
    }

    doc.addPage();
    doc.font('Helvetica').fontSize(10).text('Leído el presente instrumento y enteradas las partes de su contenido y alcance legal, lo firman de conformidad.', { align: 'justify' });

    signatureBlock(doc, `EL PROMITENTE VENDEDOR\n${seller.name}`, `EL PROMITENTE COMPRADOR\n${offer.buyerName}`);

    doc.fontSize(8).fillColor('grey').text('Contrato generado por Casa-MX.com · Plataforma de bienes raíces · México', { align: 'center' });

    doc.end();
  });
}

