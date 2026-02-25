import process from "node:process";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function inProduction() {
  return process.env.NODE_ENV === "production";
}

function explicitDebugArtifactsEnabled() {
  const raw = String(process.env.AUTH_DEBUG_TOKENS || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function shouldExposeAuthDebugArtifacts() {
  if (inProduction()) return false;
  return explicitDebugArtifactsEnabled();
}

function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.ACCOUNT_EMAIL_FROM || "").trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
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

async function sendEmailWithResend({ toEmail, message, logLabel, configErrorLabel, sendErrorLabel }) {
  const to = String(toEmail || "").trim().toLowerCase();
  const config = getResendConfig();

  if (!config) {
    if (!inProduction()) {
      if (shouldExposeAuthDebugArtifacts()) {
        console.info(`[account-auth] ${logLabel} for ${to}`);
      } else {
        console.info(`[account-auth] email debug artifact suppressed for ${to}`);
      }
      return { ok: true, provider: "dev-console" };
    }
    return {
      ok: false,
      error:
        `${configErrorLabel} is not configured. Set RESEND_API_KEY and ACCOUNT_EMAIL_FROM.`,
    };
  }

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
      return { ok: false, error: sendErrorLabel };
    }

    return { ok: true, provider: "resend" };
  } catch {
    return { ok: false, error: sendErrorLabel };
  }
}

export async function sendSignupVerificationEmail({ toEmail, code, ttlMinutes = 10 }) {
  const message = buildVerificationMessage({ code, ttlMinutes });
  const response = await sendEmailWithResend({
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
  const response = await sendEmailWithResend({
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
