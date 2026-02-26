import process from "node:process";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function inProduction() {
  return process.env.NODE_ENV === "production";
}

function explicitDebugArtifactsPreference() {
  const raw = String(process.env.AUTH_DEBUG_TOKENS || "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}

export function shouldExposeAuthDebugArtifacts() {
  if (inProduction()) return false;
  const preference = explicitDebugArtifactsPreference();
  // Debug artifacts are explicit opt-in in non-production.
  return preference === true;
}

function parseBooleanEnv(value, fallback = null) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function resolveFromAddress(defaultValue = "") {
  const configured = String(
    process.env.ACCOUNT_EMAIL_FROM || process.env.GMAIL_SMTP_FROM || ""
  ).trim();
  if (configured) return configured;
  return String(defaultValue || "").trim();
}

function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = resolveFromAddress("");
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

function getGmailSmtpConfig() {
  const user = String(process.env.GMAIL_SMTP_USER || "").trim();
  const appPassword = String(process.env.GMAIL_SMTP_APP_PASSWORD || "").trim();
  if (!user || !appPassword) return null;

  const host = String(process.env.GMAIL_SMTP_HOST || "smtp.gmail.com").trim();
  const rawPort = Number(process.env.GMAIL_SMTP_PORT || 465);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? Math.round(rawPort) : 465;
  const secure = parseBooleanEnv(process.env.GMAIL_SMTP_SECURE, port === 465);
  const from = resolveFromAddress(user);
  if (!host || !from) return null;

  return {
    host,
    port,
    secure: Boolean(secure),
    user,
    appPassword,
    from,
  };
}

function buildVerificationMessage({ code, ttlMinutes = 10 }) {
  const safeCode = String(code || "").trim();
  const subject = "Your Pocket Ledger verification code";
  const intro = "Use this verification code to finish creating your account:";
  const expiry = `This code expires in ${ttlMinutes} minutes.`;
  const text =
    `Your Pocket Ledger code is ${safeCode}.\n` +
    `${expiry}\n\n` +
    "If you did not request this, you can ignore this email.";
  const html =
    `<div style="font-family:Arial,sans-serif;color:#111">` +
    `<h2 style="margin-bottom:8px">Pocket Ledger</h2>` +
    `<p style="margin:0 0 12px">${intro}</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:0 0 12px">${safeCode}</p>` +
    `<p style="margin:0 0 6px">${expiry}</p>` +
    `<p style="margin:0;color:#555">If you did not request this, you can ignore this email.</p>` +
    `</div>`;
  return { subject, text, html };
}

function buildPasswordResetLinkMessage({ resetUrl, ttlMinutes = 30 }) {
  const safeUrl = String(resetUrl || "").trim();
  const subject = "Reset your Pocket Ledger password";
  const text =
    "We received a password reset request for your Pocket Ledger account.\n\n" +
    `Open this link to set a new password (expires in ${ttlMinutes} minutes):\n` +
    `${safeUrl}\n\n` +
    "If you did not request this, you can ignore this email.";
  const html =
    `<div style="font-family:Arial,sans-serif;color:#111">` +
    `<h2 style="margin-bottom:8px">Pocket Ledger</h2>` +
    `<p style="margin:0 0 12px">Reset your password by opening this link:</p>` +
    `<p style="margin:0 0 12px"><a href="${safeUrl}" style="color:#2563eb">${safeUrl}</a></p>` +
    `<p style="margin:0 0 6px">This link expires in ${ttlMinutes} minutes.</p>` +
    `<p style="margin:0;color:#555">If you did not request this, you can ignore this email.</p>` +
    `</div>`;
  return { subject, text, html };
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function sendEmailWithGmailSmtp({ toEmail, message, sendErrorLabel }) {
  const to = String(toEmail || "").trim().toLowerCase();
  const config = getGmailSmtpConfig();
  if (!config) return { ok: false, skipped: true };

  try {
    const nodemailerModule = await import("nodemailer");
    const api =
      nodemailerModule?.default &&
      typeof nodemailerModule.default.createTransport === "function"
        ? nodemailerModule.default
        : nodemailerModule;
    if (!api || typeof api.createTransport !== "function") {
      throw new Error("nodemailer createTransport is unavailable.");
    }

    const transport = api.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.appPassword,
      },
    });

    await transport.sendMail({
      from: config.from,
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { ok: true, provider: "gmail-smtp" };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.warn(`[account-auth] Gmail SMTP send failed: ${messageText}`);
    return { ok: false, error: sendErrorLabel, provider: "gmail-smtp" };
  }
}

async function sendEmailWithResend({ toEmail, message, sendErrorLabel }) {
  const to = String(toEmail || "").trim().toLowerCase();
  const config = getResendConfig();
  if (!config) return { ok: false, skipped: true };

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      return { ok: false, error: sendErrorLabel, provider: "resend" };
    }
    return { ok: true, provider: "resend" };
  } catch {
    return { ok: false, error: sendErrorLabel, provider: "resend" };
  }
}

async function sendEmail({
  toEmail,
  message,
  logLabel,
  configErrorLabel,
  sendErrorLabel,
}) {
  const to = String(toEmail || "").trim().toLowerCase();

  const smtpResult = await sendEmailWithGmailSmtp({
    toEmail: to,
    message,
    sendErrorLabel,
  });
  if (smtpResult.ok) return smtpResult;
  if (smtpResult.error && !smtpResult.skipped) return smtpResult;

  const resendResult = await sendEmailWithResend({
    toEmail: to,
    message,
    sendErrorLabel,
  });
  if (resendResult.ok) return resendResult;
  if (resendResult.error && !resendResult.skipped) return resendResult;

  if (!inProduction() && shouldExposeAuthDebugArtifacts()) {
    console.info(`[account-auth] ${logLabel} for ${to}`);
    return { ok: true, provider: "dev-console" };
  }

  return {
    ok: false,
    error:
      `${configErrorLabel} is not configured. Set GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD (or RESEND_API_KEY), plus ACCOUNT_EMAIL_FROM.`,
  };
}

export async function sendSignupVerificationEmail({ toEmail, code, ttlMinutes = 10 }) {
  const message = buildVerificationMessage({ code, ttlMinutes });
  const response = await sendEmail({
    toEmail,
    message,
    logLabel: `signup verification code: ${String(code || "").trim()}`,
    configErrorLabel: "Email verification service",
    sendErrorLabel: "Could not send verification email. Please try again.",
  });
  if (!response.ok) return response;
  if (response.provider === "dev-console" && shouldExposeAuthDebugArtifacts()) {
    return { ...response, debugCode: String(code || "").trim() };
  }
  return response;
}

export async function sendPasswordResetLinkEmail({ toEmail, resetUrl, ttlMinutes = 30 }) {
  const to = String(toEmail || "").trim().toLowerCase();
  const safeUrl = String(resetUrl || "").trim();
  if (!isValidHttpUrl(safeUrl)) {
    return {
      ok: false,
      error: "Password reset link is invalid. Please try again.",
    };
  }

  const message = buildPasswordResetLinkMessage({ resetUrl: safeUrl, ttlMinutes });
  const response = await sendEmail({
    toEmail: to,
    message,
    logLabel: `password reset link: ${safeUrl}`,
    configErrorLabel: "Email password reset service",
    sendErrorLabel: "Could not send password reset email. Please try again.",
  });
  if (!response.ok) return response;
  if (response.provider === "dev-console" && shouldExposeAuthDebugArtifacts()) {
    return { ...response, debugResetLink: safeUrl };
  }
  return response;
}
