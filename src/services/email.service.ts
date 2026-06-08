import { Resend } from "resend";
import { env } from "../config/env.js";

let resend: Resend | null = null;

function client(): Resend | null {
  if (resend) return resend;
  if (!env.RESEND_API_KEY) return null;
  resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

export function isConfigured(): boolean {
  return Boolean(
    env.RESEND_API_KEY && !env.RESEND_API_KEY.startsWith("re_placeholder"),
  );
}

export async function verifyConnection(): Promise<{
  ok: boolean;
  error?: string;
  domain?: string;
  domainStatus?: string;
}> {
  if (!isConfigured()) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  try {
    const r = client();
    if (!r) return { ok: false, error: "Failed to initialize Resend client" };
    // Check API key is valid by listing domains (lightweight probe).
    // Domain verification status is best-effort — some API keys may not
    // have permission to list domains, which is non-fatal (emails still send).
    const fromDomain = env.RESEND_FROM_EMAIL.split("@")[1];
    try {
      const domains: any = await r.domains.list();
      // Response: { data: { data: Domain[] }, error: null } | { data: null, error: ErrorResponse }
      if (domains?.error) {
        return {
          ok: true,
          error: `Resend API key works but domain listing failed: ${domains.error.message || "unknown"}`,
          domain: fromDomain,
          domainStatus: "unknown",
        };
      }
      const payload: any = domains?.data;
      const list: any[] = payload?.data ?? payload ?? [];
      if (Array.isArray(list)) {
        const found = list.find((d: any) => d.name === fromDomain);
        if (!found) {
          return {
            ok: true,
            error: `Domain ${fromDomain} not found in Resend domain list (may need to be added)`,
            domain: fromDomain,
            domainStatus: "not_in_list",
          };
        }
        if (found.status !== "verified") {
          return {
            ok: false,
            error: `Domain ${fromDomain} status is "${found.status}", expected "verified"`,
            domain: fromDomain,
            domainStatus: found.status,
          };
        }
        return { ok: true, domain: fromDomain, domainStatus: found.status };
      }
    } catch (listErr: any) {
      // Domain listing failed but API key works — non-fatal
      return {
        ok: true,
        error: `Domain check skipped: ${listErr?.message || "unknown error"}`,
        domain: fromDomain,
        domainStatus: "unknown",
      };
    }
    // Fallback: key is configured, don't block startup
    return { ok: true, domain: fromDomain, domainStatus: "not_checked" };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
) {
  const r = client();
  if (!r) {
    console.error(
      "[email] RESEND_API_KEY not set — CRITICAL: email not sent to",
      to,
      "| subject:",
      subject,
    );
    return;
  }
  try {
    const result = await r.emails.send({
      from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
      to,
      subject,
      html,
      text,
    });
    if (result.error) {
      console.error(
        "[email] Resend delivery error:",
        JSON.stringify(result.error),
        "| to:",
        to,
        "| subject:",
        subject,
      );
      throw new Error(
        `Failed to send email to ${to}: ${result.error.message || "Unknown delivery error"}`,
      );
    }
    console.log(
      "[email] Sent successfully to",
      to,
      "| subject:",
      subject,
      "| id:",
      result.data?.id,
    );
  } catch (err: any) {
    console.error(
      "[email] Resend error:",
      err?.message ?? err,
      "| to:",
      to,
      "| subject:",
      subject,
    );
    throw new Error(
      `Failed to send email to ${to}: ${err?.message ?? "Unknown error"}`,
    );
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
  <div class="header"><h1>CasaMX</h1><p>Plataforma inmobiliaria de México</p></div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">© ${new Date().getFullYear()} CasaMX · Este correo es automático, no responder.</div>
</div></body></html>`;
}

// ── Offer notifications ───────────────────────────────────────────────────────

export async function sendOfferAcceptedEmail(opts: {
  buyerEmail: string;
  buyerName: string;
  propertyTitle: string;
  offeredAmount: number;
}) {
  const subject = `✅ Tu oferta fue aceptada — ${opts.propertyTitle}`;
  const amountFmt = opts.offeredAmount.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>¡Felicidades, ${opts.buyerName}!</h2>
    <p>El vendedor ha <strong>aceptado</strong> tu oferta de compra.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Monto aceptado:</strong> $${amountFmt} MXN
    </div>
    <p>Inicia sesión en CasaMX para descargar tu contrato de compraventa.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/offers">Ver mis ofertas</a>
    <p>Si tienes dudas, contacta a tu agente o al soporte de CasaMX.</p>
  `,
  );
  const text = `¡Felicidades! Tu oferta de $${amountFmt} MXN para "${opts.propertyTitle}" fue aceptada. Entra a ${env.FRONTEND_URL}/dashboard/offers para descargar tu contrato.`;
  await sendEmail(opts.buyerEmail, subject, html, text);
}

export async function sendOfferRejectedEmail(opts: {
  buyerEmail: string;
  buyerName: string;
  propertyTitle: string;
  offeredAmount: number;
}) {
  const subject = `Tu oferta no fue aceptada — ${opts.propertyTitle}`;
  const amountFmt = opts.offeredAmount.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.buyerName}</h2>
    <p>El vendedor ha <strong>rechazado</strong> tu oferta de compra.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Monto ofertado:</strong> $${amountFmt} MXN
    </div>
    <p>No te desanimes — hay muchas otras propiedades disponibles en CasaMX.</p>
    <a class="btn" href="${env.FRONTEND_URL}/properties">Explorar propiedades</a>
  `,
  );
  const text = `Tu oferta de $${amountFmt} MXN para "${opts.propertyTitle}" fue rechazada. Explora más propiedades en ${env.FRONTEND_URL}/properties`;
  await sendEmail(opts.buyerEmail, subject, html, text);
}

export async function sendOfferCounteredEmail(opts: {
  buyerEmail: string;
  buyerName: string;
  propertyTitle: string;
  counterAmount: number;
  sellerNote?: string;
}) {
  const subject = `💬 Contraoferta recibida — ${opts.propertyTitle}`;
  const amountFmt = opts.counterAmount.toLocaleString("es-MX");
  const noteHtml = opts.sellerNote
    ? `<p><em>Nota del vendedor: "${opts.sellerNote}"</em></p>`
    : "";
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.buyerName}</h2>
    <p>El vendedor ha enviado una <strong>contraoferta</strong> para tu solicitud de compra.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Contraoferta:</strong> $${amountFmt} MXN
    </div>
    ${noteHtml}
    <p>Entra a CasaMX para revisar y responder.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/offers">Ver mi oferta</a>
  `,
  );
  const text = `Contraoferta de $${amountFmt} MXN para "${opts.propertyTitle}". Revísala en ${env.FRONTEND_URL}/dashboard/offers`;
  await sendEmail(opts.buyerEmail, subject, html, text);
}

