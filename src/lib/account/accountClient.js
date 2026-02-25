import {
  cacheOfflineAccountCredential,
  cacheOfflineSessionUser,
  clearOfflineAccountSession,
  completeOfflinePasswordReset,
  createOfflineAccount,
  getOfflineAccountSession,
  loginOfflineAccount,
  logoutOfflineAccount,
  pullOfflineBackup,
  pushOfflineBackup,
  requestOfflinePasswordResetLink,
} from "./offlineAccountStore.js";

function messageFromStatus(status) {
  if (status === 401) return "Invalid email or password.";
  if (status === 409) return "Email is already registered.";
  if (status === 429) return "Too many requests. Please try again soon.";
  if (status >= 500) return "Server error. Please try again.";
  if (status === 404) return "Account service is unavailable. Please try again.";
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
      throw rateLimitError;
    }
    const requestError = new Error(serverMessage || messageFromStatus(response.status));
    requestError.status = response.status;
    throw requestError;
  }
  return payload;
}

function shouldUseOfflineFallback(error) {
  if (!error || typeof error !== "object") return false;
  if (error.isNetworkError) return true;
  const status = Number(error.status || 0);
  if (!Number.isFinite(status)) return false;
  return status === 0 || status === 404 || status === 502 || status === 503 || status === 504;
}

async function cacheOfflineCredentialBestEffort({ email, password, user }) {
  try {
    await cacheOfflineAccountCredential({ email, password, user });
    if (user?.id && user?.email) {
      cacheOfflineSessionUser(user);
    }
  } catch {
    // Do not block online auth if offline cache write fails.
  }
}

export async function getAccountSession() {
  try {
    const result = await requestJson("/api/account-auth", {
      method: "GET",
    });
    if (result?.user?.id && result?.user?.email) {
      cacheOfflineSessionUser(result.user);
    } else {
      clearOfflineAccountSession();
    }
    return result;
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return getOfflineAccountSession();
  }
}

export async function requestSignupCode(email) {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "request-signup-code",
      email,
    }),
  });
}

export async function completeSignup({ email, password, code }) {
  return requestJson("/api/account-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "complete-signup",
      email,
      password,
      code,
    }),
  });
}

export async function createAccount({ email, password }) {
  try {
    const result = await requestJson("/api/account-auth", {
      method: "POST",
      body: JSON.stringify({
        action: "signup",
        email,
        password,
      }),
    });
    await cacheOfflineCredentialBestEffort({ email, password, user: result?.user });
    return result;
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return createOfflineAccount({ email, password });
  }
}

export async function requestPasswordResetCode(email) {
  try {
    return await requestJson("/api/account-auth", {
      method: "POST",
      body: JSON.stringify({
        action: "request-password-reset-link",
        email,
      }),
    });
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return requestOfflinePasswordResetLink(email);
  }
}

export async function completePasswordReset({ token, password }) {
  try {
    const result = await requestJson("/api/account-auth", {
      method: "POST",
      body: JSON.stringify({
        action: "complete-password-reset",
        token,
        password,
      }),
    });
    await cacheOfflineCredentialBestEffort({
      email: result?.user?.email,
      password,
      user: result?.user,
    });
    return result;
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return completeOfflinePasswordReset({ token, password });
  }
}

export async function loginAccount({ email, password }) {
  try {
    const result = await requestJson("/api/account-auth", {
      method: "POST",
      body: JSON.stringify({
        action: "login",
        email,
        password,
      }),
    });
    await cacheOfflineCredentialBestEffort({ email, password, user: result?.user });
    return result;
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return loginOfflineAccount({ email, password });
  }
}

export async function logoutAccount() {
  try {
    const result = await requestJson("/api/account-auth", {
      method: "POST",
      body: JSON.stringify({ action: "logout" }),
    });
    clearOfflineAccountSession();
    return result;
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return logoutOfflineAccount();
  }
}

export async function pullAccountBackup() {
  try {
    return await requestJson("/api/account-sync", {
      method: "GET",
    });
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return pullOfflineBackup();
  }
}

export async function pushAccountBackup(payload) {
  try {
    return await requestJson("/api/account-sync", {
      method: "PUT",
      body: JSON.stringify({ payload }),
    });
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return pushOfflineBackup(payload);
  }
}
