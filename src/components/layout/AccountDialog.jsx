import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

function formatLastSync(value) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getPasswordStrength(password) {
  const value = String(password || "");
  if (!value) {
    return { label: "", tone: "" };
  }

  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (value.length >= 12) score += 1;

  if (score <= 1) return { label: "Too weak", tone: "weak" };
  if (score <= 3) return { label: "Good", tone: "good" };
  return { label: "Strong", tone: "strong" };
}

function getPasswordPolicyStatus(password) {
  const value = String(password || "");
  const hasMinLength = value.length >= 8;
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  const isValid = hasMinLength && hasLower && hasUpper && hasNumber;
  return {
    hasMinLength,
    hasLower,
    hasUpper,
    hasNumber,
    isValid,
  };
}

function getStorageModeLabel(mode) {
  if (mode === "kv") return "Persistent cloud";
  if (mode === "offline-local") return "This device only (offline)";
  if (mode === "local") return "Local device server";
  return "Local/dev mode";
}

export default function AccountDialog({
  onClose,
  accountUser,
  accountBusy,
  accountSyncBusy,
  accountPullBusy,
  accountPushBusy,
  accountStorageMode,
  accountAutoSync,
  setAccountAutoSync,
  lastAccountSyncAt,
  passwordResetToken,
  onClearPasswordResetToken,
  onAuthModeChanged,
  onAccountLogin,
  onAccountSignupCreate,
  onAccountResetStart,
  onAccountResetVerify,
  onAccountLogout,
  onAccountPull,
  onAccountPush,
}) {
  const [authMode, setAuthMode] = useState("signin");
  const [accountEmailInput, setAccountEmailInput] = useState("");
  const [accountPasswordInput, setAccountPasswordInput] = useState("");
  const [passwordConfirmInput, setPasswordConfirmInput] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [showPasswordConfirmInput, setShowPasswordConfirmInput] = useState(false);
  const [loginErrorKind, setLoginErrorKind] = useState("");
  const [loginCooldownSeconds, setLoginCooldownSeconds] = useState(0);
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const passwordConfirmInputRef = useRef(null);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  useEffect(() => {
    if (loginCooldownSeconds <= 0) return undefined;
    const timerId = window.setTimeout(() => {
      setLoginCooldownSeconds((previous) => Math.max(0, Number(previous || 0) - 1));
    }, 1000);
    return () => window.clearTimeout(timerId);
  }, [loginCooldownSeconds]);

  const hasLastAccountSync =
    Boolean(lastAccountSyncAt) && !Number.isNaN(new Date(lastAccountSyncAt).getTime());
  const lastAccountSyncLabel = formatLastSync(lastAccountSyncAt);

  const hasPasswordResetToken = Boolean(String(passwordResetToken || "").trim());
  const effectiveAuthMode = hasPasswordResetToken ? "reset-password" : authMode;
  const isCreateAccountMode = effectiveAuthMode === "signup";
  const isResetRequestMode = effectiveAuthMode === "reset-request";
  const isResetPasswordMode = effectiveAuthMode === "reset-password";
  const isSignInMode = effectiveAuthMode === "signin";

  const normalizedEmail = String(accountEmailInput || "").trim().toLowerCase();
  const passwordValue = String(accountPasswordInput || "");
  const passwordConfirmValue = String(passwordConfirmInput || "");
  const passwordPolicy = getPasswordPolicyStatus(passwordValue);
  const passwordsMatch = passwordValue.length > 0 && passwordValue === passwordConfirmValue;
  const showSignupPasswordStrength =
    (isCreateAccountMode || isResetPasswordMode) && passwordValue.length > 0;
  const showSignupPasswordRules =
    (isCreateAccountMode || isResetPasswordMode) &&
    passwordValue.length > 0 &&
    !passwordPolicy.isValid;
  const signupPasswordStrength = getPasswordStrength(passwordValue);

  const canSignIn = Boolean(normalizedEmail) && Boolean(passwordValue);
  const canStartSignup = Boolean(normalizedEmail) && passwordPolicy.isValid && passwordsMatch;
  const canSendPasswordResetLink = Boolean(normalizedEmail);
  const canCompletePasswordReset =
    Boolean(String(passwordResetToken || "").trim()) && passwordPolicy.isValid && passwordsMatch;
  const showPasswordConfirmMismatch =
    (isCreateAccountMode || isResetPasswordMode) &&
    passwordConfirmValue.length > 0 &&
    !passwordsMatch;
  const hasInvalidCredentialsError = loginErrorKind === "invalid-credentials";
  const showSignInEmailError = isSignInMode && hasInvalidCredentialsError;
  const showSignInPasswordError = isSignInMode && hasInvalidCredentialsError;
  const signInOnCooldown = isSignInMode && loginCooldownSeconds > 0;
  const authLiveMessage = signInOnCooldown
    ? `Too many sign-in attempts. Try again in ${loginCooldownSeconds}s.`
    : hasInvalidCredentialsError
      ? "Invalid email or password."
      : "";
  const isPullBusy = Boolean(accountPullBusy);
  const isPushBusy = Boolean(accountPushBusy);
  const isManualSyncBusy = isPullBusy || isPushBusy;

  function focusInput(ref) {
    const node = ref?.current;
    if (!node || typeof node.focus !== "function") return;
    node.focus();
    if (typeof node.select === "function") {
      node.select();
    }
  }

  function resetAuthTransientState() {
    setAccountPasswordInput("");
    setPasswordConfirmInput("");
    setShowPasswordInput(false);
    setShowPasswordConfirmInput(false);
    setLoginErrorKind("");
  }

  function handleAuthModeChange(nextMode) {
    if (nextMode === effectiveAuthMode) return;
    if (hasPasswordResetToken && nextMode !== "reset-password") {
      onClearPasswordResetToken?.();
    }
    onAuthModeChanged?.(nextMode);
    setAuthMode(nextMode);
    resetAuthTransientState();
  }

  async function handleAccountLoginClick() {
    const email = normalizedEmail;
    const password = String(accountPasswordInput || "");
    if (!email) {
      focusInput(emailInputRef);
      return;
    }
    if (!password) {
      focusInput(passwordInputRef);
      return;
    }
    setLoginErrorKind("");
    const result = await onAccountLogin?.(email, password);
    if (result?.ok) {
      setLoginCooldownSeconds(0);
      resetAuthTransientState();
      return;
    }
    const nextReason = typeof result?.reason === "string" ? result.reason : "";
    setLoginErrorKind(nextReason);
    if (nextReason === "rate-limited") {
      const retrySeconds = Number(result?.retryAfterSeconds || 0);
      if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
        setLoginCooldownSeconds(Math.max(1, Math.ceil(retrySeconds)));
      } else {
        setLoginCooldownSeconds((previous) => Math.max(1, Number(previous || 0), 60));
      }
      focusInput(passwordInputRef);
      return;
    }
    if (nextReason === "invalid-credentials") {
      focusInput(emailInputRef);
    }
    setLoginCooldownSeconds(0);
  }

  async function handleCreateAccountClick() {
    const email = normalizedEmail;
    if (!email) {
      focusInput(emailInputRef);
      return;
    }
    if (!passwordPolicy.isValid) {
      focusInput(passwordInputRef);
      return;
    }
    if (!passwordsMatch) {
      focusInput(passwordConfirmInputRef);
      return;
    }
    if (!canStartSignup) return;
    const password = String(accountPasswordInput || "");
    const result = await onAccountSignupCreate?.(email, password);
    if (result?.ok) {
      resetAuthTransientState();
    }
  }

  async function handleSendPasswordResetLinkClick() {
    const email = normalizedEmail;
    if (!email || !canSendPasswordResetLink) {
      focusInput(emailInputRef);
      return;
    }
    await onAccountResetStart?.(email);
  }

  async function handleCompletePasswordResetClick() {
    const token = String(passwordResetToken || "").trim();
    const password = String(accountPasswordInput || "");
    if (!token) return;
    if (!passwordPolicy.isValid) {
      focusInput(passwordInputRef);
      return;
    }
    if (!passwordsMatch) {
      focusInput(passwordConfirmInputRef);
      return;
    }
    if (!password || !canCompletePasswordReset) {
      focusInput(passwordInputRef);
      return;
    }
    const result = await onAccountResetVerify?.({ token, password });
    if (result?.ok) {
      onClearPasswordResetToken?.();
      setAuthMode("signin");
      resetAuthTransientState();
    }
  }

  const showAuthModePills = !isResetRequestMode && !isResetPasswordMode;

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div
        className={`modal modal-md accountModal ${accountUser?.email ? "" : "accountModalAuth"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div>
            <h3>Account</h3>
            <p className="muted">Sign in to sync bills across phone and web.</p>
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close account">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="modalBody settingsBody is-scrollable">
          <section className="settingsSection">
            {accountUser?.email ? (
              <>
                <p className="settingsSectionTitle">Account sync</p>

                <div className="settingsRow">
                  <div className="settingsMeta">
                    <span className="settingsLabel">Signed in</span>
                    <span className="settingsHint settingsAccountEmail">{accountUser.email}</span>
                  </div>
                </div>

                <div className="settingsRow">
                  <div className="settingsMeta">
                    <span className="settingsLabel">Auto sync</span>
                    <span className="settingsHint">
                      Automatically uploads changes after edits.
                    </span>
                  </div>
                  <label
                    className="toggle switchToggle settingsSwitch"
                    aria-label="Toggle account auto sync"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(accountAutoSync)}
                      onChange={(e) => setAccountAutoSync?.(e.target.checked)}
                    />
                    <span className="switchTrack" aria-hidden="true">
                      <span className="switchThumb" />
                    </span>
                  </label>
                </div>

                <div className="settingsActions settingsDataActions accountDataActions">
                  <button
                    className="btn headerBtn settingsActionSecondary"
                    disabled={accountBusy || accountSyncBusy || isManualSyncBusy}
                    aria-busy={isPullBusy ? "true" : undefined}
                    onClick={async () => {
                      await onAccountPull?.();
                    }}
                  >
                    {isPullBusy ? (
                      <span className="accountSyncBtnLabel">
                        <svg
                          className="btnLoadingSpin"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                        </svg>
                        Pulling...
                      </span>
                    ) : accountSyncBusy ? (
                      "Syncing..."
                    ) : (
                      "Pull now"
                    )}
                  </button>

                  <button
                    className="btn headerBtn settingsActionPrimary"
                    disabled={accountBusy || accountSyncBusy || isManualSyncBusy}
                    aria-busy={isPushBusy ? "true" : undefined}
                    onClick={async () => {
                      await onAccountPush?.();
                    }}
                  >
                    {isPushBusy ? (
                      <span className="accountSyncBtnLabel">
                        <svg
                          className="btnLoadingSpin"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                        </svg>
                        Pushing...
                      </span>
                    ) : accountSyncBusy ? (
                      "Syncing..."
                    ) : (
                      "Push now"
                    )}
                  </button>

                  <button
                    className="btn headerBtn settingsActionTertiary settingsActionDanger"
                    disabled={accountBusy || accountSyncBusy || isManualSyncBusy}
                    onClick={async () => {
                      await onAccountLogout?.();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                {showAuthModePills ? (
                  <div
                    className="settingsPills accountAuthModeToggle"
                    role="tablist"
                    aria-label="Account mode"
                  >
                    <button
                      type="button"
                      className={`settingsPill settingsPillSignIn ${isSignInMode ? "active" : ""}`}
                      onClick={() => handleAuthModeChange("signin")}
                      disabled={accountBusy || accountSyncBusy}
                      aria-selected={isSignInMode}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className={`settingsPill settingsPillCreate ${isCreateAccountMode ? "active" : ""}`}
                      onClick={() => handleAuthModeChange("signup")}
                      disabled={accountBusy || accountSyncBusy}
                      aria-selected={isCreateAccountMode}
                    >
                      Create account
                    </button>
                  </div>
                ) : null}

                {isSignInMode || isCreateAccountMode || isResetRequestMode ? (
                  <div className="settingsRow settingsRowStack">
                    <div className="settingsMeta">
                      <span className="settingsLabel">Email</span>
                    </div>
                    <input
                      ref={emailInputRef}
                      className={`input settingsAuthInput ${showSignInEmailError ? "is-error" : ""}`.trim()}
                      type="email"
                      autoComplete="email"
                      aria-label="Email"
                      aria-invalid={showSignInEmailError ? "true" : undefined}
                      value={accountEmailInput}
                      onChange={(e) => {
                        setAccountEmailInput(e.target.value);
                        if (loginErrorKind) setLoginErrorKind("");
                      }}
                      placeholder="you@example.com"
                      maxLength={160}
                    />
                  </div>
                ) : null}

                {isSignInMode || isCreateAccountMode || isResetPasswordMode ? (
                  <div className="settingsRow settingsRowStack">
                    <div className="settingsMeta">
                      <span className="settingsLabel">
                        {isResetPasswordMode ? "New password" : "Password"}
                      </span>
                    </div>
                    <div
                      className={`settingsPasswordField ${showSignInPasswordError ? "is-error" : ""}`.trim()}
                    >
                      <input
                        ref={passwordInputRef}
                        className={`input settingsAuthInput settingsPasswordInput ${
                          showSignInPasswordError ? "is-error" : ""
                        }`.trim()}
                        type={showPasswordInput ? "text" : "password"}
                        autoComplete={
                          isCreateAccountMode || isResetPasswordMode
                            ? "new-password"
                            : "current-password"
                        }
                        aria-label={isResetPasswordMode ? "New password" : "Password"}
                        aria-invalid={showSignInPasswordError ? "true" : undefined}
                        value={accountPasswordInput}
                        onChange={(e) => {
                          setAccountPasswordInput(e.target.value);
                          if (loginErrorKind) setLoginErrorKind("");
                        }}
                        placeholder={isResetPasswordMode ? "Enter new password" : "Enter password"}
                        maxLength={128}
                      />
                      <button
                        type="button"
                        className="settingsPasswordToggleBtn"
                        onClick={() => setShowPasswordInput((v) => !v)}
                        aria-label={showPasswordInput ? "Hide password" : "Show password"}
                        aria-pressed={showPasswordInput}
                      >
                        {showPasswordInput ? (
                          <EyeOff aria-hidden="true" focusable="false" />
                        ) : (
                          <Eye aria-hidden="true" focusable="false" />
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}

                {showSignupPasswordStrength ? (
                  <div className="accountPasswordMeta" role="status" aria-live="polite">
                    {showSignupPasswordRules ? (
                      <p className="accountPasswordRequirement">
                        Use at least 8 characters, including uppercase, lowercase, and a number.
                      </p>
                    ) : null}
                    <p className={`accountPasswordStrength is-${signupPasswordStrength.tone}`}>
                      Password strength: <strong>{signupPasswordStrength.label}</strong>
                    </p>
                  </div>
                ) : null}

                {isCreateAccountMode || isResetPasswordMode ? (
                  <div className="settingsRow settingsRowStack">
                    <div className="settingsMeta">
                      <span className="settingsLabel">
                        {isResetPasswordMode ? "Re-enter new password" : "Re-enter password"}
                      </span>
                    </div>
                    <div
                      className={`settingsPasswordField ${showPasswordConfirmMismatch ? "is-error" : ""}`.trim()}
                    >
                      <input
                        ref={passwordConfirmInputRef}
                        className={`input settingsAuthInput settingsPasswordInput ${
                          showPasswordConfirmMismatch ? "is-error" : ""
                        }`.trim()}
                        type={showPasswordConfirmInput ? "text" : "password"}
                        autoComplete="new-password"
                        aria-label={
                          isResetPasswordMode ? "Re-enter new password" : "Re-enter password"
                        }
                        aria-invalid={showPasswordConfirmMismatch ? "true" : undefined}
                        value={passwordConfirmInput}
                        onChange={(e) => setPasswordConfirmInput(e.target.value)}
                        placeholder={
                          isResetPasswordMode ? "Re-enter new password" : "Re-enter password"
                        }
                        maxLength={128}
                      />
                      <button
                        type="button"
                        className="settingsPasswordToggleBtn"
                        onClick={() => setShowPasswordConfirmInput((v) => !v)}
                        aria-label={
                          showPasswordConfirmInput
                            ? "Hide password confirmation"
                            : "Show password confirmation"
                        }
                        aria-pressed={showPasswordConfirmInput}
                      >
                        {showPasswordConfirmInput ? (
                          <EyeOff aria-hidden="true" focusable="false" />
                        ) : (
                          <Eye aria-hidden="true" focusable="false" />
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}

                {isCreateAccountMode ? (
                  <div className="settingsActions settingsDataActions accountDataActions is-single">
                    <button
                      type="button"
                      className="btn headerBtn settingsActionPrimary"
                      disabled={accountBusy || accountSyncBusy || !canStartSignup}
                      onClick={async () => {
                        await handleCreateAccountClick();
                      }}
                    >
                      {accountBusy ? "Please wait..." : "Create account"}
                    </button>
                  </div>
                ) : null}

                {isResetRequestMode ? (
                  <>
                    <div className="settingsActions settingsDataActions accountDataActions is-single">
                      <button
                        type="button"
                        className="btn headerBtn settingsActionPrimary"
                        disabled={accountBusy || accountSyncBusy || !canSendPasswordResetLink}
                        onClick={async () => {
                          await handleSendPasswordResetLinkClick();
                        }}
                      >
                        {accountBusy ? "Please wait..." : "Send reset link"}
                      </button>
                    </div>

                    <div className="accountAssistRow">
                      <button
                        type="button"
                        className="accountAssistBtn"
                        disabled={accountBusy || accountSyncBusy}
                        onClick={() => handleAuthModeChange("signin")}
                      >
                        Back to sign in
                      </button>
                    </div>
                  </>
                ) : null}

                {isResetPasswordMode ? (
                  <>
                    <div className="settingsActions settingsDataActions accountDataActions is-single">
                      <button
                        type="button"
                        className="btn headerBtn settingsActionPrimary"
                        disabled={accountBusy || accountSyncBusy || !canCompletePasswordReset}
                        onClick={async () => {
                          await handleCompletePasswordResetClick();
                        }}
                      >
                        {accountBusy ? "Please wait..." : "Reset password"}
                      </button>
                    </div>

                    <div className="accountAssistRow">
                      <button
                        type="button"
                        className="accountAssistBtn"
                        disabled={accountBusy || accountSyncBusy}
                        onClick={() => handleAuthModeChange("signin")}
                      >
                        Back to sign in
                      </button>
                    </div>
                  </>
                ) : null}

                {isSignInMode ? (
                  <>
                    <div className="settingsActions settingsDataActions accountDataActions is-single">
                      <button
                        type="button"
                        className="btn headerBtn settingsActionPrimary"
                        disabled={accountBusy || accountSyncBusy || !canSignIn || signInOnCooldown}
                        onClick={async () => {
                          await handleAccountLoginClick();
                        }}
                      >
                        {accountBusy
                          ? "Please wait..."
                          : signInOnCooldown
                            ? `Try again in ${loginCooldownSeconds}s`
                            : "Sign in"}
                      </button>
                    </div>

                    <div
                      className={`accountAuthLiveRegion ${
                        authLiveMessage
                          ? signInOnCooldown
                            ? "is-rate-limit"
                            : "is-error"
                          : ""
                      }`.trim()}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {authLiveMessage}
                    </div>

                    {hasInvalidCredentialsError ? (
                      <div className="accountAssistRow accountAssistRowInfo">
                        <span className="accountAssistHint">No account yet?</span>
                        <button
                          type="button"
                          className="accountAssistBtn accountAssistCreateBtn"
                          disabled={accountBusy || accountSyncBusy}
                          onClick={() => handleAuthModeChange("signup")}
                        >
                          Create account
                        </button>
                      </div>
                    ) : null}

                    <div className="accountAssistRow">
                      <button
                        type="button"
                        className="accountAssistBtn"
                        disabled={accountBusy || accountSyncBusy}
                        onClick={() => handleAuthModeChange("reset-request")}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            )}

            {accountUser?.email ? (
              <div className="accountStatusFooter" role="status" aria-live="polite">
                <span className="settingsAccountStatusHint">
                  Sync storage: {getStorageModeLabel(accountStorageMode)}
                </span>
                <span className="accountStatusSyncMeta">
                  <span className="settingsDataStatusInlineLabel">Last sync:</span>
                  <strong
                    className={`settingsDataStatusInlineValue ${
                      hasLastAccountSync ? "is-ok" : "is-empty"
                    }`}
                  >
                    {lastAccountSyncLabel}
                  </strong>
                </span>
              </div>
            ) : (
              <div className="settingsAccountStatusHint">
                Sync storage: {getStorageModeLabel(accountStorageMode)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}