export async function sendOfferReceivedEmail(opts: {
  sellerEmail: string;
  sellerName: string;
  propertyTitle: string;
  offeredAmount: number;
  buyerName: string;
}) {
  const subject = `🏷️ Nueva oferta recibida — ${opts.propertyTitle}`;
  const amountFmt = opts.offeredAmount.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.sellerName}</h2>
    <p><strong>${opts.buyerName}</strong> ha enviado una oferta de compra para tu propiedad.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Monto ofertado:</strong> $${amountFmt} MXN
    </div>
    <p>Entra a CasaMX para aceptar, rechazar o contra-ofertar.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/offers">Responder oferta</a>
  `,
  );
  const text = `${opts.buyerName} hizo una oferta de $${amountFmt} MXN por "${opts.propertyTitle}". Respóndela en ${env.FRONTEND_URL}/dashboard/offers`;
  await sendEmail(opts.sellerEmail, subject, html, text);
}

// ── Rental application notifications ─────────────────────────────────────────

export async function sendApplicationApprovedEmail(opts: {
  tenantEmail: string;
  tenantName: string;
  propertyTitle: string;
  monthlyRent: number;
}) {
  const subject = `✅ Tu solicitud fue aprobada — ${opts.propertyTitle}`;
  const rentFmt = opts.monthlyRent.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>¡Felicidades, ${opts.tenantName}!</h2>
    <p>El arrendador ha <strong>aprobado</strong> tu solicitud de arrendamiento.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Renta mensual:</strong> $${rentFmt} MXN/mes
    </div>
    <p>Entra a CasaMX para descargar tu contrato de arrendamiento.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/rental-applications">Ver mi solicitud</a>
  `,
  );
  const text = `Tu solicitud para "${opts.propertyTitle}" fue aprobada (renta $${rentFmt}/mes). Descarga tu contrato en ${env.FRONTEND_URL}/dashboard/rental-applications`;
  await sendEmail(opts.tenantEmail, subject, html, text);
}

