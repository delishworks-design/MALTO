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

/** Deliberately permissive, but it rejects the shape that actually bit us once:
 *  a reply_to typed as "nameagmail.com" with the @ missing, which is a real
 *  (undeliverable) domain rather than an obviously malformed string. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (v: unknown): v is string =>
  typeof v === "string" && EMAIL_RE.test(v.trim());

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

  // A malformed address here used to be honoured silently, which is how the
  // booking alert ended up going to a domain that does not exist. Fall back to
  // the authenticated account and complain loudly instead.
  const smtpUser = String(settings.smtp_user ?? "").trim();
  const clean = (raw: unknown, label: string): string => {
    const value = String(raw ?? "").trim();
    if (!value) return smtpUser;
    if (!isValidEmail(value)) {
      console.warn(
        `[email] Settings → Email: ${label} is not a valid address (${JSON.stringify(value)}). ` +
          `Using the SMTP username ${smtpUser} instead.`
      );
      return smtpUser;
    }
    return value;
  };

  return {
    host: settings.smtp_host,
    port: Number(settings.smtp_port) || 465,
    secure: settings.smtp_secure !== false,
    user: smtpUser,
    fromName: settings.from_name || "MALTO Cleaning Services",
    fromEmail: clean(settings.from_email, "From email"),
    replyTo: clean(settings.reply_to, "Reply-To"),
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

/** What every sender hands back. `response` is the SMTP server's own reply. */
export type SendResult = { to: string; response: string };

export function fromHeader(cfg: EmailConfig): string {
  const addr = cfg.fromEmail || cfg.user;
  return `${cfg.fromName} <${addr}>`;
}

