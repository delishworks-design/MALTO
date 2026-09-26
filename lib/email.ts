import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret } from "@/lib/crypto";

const BRAND = "#202421";
const GRAY = "#626A63";
const SAGE = "#526B5D";
const BORDER = "#DDDCD6";
const IVORY = "#F7F5F0";

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  password: string;
  hasPassword: boolean;
};

export type QuoteEmailInput = {
  to: string;
  name: string;
  bookingRef: string;
  serviceName: string;
  date: string;
  price: number;
  notes?: string | null;
};

/** Reads SMTP settings + the encrypted password using the service role. */
export async function loadEmailConfig(): Promise<EmailConfig> {
  const admin = supabaseAdmin();

  const [{ data: settings, error: e1 }, { data: secret, error: e2 }] = await Promise.all([
    admin.from("email_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("email_secret").select("pass_encrypted").eq("id", 1).maybeSingle(),
  ]);
  if (e1) throw new Error(`Could not read email settings: ${e1.message}`);
  if (e2) throw new Error(`Could not read email credentials: ${e2.message}`);
  if (!settings) throw new Error("No SMTP settings configured. Save them under Settings → Email.");

  const stored = String(secret?.pass_encrypted ?? "");
  let password = "";
  if (stored) {
    password = decryptSecret(stored);
  }

  return {
    host: settings.smtp_host,
    port: Number(settings.smtp_port) || 465,
    secure: settings.smtp_secure !== false,
    user: settings.smtp_user,
    fromName: settings.from_name || "MALTO Cleaning Services",
    fromEmail: settings.from_email,
    replyTo: settings.reply_to,
    password,
    hasPassword: password.length > 0,
  };
}

export async function hasStoredPassword(): Promise<boolean> {
  const cfg = await loadEmailConfig();
  return cfg.hasPassword;
}

function transport(cfg: EmailConfig) {
  if (!cfg.host) throw new Error("SMTP host is empty. Save your SMTP settings first.");
  if (!cfg.user) throw new Error("SMTP username is empty. Save your SMTP settings first.");
  if (!cfg.password) {
    throw new Error("No SMTP password stored. Save one under Settings → Email (use a Gmail App Password).");
  }
  const options: SMTPTransport.Options = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
  };
  return nodemailer.createTransport(options);
}

export function fromHeader(cfg: EmailConfig): string {
  const addr = cfg.fromEmail || cfg.user;
  return `${cfg.fromName} <${addr}>`;
}