export async function sendApplicationRejectedEmail(opts: {
  tenantEmail: string;
  tenantName: string;
  propertyTitle: string;
}) {
  const subject = `Tu solicitud no fue aprobada — ${opts.propertyTitle}`;
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.tenantName}</h2>
    <p>El arrendador ha decidido no continuar con tu solicitud para esta propiedad.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}
    </div>
    <p>No te desanimes — hay muchas otras propiedades en renta disponibles.</p>
    <a class="btn" href="${env.FRONTEND_URL}/properties?type=for_rent">Buscar propiedades en renta</a>
  `,
  );
  const text = `Tu solicitud para "${opts.propertyTitle}" no fue aprobada. Explora más en ${env.FRONTEND_URL}/properties?type=for_rent`;
  await sendEmail(opts.tenantEmail, subject, html, text);
}

export async function sendApplicationReceivedEmail(opts: {
  landlordEmail: string;
  landlordName: string;
  propertyTitle: string;
  tenantName: string;
}) {
  const subject = `📋 Nueva solicitud de arrendamiento — ${opts.propertyTitle}`;
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.landlordName}</h2>
    <p><strong>${opts.tenantName}</strong> ha enviado una solicitud de arrendamiento para tu propiedad.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}
    </div>
    <p>Entra a CasaMX para revisar su perfil y responder.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/applications">Revisar solicitud</a>
  `,
  );
  const text = `${opts.tenantName} solicitó arrendar "${opts.propertyTitle}". Revísalo en ${env.FRONTEND_URL}/dashboard/applications`;
  await sendEmail(opts.landlordEmail, subject, html, text);
}