export async function sendMail(
  cfg: EmailConfig,
  payload: { to: string; subject: string; html: string; text?: string; replyTo?: string }
): Promise<{ messageId: string; response: string; accepted: string[] }> {
  const info = await transport(cfg).sendMail({
    from: fromHeader(cfg),
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    replyTo: payload.replyTo || cfg.replyTo || undefined,
  });
  // The provider's own reply is the only evidence we get that the message was
  // accepted, so it is handed back and stored on the outbox row. Gmail accepts
  // first and bounces later, which is why "sent" alone was never proof.
  return {
    messageId: String(info.messageId ?? ""),
    response: String(info.response ?? ""),
    accepted: (info.accepted ?? []).map((a) => String(a)),
  };
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

/** Plain-text alternative to the HTML body.
 *  Every send was HTML-only, and a message with no text/plain part is one of
 *  the most reliable ways to get filtered into spam, so all four templates now
 *  ship both parts. */
const textVersion = (heading: string, lines: string[], link?: { href: string; label: string }) =>
  ["MALTO CLEANING SERVICES", "", heading, "", ...lines, "",
   ...(link ? [`${link.label}: ${link.href}`] : []),
   "",
   "Reply to this email if anything about your booking changes."].join("\n");

/** Same key/value pairs as rows(), flattened for the plain-text part. */
const textRows = (pairs: [string, string][]) => pairs.map(([k, v]) => `${k}: ${v || "—"}`);

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
export async function sendAdminAlert(booking: NewBooking, toOverride?: string): Promise<SendResult> {
  const cfg = await loadEmailConfig();
  const to = toOverride || cfg.replyTo || cfg.fromEmail || cfg.user;
  if (!to) throw new Error("No recipient configured for the admin alert (set Reply-To in Settings).");

  const subject = `New booking request${booking.booking_ref ? ` · ${booking.booking_ref}` : ""}`;
  // Built once and rendered twice: escaped for HTML, raw for the text part.
  const fields: [string, string][] = [
    ["Request ID", String(booking.booking_ref ?? "")],
    ["Customer", String(booking.names ?? "")],
    ["Email", String(booking.email ?? "")],
    ["Phone", String(booking.phone ?? "")],
    ["Service", String(booking.services ?? "")],
    ["Preferred date", fmtDate(booking.date)],
    ["Preferred time", String(booking.time ?? "")],
    ["Address", String(booking.adress ?? "")],
    ["City / Province", [booking.city].filter(Boolean).join(", ")],
    ["Property", String(booking.property ?? "")],
    ["Customer notes", String(booking.notes ?? "")],
  ];
  const dash = `${siteUrl()}/admin`;
  const html = shell(
    "New booking request",
    `<p>A new request just arrived on the website.</p>
     ${rows(fields.map(([k, v]) => [k, esc(v)] as [string, string]))}
     <p style="font-size:14px;">Review it in the dashboard, set the final price and send the quote to the customer.</p>
     ${btn(dash, "Open dashboard")}`
  );
  const text = textVersion(
    "New booking request",
    [
      "A new request just arrived on the website.",
      "",
      ...textRows(fields),
      "",
      "Review it in the dashboard, set the final price and send the quote to the customer.",
    ],
    { href: dash, label: "Open dashboard" }
  );

  const sent = await sendMail(cfg, { to, subject, html, text });
  return { to, response: sent.response };
}

/** Email 2 of 2 — final price + confirmation, sent by the admin from the dashboard. */
export async function sendQuoteEmail(input: QuoteEmailInput): Promise<SendResult> {
  const cfg = await loadEmailConfig();
  if (!input.to) throw new Error("This booking has no email address, so the quote cannot be sent.");

  const subject = `Your MALTO quote is ready${input.bookingRef ? ` · ${input.bookingRef}` : ""}`;
  const fields: [string, string][] = [
    ["Request ID", String(input.bookingRef ?? "")],
    ["Service", String(input.serviceName ?? "")],
    ["Scheduled date", fmtDate(input.date)],
  ];
  const book = `${siteUrl()}/book`;
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
     ${rows(fields.map(([k, v]) => [k, esc(v)] as [string, string]))}
     <p style="font-size:14px;">Your booking is now confirmed. If anything about the job changes, just reply to this email and we will re-check the scope.</p>
     ${input.notes ? `<p style="font-size:14px;"><strong>A note from the team:</strong> ${esc(input.notes)}</p>` : ""}
     ${btn(book, "Book another cleaning")}`
  );
  const text = textVersion(
    "Your final price",
    [
      `Hi ${input.name || "there"},`,
      "",
      "Thank you for booking with MALTO. We have reviewed your request and this is your final quote:",
      "",
      `FINAL PRICE: ${money(input.price)}`,
      "",
      ...textRows(fields),
      "",
      "Your booking is now confirmed. If anything about the job changes, just reply to this email and we will re-check the scope.",
      ...(input.notes ? ["", `A note from the team: ${input.notes}`] : []),
    ],
    { href: book, label: "Book another cleaning" }
  );

  const sent = await sendMail(cfg, { to: input.to, subject, html, text, replyTo: cfg.replyTo });
  return { to: input.to, response: sent.response };
}
/** Sent to the customer the moment a booking lands, so they are not left
 *  guessing. Deliberately carries no price and no rates: the final quote is a
 *  separate email the admin sends after review. */
export async function sendBookingReceived(booking: NewBooking): Promise<SendResult> {
  const cfg = await loadEmailConfig();
  const to = (booking.email ?? "").trim();
  if (!to) throw new Error("This booking has no email address, so no acknowledgement was sent.");

  const subject = `We received your booking${booking.booking_ref ? ` · ${booking.booking_ref}` : ""}`;
  const fields: [string, string][] = [
    ["Request ID", String(booking.booking_ref ?? "")],
    ["Service", String(booking.services ?? "")],
    ["Preferred date", fmtDate(booking.date)],
    ["Preferred time", String(booking.time ?? "")],
    ["Address", String(booking.adress ?? "")],
    ["City / Province", [booking.city].filter(Boolean).join(", ")],
    ["Property", String(booking.property ?? "")],
  ];
  const book = `${siteUrl()}/book`;
  const html = shell(
    "We received your booking",
    `<p>Hi ${esc(booking.names || "there")},</p>
     <p>Thank you for booking with MALTO. We have your request and will review the details before confirming the price.</p>
     ${rows(fields.map(([k, v]) => [k, esc(v)] as [string, string]))}
     <p style="font-size:14px;">We will email you again shortly with your final price. Nothing to pay yet.</p>
     ${btn(book, "Book another cleaning")}`
  );
  const text = textVersion(
    "We received your booking",
    [
      `Hi ${booking.names || "there"},`,
      "",
      "Thank you for booking with MALTO. We have your request and will review the details before confirming the price.",
      "",
      ...textRows(fields),
      "",
      "We will email you again shortly with your final price. Nothing to pay yet.",
    ],
    { href: book, label: "Book another cleaning" }
  );

  const sent = await sendMail(cfg, { to, subject, html, text, replyTo: cfg.replyTo });
  return { to, response: sent.response };
}

/** Small smoke test used from Settings → Email. */
export async function sendTestEmail(to: string): Promise<SendResult> {
  const cfg = await loadEmailConfig();
  const subject = "MALTO email test — this is working";
  const fields: [string, string][] = [
    ["SMTP host", cfg.host],
    ["Port", `${cfg.port}${cfg.secure ? " (SSL)" : ""}`],
    ["Username", cfg.user],
    ["From", fromHeader(cfg)],
    ["Reply-To", cfg.replyTo],
  ];
  const html = shell(
    "Email is configured",
    `<p>This is a test message from the MALTO admin dashboard.</p>
     ${rows(fields.map(([k, v]) => [k, esc(v)] as [string, string]))}
     <p style="font-size:14px;">If you are reading this, booking confirmations and quotes will send correctly. If this landed in spam, tell the developer — that is the signal we need.</p>`
  );
  const text = textVersion(
    "Email is configured",
    [
      "This is a test message from the MALTO admin dashboard.",
      "",
      ...textRows(fields),
      "",
      "If you are reading this, booking confirmations and quotes will send correctly.",
      "If this landed in spam, tell the developer — that is the signal we need.",
    ]
  );
  const sent = await sendMail(cfg, { to, subject, html, text, replyTo: cfg.replyTo });
  return { to, response: sent.response };
}