export async function sendMail(
  cfg: EmailConfig,
  payload: { to: string; subject: string; html: string; text?: string; replyTo?: string }
): Promise<{ messageId: string }> {
  const info = await transport(cfg).sendMail({
    from: fromHeader(cfg),
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    replyTo: payload.replyTo || cfg.replyTo || undefined,
  });
  return { messageId: String(info.messageId ?? "") };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

const footer = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:34px;border-top:1px solid ${BORDER};">
    <tr><td style="padding:20px 0;font:11px Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${GRAY};">
      MALTO CLEANING SERVICES · A Better Standard of Clean.
    </td></tr>
  </table>`;

const shell = (title: string, body: string) => `
<div style="background:${IVORY};padding:28px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${BORDER};">
        <tr><td style="padding:30px 34px 8px;">
          <div style="font:11px Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:${SAGE};">MALTO CLEANING SERVICES</div>
          <div style="font:26px Georgia,'Times New Roman',serif;color:${BRAND};margin-top:12px;">${title}</div>
        </td></tr>
        <tr><td style="padding:14px 34px 30px;font:15px/1.7 Arial,Helvetica,sans-serif;color:${GRAY};">${body}</td></tr>
        <tr><td style="padding:0 34px 26px;">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</div>`;

const money = (n: number) => `₱${Math.round(Number(n) || 0).toLocaleString("en-PH")}`;

const rows = (pairs: [string, string][]) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid ${BORDER};">
    ${pairs
      .map(
        ([k, v]) => `<tr>
          <td style="padding:11px 16px;border-bottom:1px solid ${BORDER};font:12px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${GRAY};background:${IVORY};">${k}</td>
          <td style="padding:11px 16px;border-bottom:1px solid ${BORDER};font:15px Arial,sans-serif;color:${BRAND};">${v || "—"}</td>
        </tr>`
      )
      .join("")}
  </table>`;

const btn = (href: string, label: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 6px;">
    <tr><td style="background:${BRAND};">
      <a href="${href}" style="display:inline-block;padding:15px 26px;font:12px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#FFFFFF;text-decoration:none;">${label}</a>
    </td></tr>
  </table>`;

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtDate = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};

const siteUrl = () => {
  const custom = process.env.NEXT_PUBLIC_SITE_URL;
  if (custom) return custom.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return "https://malto-cleaning-services.vercel.app";
};

/* -------------------------------------------------------------------------- */
/* Public senders                                                             */
/* -------------------------------------------------------------------------- */

export type NewBooking = {
  booking_ref: string | null;
  names: string | null;
  email: string | null;
  phone: string | null;
  services: string | null;
  date: string | null;
  time: string | null;
  adress: string | null;
  city: string | null;
  property: string | null;
  notes: string | null;
  created_at?: string;
};

/** Email 1 of 2 — fired by the Supabase webhook when a booking is created. */
export async function sendAdminAlert(booking: NewBooking, toOverride?: string): Promise<{ to: string }> {
  const cfg = await loadEmailConfig();
  const to = toOverride || cfg.replyTo || cfg.fromEmail || cfg.user;
  if (!to) throw new Error("No recipient configured for the admin alert (set Reply-To in Settings).");

  const subject = `New booking request${booking.booking_ref ? ` · ${booking.booking_ref}` : ""}`;
  const html = shell(
    "New booking request",
    `<p>A new request just arrived on the website.</p>
     ${rows([
       ["Request ID", esc(booking.booking_ref)],
       ["Customer", esc(booking.names)],
       ["Email", esc(booking.email)],
       ["Phone", esc(booking.phone)],
       ["Service", esc(booking.services)],
       ["Preferred date", esc(fmtDate(booking.date))],
       ["Preferred time", esc(booking.time)],
       ["Address", esc(booking.adress)],
       ["City / Province", esc([booking.city].filter(Boolean).join(", "))],
       ["Property", esc(booking.property)],
       ["Customer notes", esc(booking.notes)],
     ])}
     <p style="font-size:14px;">Review it in the dashboard, set the final price and send the quote to the customer.</p>
     ${btn(`${siteUrl()}/admin`, "Open dashboard")}`
  );

  await sendMail(cfg, { to, subject, html });
  return { to };
}

/** Email 2 of 2 — final price + confirmation, sent by the admin from the dashboard. */
export async function sendQuoteEmail(input: QuoteEmailInput): Promise<{ to: string }> {
  const cfg = await loadEmailConfig();
  if (!input.to) throw new Error("This booking has no email address, so the quote cannot be sent.");

  const subject = `Your MALTO quote is ready${input.bookingRef ? ` · ${input.bookingRef}` : ""}`;
  const html = shell(
    "Your final price",
    `<p>Hi ${esc(input.name || "there")},</p>
     <p>Thank you for booking with MALTO. We have reviewed your request and this is your final quote:</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid ${BORDER};background:${IVORY};">
       <tr>
         <td style="padding:22px 24px;">
           <div style="font:11px Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:${GRAY};">FINAL PRICE</div>
           <div style="font:34px Georgia,'Times New Roman',serif;color:${BRAND};margin-top:6px;">${money(input.price)}</div>
         </td>
       </tr>
     </table>
     ${rows([
       ["Request ID", esc(input.bookingRef)],
       ["Service", esc(input.serviceName)],
       ["Scheduled date", esc(fmtDate(input.date))],
     ])}
     <p style="font-size:14px;">Your booking is now confirmed. If anything about the job changes, just reply to this email and we will re-check the scope.</p>
     ${input.notes ? `<p style="font-size:14px;"><strong>A note from the team:</strong> ${esc(input.notes)}</p>` : ""}
     ${btn(`${siteUrl()}/book`, "Book another cleaning")}`
  );

  await sendMail(cfg, { to: input.to, subject, html });
  return { to: input.to };
}

/** Sent to the customer the moment a booking lands, so they are not left
 *  guessing. Deliberately carries no price and no rates: the final quote is a
 *  separate email the admin sends after review. */
export async function sendBookingReceived(booking: NewBooking): Promise<{ to: string }> {
  const cfg = await loadEmailConfig();
  const to = (booking.email ?? "").trim();
  if (!to) throw new Error("This booking has no email address, so no acknowledgement was sent.");

  const subject = `We received your booking${booking.booking_ref ? ` · ${booking.booking_ref}` : ""}`;
  const html = shell(
    "We received your booking",
    `<p>Hi ${esc(booking.names || "there")},</p>
     <p>Thank you for booking with MALTO. We have your request and will review the details before confirming the price.</p>
     ${rows([
       ["Request ID", esc(booking.booking_ref)],
       ["Service", esc(booking.services)],
       ["Preferred date", esc(fmtDate(booking.date))],
       ["Preferred time", esc(booking.time)],
       ["Address", esc(booking.adress)],
       ["City / Province", esc([booking.city].filter(Boolean).join(", "))],
       ["Property", esc(booking.property)],
     ])}
     <p style="font-size:14px;">We will email you again shortly with your final price. Nothing to pay yet.</p>
     ${btn(`${siteUrl()}/book`, "Book another cleaning")}`
  );

  await sendMail(cfg, { to, subject, html });
  return { to };
}

/** Small smoke test used from Settings → Email. */
export async function sendTestEmail(to: string): Promise<{ to: string }> {
  const cfg = await loadEmailConfig();
  const subject = "MALTO email test — this is working";
  const html = shell(
    "Email is configured",
    `<p>This is a test message from the MALTO admin dashboard.</p>
     ${rows([
       ["SMTP host", esc(cfg.host)],
       ["Port", esc(`${cfg.port}${cfg.secure ? " (SSL)" : ""}`)],
       ["Username", esc(cfg.user)],
       ["From", esc(fromHeader(cfg))],
       ["Reply-To", esc(cfg.replyTo)],
     ])}
     <p style="font-size:14px;">If you are reading this, booking confirmations and quotes will send correctly.</p>`
  );
  await sendMail(cfg, { to, subject, html });
  return { to };
}