// ── Account verification ──────────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  userEmail: string;
  userName: string;
  token: string;
}) {
  const subject = "Confirma tu correo electrónico — CasaMX";
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${opts.token}`;
  const html = wrap(
    subject,
    `
    <h2>Bienvenido a CasaMX, ${opts.userName}!</h2>
    <p>Gracias por registrarte. Por favor confirma tu dirección de correo electrónico para activar todas las funciones de tu cuenta.</p>
    <a class="btn" href="${verifyUrl}">Confirmar correo electrónico</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Este enlace expira en <strong>24 horas</strong>. Si no creaste esta cuenta, puedes ignorar este mensaje.</p>
    <p style="font-size:12px;color:#9ca3af;word-break:break-all;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${verifyUrl}</p>
  `,
  );
  const text = `Bienvenido a CasaMX, ${opts.userName}! Confirma tu correo aquí: ${verifyUrl} (válido 24 horas)`;
  await sendEmail(opts.userEmail, subject, html, text);
}

export async function sendVerificationApprovedEmail(opts: {
  sellerEmail: string;
  sellerName: string;
  propertyTitle: string;
}) {
  const subject = "Tu propiedad fue verificada y publicada — CasaMX";
  const dashboardUrl = `${env.FRONTEND_URL}/dashboard`;
  const html = wrap(
    subject,
    `
    <h2>¡Tu propiedad fue aprobada! ✅</h2>
    <p>Hola ${opts.sellerName},</p>
    <p>Nos complace informarte que hemos verificado tu propiedad <strong>${opts.propertyTitle}</strong> y ha sido publicada.</p>
    <p>Tu anuncio es ahora visible para compradores e inquilinos interesados. Puedes gestionar tu listado desde tu dashboard.</p>
    <a class="btn" href="${dashboardUrl}">Ver mi dashboard</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Si tienes preguntas, no dudes en contactarnos.</p>
  `,
  );
  const text = `Tu propiedad ${opts.propertyTitle} fue aprobada y publicada. Ingresa a tu dashboard: ${dashboardUrl}`;
  await sendEmail(opts.sellerEmail, subject, html, text);
}

export async function sendVerificationRejectedEmail(opts: {
  sellerEmail: string;
  sellerName: string;
  propertyTitle: string;
  note: string;
}) {
  const subject = "Tu propiedad requiere documentación adicional — CasaMX";
  const dashboardUrl = `${env.FRONTEND_URL}/dashboard`;
  const html = wrap(
    subject,
    `
    <h2>Documentación insuficiente</h2>
    <p>Hola ${opts.sellerName},</p>
    <p>Hemos revisado los documentos de tu propiedad <strong>${opts.propertyTitle}</strong> pero necesitamos información adicional:</p>
    <p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:15px 0;"><strong>Motivo:</strong> ${opts.note || "Los documentos proporcionados no cumplieron con nuestros requisitos de verificación."}</p>
    <p>Por favor, sube documentos adicionales desde tu dashboard para que podamos publicar tu propiedad.</p>
    <a class="btn" href="${dashboardUrl}">Ir a mi dashboard</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Si tienes dudas, contáctanos.</p>
  `,
  );
  const text = `Tu propiedad ${opts.propertyTitle} requiere documentación adicional. Motivo: ${opts.note || "Documentos insuficientes"}\n\nIngresa aquí: ${dashboardUrl}`;
  await sendEmail(opts.sellerEmail, subject, html, text);
}

export async function sendPasswordResetEmail(opts: {
  userEmail: string;
  userName: string;
  token: string;
}) {
  const subject = "Restablecer contraseña — CasaMX";
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${opts.token}`;
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.userName}</h2>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
    <a class="btn" href="${resetUrl}">Restablecer contraseña</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Este enlace expira en <strong>1 hora</strong>. Si no solicitaste esto, puedes ignorar este mensaje.</p>
  `,
  );
  const text = `Restablece tu contraseña aquí: ${resetUrl} (válido 1 hora)`;
  await sendEmail(opts.userEmail, subject, html, text);
}

// ── Payment confirmation ──────────────────────────────────────────────────────

export async function sendPaymentConfirmationEmail(opts: {
  userEmail: string;
  userName: string;
  packageName: string;
  credits: number;
  amount: number;
  transactionDate: string;
}) {
  const subject = "Confirmación de compra — CasaMX";
  const amountFmt = opts.amount.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
  });
  const date = new Date(opts.transactionDate).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const html = wrap(
    subject,
    `
    <h2>¡Gracias por tu compra, ${opts.userName}!</h2>
    <p>Tu pago ha sido procesado exitosamente.</p>
    <div class="highlight">
      <strong>Paquete:</strong> ${opts.packageName}<br>
      <strong>Créditos:</strong> ${opts.credits}<br>
      <strong>Monto:</strong> $${amountFmt} MXN<br>
      <strong>Fecha:</strong> ${date}
    </div>
    <p>Tus créditos ya están disponibles en tu cuenta. Puedes usarlos para publicar y destacar propiedades.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/credits">Ver mis créditos</a>
  `,
  );
  const text = `Compra confirmada: ${opts.packageName} (${opts.credits} créditos) por $${amountFmt} MXN. Tus créditos ya están disponibles en ${env.FRONTEND_URL}/dashboard/credits`;
  await sendEmail(opts.userEmail, subject, html, text);
}

// ── Outbid notification ────────────────────────────────────────────────────────

export async function sendOfferOutbidEmail(opts: {
  buyerEmail: string;
  buyerName: string;
  propertyTitle: string;
  offeredAmount: number;
}) {
  const subject = `Tu oferta fue superada — ${opts.propertyTitle}`;
  const amountFmt = opts.offeredAmount.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.buyerName}</h2>
    <p>El vendedor ha aceptado otra oferta para la propiedad <strong>${opts.propertyTitle}</strong>.</p>
    <div class="highlight">
      <strong>Tu oferta:</strong> $${amountFmt} MXN
    </div>
    <p>No te desanimes — hay muchas otras propiedades disponibles en CasaMX.</p>
    <a class="btn" href="${env.FRONTEND_URL}/properties">Explorar propiedades</a>
  `,
  );
  const text = `Tu oferta de $${amountFmt} MXN para "${opts.propertyTitle}" fue superada. El vendedor aceptó otra oferta. Explora más en ${env.FRONTEND_URL}/properties`;
  await sendEmail(opts.buyerEmail, subject, html, text);
}

