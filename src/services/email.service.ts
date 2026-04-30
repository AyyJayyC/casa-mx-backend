import sgMail from '@sendgrid/mail';
import { env } from '../config/env.js';

let initialized = false;

function init() {
  if (initialized) return;
  if (!env.SENDGRID_API_KEY) return;
  sgMail.setApiKey(env.SENDGRID_API_KEY);
  initialized = true;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  init();
  if (!env.SENDGRID_API_KEY) {
    console.warn('[email] SENDGRID_API_KEY not set — skipping email to', to);
    return;
  }
  try {
    await sgMail.send({
      to,
      from: { email: env.SENDGRID_FROM_EMAIL!, name: env.SENDGRID_FROM_NAME! },
      subject,
      html,
      text,
    });
  } catch (err: any) {
    console.error('[email] SendGrid error:', err?.response?.body ?? err);
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

function wrap(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f5f5; margin:0; padding:0; }
  .container { max-width:600px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .header { background:linear-gradient(135deg,#f59e0b,#ca8a04); padding:32px 40px; }
  .header h1 { color:#fff; margin:0; font-size:24px; }
  .header p { color:rgba(255,255,255,.85); margin:4px 0 0; font-size:14px; }
  .body { padding:32px 40px; color:#374151; font-size:15px; line-height:1.6; }
  .body h2 { color:#111827; font-size:18px; margin:0 0 12px; }
  .highlight { background:#fefce8; border:1px solid #fde047; border-radius:8px; padding:16px 20px; margin:20px 0; }
  .highlight strong { color:#854d0e; }
  .btn { display:inline-block; background:linear-gradient(135deg,#f59e0b,#ca8a04); color:#fff !important; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; font-size:15px; margin:20px 0; }
  .footer { padding:20px 40px; background:#f9fafb; border-top:1px solid #e5e7eb; font-size:12px; color:#9ca3af; text-align:center; }
</style></head><body>
<div class="container">
  <div class="header"><img src="${env.FRONTEND_URL}/brand/logo-primary@2x.png" alt="Casa-MX.com" width="220" height="73" style="display:block;max-width:220px;width:100%;height:auto;"><p>Plataforma inmobiliaria de México</p></div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">© ${new Date().getFullYear()} Casa-MX.com · Este correo es automático, no responder.</div>
</div></body></html>`;
}

// ── Offer notifications ───────────────────────────────────────────────────────

export async function sendOfferAcceptedEmail(opts: {
  buyerEmail: string; buyerName: string;
  propertyTitle: string; offeredAmount: number;
}) {
  const subject = `✅ Tu oferta fue aceptada — ${opts.propertyTitle}`;
  const amountFmt = opts.offeredAmount.toLocaleString('es-MX');
  const html = wrap(subject, `
    <h2>¡Felicidades, ${opts.buyerName}!</h2>
    <p>El vendedor ha <strong>aceptado</strong> tu oferta de compra.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Monto aceptado:</strong> $${amountFmt} MXN
    </div>
    <p>Inicia sesión en Casa-MX.com para descargar tu contrato de compraventa.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/offers">Ver mis ofertas</a>
    <p>Si tienes dudas, contacta a tu agente o al soporte de Casa-MX.com.</p>
  `);
  const text = `¡Felicidades! Tu oferta de $${amountFmt} MXN para "${opts.propertyTitle}" fue aceptada. Entra a ${env.FRONTEND_URL}/dashboard/offers para descargar tu contrato.`;
  await sendEmail(opts.buyerEmail, subject, html, text);
}

export async function sendOfferRejectedEmail(opts: {
  buyerEmail: string; buyerName: string;
  propertyTitle: string; offeredAmount: number;
}) {
  const subject = `Tu oferta no fue aceptada — ${opts.propertyTitle}`;
  const amountFmt = opts.offeredAmount.toLocaleString('es-MX');
  const html = wrap(subject, `
    <h2>Hola, ${opts.buyerName}</h2>
    <p>El vendedor ha <strong>rechazado</strong> tu oferta de compra.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Monto ofertado:</strong> $${amountFmt} MXN
    </div>
    <p>No te desanimes — hay muchas otras propiedades disponibles en Casa-MX.com.</p>
    <a class="btn" href="${env.FRONTEND_URL}/properties">Explorar propiedades</a>
  `);
  const text = `Tu oferta de $${amountFmt} MXN para "${opts.propertyTitle}" fue rechazada. Explora más propiedades en ${env.FRONTEND_URL}/properties`;
  await sendEmail(opts.buyerEmail, subject, html, text);
}

export async function sendOfferCounteredEmail(opts: {
  buyerEmail: string; buyerName: string;
  propertyTitle: string; counterAmount: number; sellerNote?: string;
}) {
  const subject = `💬 Contraoferta recibida — ${opts.propertyTitle}`;
  const amountFmt = opts.counterAmount.toLocaleString('es-MX');
  const noteHtml = opts.sellerNote ? `<p><em>Nota del vendedor: "${opts.sellerNote}"</em></p>` : '';
  const html = wrap(subject, `
    <h2>Hola, ${opts.buyerName}</h2>
    <p>El vendedor ha enviado una <strong>contraoferta</strong> para tu solicitud de compra.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Contraoferta:</strong> $${amountFmt} MXN
    </div>
    ${noteHtml}
    <p>Entra a Casa-MX.com para revisar y responder.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/offers">Ver mi oferta</a>
  `);
  const text = `Contraoferta de $${amountFmt} MXN para "${opts.propertyTitle}". Revísala en ${env.FRONTEND_URL}/dashboard/offers`;
  await sendEmail(opts.buyerEmail, subject, html, text);
}

export async function sendOfferReceivedEmail(opts: {
  sellerEmail: string; sellerName: string;
  propertyTitle: string; offeredAmount: number; buyerName: string;
}) {
  const subject = `🏷️ Nueva oferta recibida — ${opts.propertyTitle}`;
  const amountFmt = opts.offeredAmount.toLocaleString('es-MX');
  const html = wrap(subject, `
    <h2>Hola, ${opts.sellerName}</h2>
    <p><strong>${opts.buyerName}</strong> ha enviado una oferta de compra para tu propiedad.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Monto ofertado:</strong> $${amountFmt} MXN
    </div>
    <p>Entra a Casa-MX.com para aceptar, rechazar o contra-ofertar.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/offers">Responder oferta</a>
  `);
  const text = `${opts.buyerName} hizo una oferta de $${amountFmt} MXN por "${opts.propertyTitle}". Respóndela en ${env.FRONTEND_URL}/dashboard/offers`;
  await sendEmail(opts.sellerEmail, subject, html, text);
}

// ── Rental application notifications ─────────────────────────────────────────

export async function sendApplicationApprovedEmail(opts: {
  tenantEmail: string; tenantName: string;
  propertyTitle: string; monthlyRent: number;
}) {
  const subject = `✅ Tu solicitud fue aprobada — ${opts.propertyTitle}`;
  const rentFmt = opts.monthlyRent.toLocaleString('es-MX');
  const html = wrap(subject, `
    <h2>¡Felicidades, ${opts.tenantName}!</h2>
    <p>El arrendador ha <strong>aprobado</strong> tu solicitud de arrendamiento.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Renta mensual:</strong> $${rentFmt} MXN/mes
    </div>
    <p>Entra a Casa-MX.com para descargar tu contrato de arrendamiento.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/rental-applications">Ver mi solicitud</a>
  `);
  const text = `Tu solicitud para "${opts.propertyTitle}" fue aprobada (renta $${rentFmt}/mes). Descarga tu contrato en ${env.FRONTEND_URL}/dashboard/rental-applications`;
  await sendEmail(opts.tenantEmail, subject, html, text);
}

export async function sendApplicationRejectedEmail(opts: {
  tenantEmail: string; tenantName: string; propertyTitle: string;
}) {
  const subject = `Tu solicitud no fue aprobada — ${opts.propertyTitle}`;
  const html = wrap(subject, `
    <h2>Hola, ${opts.tenantName}</h2>
    <p>El arrendador ha decidido no continuar con tu solicitud para esta propiedad.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}
    </div>
    <p>No te desanimes — hay muchas otras propiedades en renta disponibles.</p>
    <a class="btn" href="${env.FRONTEND_URL}/properties?type=for_rent">Buscar propiedades en renta</a>
  `);
  const text = `Tu solicitud para "${opts.propertyTitle}" no fue aprobada. Explora más en ${env.FRONTEND_URL}/properties?type=for_rent`;
  await sendEmail(opts.tenantEmail, subject, html, text);
}

export async function sendApplicationReceivedEmail(opts: {
  landlordEmail: string; landlordName: string;
  propertyTitle: string; tenantName: string;
}) {
  const subject = `📋 Nueva solicitud de arrendamiento — ${opts.propertyTitle}`;
  const html = wrap(subject, `
    <h2>Hola, ${opts.landlordName}</h2>
    <p><strong>${opts.tenantName}</strong> ha enviado una solicitud de arrendamiento para tu propiedad.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}
    </div>
    <p>Entra a Casa-MX.com para revisar su perfil y responder.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/applications">Revisar solicitud</a>
  `);
  const text = `${opts.tenantName} solicitó arrendar "${opts.propertyTitle}". Revísalo en ${env.FRONTEND_URL}/dashboard/applications`;
  await sendEmail(opts.landlordEmail, subject, html, text);
}

// ── Account verification ──────────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  userEmail: string; userName: string; token: string;
}) {
  const subject = 'Confirma tu correo electrónico — Casa-MX.com';
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${opts.token}`;
  const html = wrap(subject, `
    <h2>Bienvenido a Casa-MX.com, ${opts.userName}!</h2>
    <p>Gracias por registrarte. Por favor confirma tu dirección de correo electrónico para activar todas las funciones de tu cuenta.</p>
    <a class="btn" href="${verifyUrl}">Confirmar correo electrónico</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Este enlace expira en <strong>24 horas</strong>. Si no creaste esta cuenta, puedes ignorar este mensaje.</p>
    <p style="font-size:12px;color:#9ca3af;word-break:break-all;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${verifyUrl}</p>
  `);
  const text = `Bienvenido a Casa-MX.com, ${opts.userName}! Confirma tu correo aquí: ${verifyUrl} (válido 24 horas)`;
  await sendEmail(opts.userEmail, subject, html, text);
}

export async function sendVerificationApprovedEmail(opts: {
  sellerEmail: string; sellerName: string; propertyTitle: string;
}) {
  const subject = 'Tu propiedad fue verificada y publicada — Casa-MX.com';
  const dashboardUrl = `${env.FRONTEND_URL}/dashboard`;
  const html = wrap(subject, `
    <h2>¡Tu propiedad fue aprobada! ✅</h2>
    <p>Hola ${opts.sellerName},</p>
    <p>Nos complace informarte que hemos verificado tu propiedad <strong>${opts.propertyTitle}</strong> y ha sido publicada.</p>
    <p>Tu anuncio es ahora visible para compradores e inquilinos interesados. Puedes gestionar tu listado desde tu dashboard.</p>
    <a class="btn" href="${dashboardUrl}">Ver mi dashboard</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Si tienes preguntas, no dudes en contactarnos.</p>
  `);
  const text = `Tu propiedad ${opts.propertyTitle} fue aprobada y publicada. Ingresa a tu dashboard: ${dashboardUrl}`;
  await sendEmail(opts.sellerEmail, subject, html, text);
}

export async function sendVerificationRejectedEmail(opts: {
  sellerEmail: string; sellerName: string; propertyTitle: string; note: string;
}) {
  const subject = 'Tu propiedad requiere documentación adicional — Casa-MX.com';
  const dashboardUrl = `${env.FRONTEND_URL}/dashboard`;
  const html = wrap(subject, `
    <h2>Documentación insuficiente</h2>
    <p>Hola ${opts.sellerName},</p>
    <p>Hemos revisado los documentos de tu propiedad <strong>${opts.propertyTitle}</strong> pero necesitamos información adicional:</p>
    <p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:15px 0;"><strong>Motivo:</strong> ${opts.note || 'Los documentos proporcionados no cumplieron con nuestros requisitos de verificación.'}</p>
    <p>Por favor, sube documentos adicionales desde tu dashboard para que podamos publicar tu propiedad.</p>
    <a class="btn" href="${dashboardUrl}">Ir a mi dashboard</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Si tienes dudas, contáctanos.</p>
  `);
  const text = `Tu propiedad ${opts.propertyTitle} requiere documentación adicional. Motivo: ${opts.note || 'Documentos insuficientes'}\n\nIngresa aquí: ${dashboardUrl}`;
  await sendEmail(opts.sellerEmail, subject, html, text);
}

export async function sendPasswordResetEmail(opts: {
  userEmail: string; userName: string; token: string;
}) {
  const subject = 'Restablecer contraseña — Casa-MX.com';
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${opts.token}`;
  const html = wrap(subject, `
    <h2>Hola, ${opts.userName}</h2>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
    <a class="btn" href="${resetUrl}">Restablecer contraseña</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Este enlace expira en <strong>1 hora</strong>. Si no solicitaste esto, puedes ignorar este mensaje.</p>
  `);
  const text = `Restablece tu contraseña aquí: ${resetUrl} (válido 1 hora)`;
  await sendEmail(opts.userEmail, subject, html, text);
}
