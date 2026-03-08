function messageFromStatus(status) {
  if (status === 401) return "Invalid email or password.";
  if (status === 409) return "Email is already registered.";
  if (status === 428) return "Additional verification is required.";
  if (status === 429) return "Too many requests. Please try again soon.";
  if (status >= 500) return "Server error. Please try again.";
  if (status === 404) return "Account setup is not ready yet. Please restart the app and try again.";
  return "Request failed.";
}

function parseRetryAfterSeconds(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1, Math.ceil(seconds));
  }

  const at = Date.parse(raw);
  if (!Number.isNaN(at)) {
    const deltaMs = at - Date.now();
    if (deltaMs > 0) {
      return Math.max(1, Math.ceil(deltaMs / 1000));
    }
  }

  return 0;
}

function formatRateLimitMessage(serverMessage, retryAfterSeconds) {
  const waitSuffix =
    retryAfterSeconds > 0
      ? `Try again in ${retryAfterSeconds}s.`
      : "Please try again soon.";
  if (!serverMessage) {
    return `Too many requests. ${waitSuffix}`;
  }

  const normalized = serverMessage.trim();
  if (!normalized) {
    return `Too many requests. ${waitSuffix}`;
  }

  const alreadyContainsWaitHint =
    /try again|please wait|\b\d+\s*s\b|second|minute/i.test(normalized);
  if (retryAfterSeconds > 0 && !alreadyContainsWaitHint) {
    return `${normalized} Try again in ${retryAfterSeconds}s.`;
  }
  return normalized;
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson(url, options = {}) {
  let response = null;
  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    const networkError = new Error(
      error instanceof Error ? error.message : "Network request failed."
    );
    networkError.status = 0;
    networkError.isNetworkError = true;
    throw networkError;
  }

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const serverMessage =
      payload && typeof payload.error === "string" ? payload.error : "";
    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("Retry-After"));
      const rateLimitError = new Error(
        formatRateLimitMessage(serverMessage, retryAfterSeconds)
      );
      rateLimitError.status = 429;
      rateLimitError.retryAfterSeconds = retryAfterSeconds;
      rateLimitError.data = payload;
      throw rateLimitError;
    }
    const requestError = new Error(serverMessage || messageFromStatus(response.status));
    requestError.status = response.status;
    requestError.data = payload;
    throw requestError;
  }
  return payload;
}

export async function getAccountSession() {
  return requestJson("/api/account-auth", {
    method: "GET",
  });
}

export async function createAccount({ email, password, challengeToken = "", challengeAnswer = "" }) {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "signup",
      email,
      password,
      challengeToken,
      challengeAnswer,
    }),
  });
}

export async function completePasswordResetWithRecoveryCode({
  email,
  recoveryCode,
  password,
  challengeToken = "",
  challengeAnswer = "",
}) {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "complete-password-reset-recovery",
      email,
      recoveryCode,
      password,
      challengeToken,
      challengeAnswer,
    }),
  });
}

export async function loginAccount({ email, password }) {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "login",
      email,
      password,
    }),
  });
}

export async function logoutAccount() {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({ action: "logout" }),
  });
}

export async function deleteAccount({ password }) {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "delete-account",
      password,
    }),
  });
}

export async function changeAccountPassword({ currentPassword, newPassword }) {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "change-password",
      currentPassword,
      newPassword,
    }),
  });
}

export async function pullAccountBackup() {
  return requestJson("/api/account-sync", {
    method: "GET",
  });
}

export async function pushAccountBackup(payload) {
  return requestJson("/api/account-sync", {
    method: "PUT",
    body: JSON.stringify({ payload }),
  });
}