// ── Welcome ────────────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  userEmail: string;
  userName: string;
}) {
  const subject = "¡Bienvenido a CasaMX!";
  const html = wrap(
    subject,
    `
    <h2>¡Tu cuenta está verificada, ${opts.userName}!</h2>
    <p>Gracias por unirte a CasaMX, la plataforma inmobiliaria de México. Ahora puedes:</p>
    <ul style="text-align:left;padding-left:20px;line-height:2;">
      <li>🔍 Buscar y explorar propiedades en todo México</li>
      <li>💬 Contactar a vendedores y arrendadores</li>
      <li>🏠 Publicar tus propias propiedades</li>
      <li>📊 Gestionar ofertas y solicitudes desde tu dashboard</li>
    </ul>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard">Ir a mi dashboard</a>
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">Si tienes dudas, contáctanos — estamos para ayudarte.</p>
  `,
  );
  const text = `¡Bienvenido a CasaMX, ${opts.userName}! Tu cuenta está verificada. Ingresa a ${env.FRONTEND_URL}/dashboard para comenzar.`;
  await sendEmail(opts.userEmail, subject, html, text);
}

// ── Login alert ────────────────────────────────────────────────────────────────

export async function sendNewLoginAlert(opts: {
  userEmail: string;
  userName: string;
  ip: string;
  userAgent: string;
  timestamp: string;
}) {
  const subject = "Nuevo inicio de sesión — CasaMX";
  const date = new Date(opts.timestamp).toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.userName}</h2>
    <p>Detectamos un nuevo inicio de sesión en tu cuenta de CasaMX.</p>
    <div class="highlight">
      <strong>Fecha y hora:</strong> ${date}<br>
      <strong>Dirección IP:</strong> ${opts.ip}<br>
      <strong>Dispositivo:</strong> ${opts.userAgent.slice(0, 100)}<br>
    </div>
    <p style="color:#dc2626;">Si no fuiste tú, cambia tu contraseña de inmediato.</p>
    <a class="btn" style="background:#dc2626;" href="${env.FRONTEND_URL}/reset-password">Restablecer contraseña</a>
  `,
  );
  const text = `Nuevo inicio de sesión en tu cuenta: ${date} desde IP ${opts.ip}. Si no fuiste tú, restablece tu contraseña en ${env.FRONTEND_URL}/reset-password`;
  await sendEmail(opts.userEmail, subject, html, text);
}

// ── Password changed ───────────────────────────────────────────────────────────

export async function sendPasswordChangedEmail(opts: {
  userEmail: string;
  userName: string;
}) {
  const subject = "Contraseña actualizada — CasaMX";
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.userName}</h2>
    <p>Tu contraseña ha sido actualizada exitosamente.</p>
    <p>Si no realizaste este cambio, contacta a soporte de inmediato.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard">Ir a mi dashboard</a>
  `,
  );
  const text = `Tu contraseña de CasaMX ha sido actualizada. Si no fuiste tú, contacta a soporte.`;
  await sendEmail(opts.userEmail, subject, html, text);
}

// ── Role management ────────────────────────────────────────────────────────────

export async function sendRoleApprovedEmail(opts: {
  userEmail: string;
  userName: string;
  roleName: string;
}) {
  const roleLabel =
    opts.roleName === "seller" ? "Publicación de propiedades" : opts.roleName;
  const subject = "Solicitud de rol aprobada — CasaMX";
  const html = wrap(
    subject,
    `
    <h2>¡Buenas noticias, ${opts.userName}!</h2>
    <p>Tu solicitud para el rol <strong>${roleLabel}</strong> ha sido aprobada.</p>
    <p>Ahora puedes acceder a las funciones correspondientes desde tu dashboard.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard">Ir a mi dashboard</a>
  `,
  );
  const text = `Tu solicitud de rol "${roleLabel}" fue aprobada. Ingresa a ${env.FRONTEND_URL}/dashboard para comenzar.`;
  await sendEmail(opts.userEmail, subject, html, text);
}

export async function sendRoleDeniedEmail(opts: {
  userEmail: string;
  userName: string;
  roleName: string;
}) {
  const roleLabel =
    opts.roleName === "seller" ? "Publicación de propiedades" : opts.roleName;
  const subject = "Actualización de solicitud de rol — CasaMX";
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.userName}</h2>
    <p>Tu solicitud para el rol <strong>${roleLabel}</strong> no fue aprobada en esta ocasión.</p>
    <p>Si tienes dudas, puedes contactar a nuestro equipo de soporte.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard">Ir a mi dashboard</a>
  `,
  );
  const text = `Tu solicitud de rol "${roleLabel}" no fue aprobada. Ingresa a ${env.FRONTEND_URL}/dashboard para más información.`;
  await sendEmail(opts.userEmail, subject, html, text);
}

// ── Negotiations ───────────────────────────────────────────────────────────────

export async function sendNegotiationStartedEmail(opts: {
  landlordEmail: string;
  landlordName: string;
  propertyTitle: string;
  proposedRent: number;
  tenantName: string;
}) {
  const subject = "Nueva negociación iniciada — CasaMX";
  const rentFmt = opts.proposedRent.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.landlordName}</h2>
    <p><strong>${opts.tenantName}</strong> ha iniciado una negociación de renta para tu propiedad.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Renta propuesta:</strong> $${rentFmt} MXN/mes
    </div>
    <p>Entra a CasaMX para revisar y responder.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/rental-applications">Ver negociación</a>
  `,
  );
  const text = `${opts.tenantName} inició una negociación de $${rentFmt}/mes para "${opts.propertyTitle}". Revísala en ${env.FRONTEND_URL}/dashboard/rental-applications`;
  await sendEmail(opts.landlordEmail, subject, html, text);
}

export async function sendNegotiationCounterEmail(opts: {
  recipientEmail: string;
  recipientName: string;
  propertyTitle: string;
  proposedRent: number;
  authorName: string;
}) {
  const subject = "Contraoferta de renta — CasaMX";
  const rentFmt = opts.proposedRent.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.recipientName}</h2>
    <p><strong>${opts.authorName}</strong> ha enviado una contraoferta en la negociación de renta.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Renta propuesta:</strong> $${rentFmt} MXN/mes
    </div>
    <p>Entra a CasaMX para revisar y responder.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/rental-applications">Ver negociación</a>
  `,
  );
  const text = `${opts.authorName} contraofertó $${rentFmt}/mes para "${opts.propertyTitle}". Revísala en ${env.FRONTEND_URL}/dashboard/rental-applications`;
  await sendEmail(opts.recipientEmail, subject, html, text);
}

export async function sendNegotiationAcceptedEmail(opts: {
  recipientEmail: string;
  recipientName: string;
  propertyTitle: string;
  finalRent: number;
  authorName: string;
}) {
  const subject = "¡Negociación aceptada! — CasaMX";
  const rentFmt = opts.finalRent.toLocaleString("es-MX");
  const html = wrap(
    subject,
    `
    <h2>¡Felicidades, ${opts.recipientName}!</h2>
    <p><strong>${opts.authorName}</strong> ha aceptado tu propuesta de renta.</p>
    <div class="highlight">
      <strong>Propiedad:</strong> ${opts.propertyTitle}<br>
      <strong>Renta acordada:</strong> $${rentFmt} MXN/mes
    </div>
    <p>Entra a CasaMX para descargar tu contrato y continuar con el proceso.</p>
    <a class="btn" href="${env.FRONTEND_URL}/dashboard/rental-applications">Ver negociación</a>
  `,
  );
  const text = `¡Tu propuesta de $${rentFmt}/mes para "${opts.propertyTitle}" fue aceptada! Descarga tu contrato en ${env.FRONTEND_URL}/dashboard/rental-applications`;
  await sendEmail(opts.recipientEmail, subject, html, text);
}

export async function sendNegotiationRejectedEmail(opts: {
  recipientEmail: string;
  recipientName: string;
  propertyTitle: string;
  authorName: string;
}) {
  const subject = "Negociación cerrada — CasaMX";
  const html = wrap(
    subject,
    `
    <h2>Hola, ${opts.recipientName}</h2>
    <p><strong>${opts.authorName}</strong> ha rechazado tu propuesta de renta para <strong>${opts.propertyTitle}</strong>.</p>
    <p>Puedes explorar otras propiedades en renta disponibles en CasaMX.</p>
    <a class="btn" href="${env.FRONTEND_URL}/properties?type=for_rent">Buscar propiedades en renta</a>
  `,
  );
  const text = `Tu propuesta para "${opts.propertyTitle}" fue rechazada. Explora más rentas en ${env.FRONTEND_URL}/properties?type=for_rent`;
  await sendEmail(opts.recipientEmail, subject, html, text);
}
