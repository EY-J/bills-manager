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

function normalizeAuthMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "signup") return "signup";
  if (value === "recover-password") return "recover-password";
  return "signin";
}

export default function AccountDialog({
  onClose,
  accountUser,
  accountBusy,
  accountSyncBusy,
  accountPullBusy,
  accountPushBusy,
  accountAutoSync,
  setAccountAutoSync,
  lastAccountSyncAt,
  accountRecoveryCode,
  onClearAccountRecoveryCode,
  passwordResetToken,
  onClearPasswordResetToken,
  onAuthModeChanged,
  initialAuthMode,
  onAccountLogin,
  onAccountSignupCreate,
  onAccountRecoveryReset,
  onAccountResetVerify,
  onAccountLogout,
  onAccountExport,
  onAccountDelete,
  onAccountPull,
  onAccountPush,
}) {
  const [authMode, setAuthMode] = useState(() => normalizeAuthMode(initialAuthMode));
  const [accountEmailInput, setAccountEmailInput] = useState("");
  const [accountRecoveryCodeInput, setAccountRecoveryCodeInput] = useState("");
  const [accountPasswordInput, setAccountPasswordInput] = useState("");
  const [passwordConfirmInput, setPasswordConfirmInput] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [showPasswordConfirmInput, setShowPasswordConfirmInput] = useState(false);
  const [loginErrorKind, setLoginErrorKind] = useState("");
  const [loginCooldownSeconds, setLoginCooldownSeconds] = useState(0);
  const [recoveryFeedbackMessage, setRecoveryFeedbackMessage] = useState("");
  const [recoveryFeedbackTone, setRecoveryFeedbackTone] = useState("");
  const [signupChallenge, setSignupChallenge] = useState(null);
  const [signupChallengeAnswer, setSignupChallengeAnswer] = useState("");
  const [recoveryChallenge, setRecoveryChallenge] = useState(null);
  const [recoveryChallengeAnswer, setRecoveryChallengeAnswer] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [accountDeletePasswordInput, setAccountDeletePasswordInput] = useState("");
  const [accountDeleteFeedback, setAccountDeleteFeedback] = useState("");
  const [showDeletePasswordInput, setShowDeletePasswordInput] = useState(false);
  const [recoveryCodeCopied, setRecoveryCodeCopied] = useState(false);
  const emailInputRef = useRef(null);
  const recoveryCodeInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const passwordConfirmInputRef = useRef(null);
  const signupChallengeInputRef = useRef(null);
  const recoveryChallengeInputRef = useRef(null);
  const deletePasswordInputRef = useRef(null);

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
  const isRecoverPasswordMode = effectiveAuthMode === "recover-password";
  const isResetPasswordMode = effectiveAuthMode === "reset-password";
  const isSignInMode = effectiveAuthMode === "signin";

  const normalizedEmail = String(accountEmailInput || "").trim().toLowerCase();
  const normalizedRecoveryCode = String(accountRecoveryCodeInput || "")
    .replace(/\D+/g, "")
    .slice(0, 12);
  const passwordValue = String(accountPasswordInput || "");
  const passwordConfirmValue = String(passwordConfirmInput || "");
  const passwordPolicy = getPasswordPolicyStatus(passwordValue);
  const passwordsMatch = passwordValue.length > 0 && passwordValue === passwordConfirmValue;
  const showSignupPasswordStrength =
    (isCreateAccountMode || isResetPasswordMode || isRecoverPasswordMode) &&
    passwordValue.length > 0;
  const showSignupPasswordRules =
    (isCreateAccountMode || isResetPasswordMode || isRecoverPasswordMode) &&
    passwordValue.length > 0 &&
    !passwordPolicy.isValid;
  const signupPasswordStrength = getPasswordStrength(passwordValue);

  const canSignIn = Boolean(normalizedEmail) && Boolean(passwordValue);
  const signupChallengeRequired =
    isCreateAccountMode && Boolean(String(signupChallenge?.token || "").trim());
  const recoveryChallengeRequired =
    isRecoverPasswordMode && Boolean(String(recoveryChallenge?.token || "").trim());
  const canStartSignup =
    Boolean(normalizedEmail) &&
    passwordPolicy.isValid &&
    passwordsMatch &&
    (!signupChallengeRequired || Boolean(String(signupChallengeAnswer || "").trim()));
  const canRecoverPassword =
    Boolean(normalizedEmail) &&
    normalizedRecoveryCode.length === 12 &&
    passwordPolicy.isValid &&
    passwordsMatch &&
    (!recoveryChallengeRequired || Boolean(String(recoveryChallengeAnswer || "").trim()));
  const canCompletePasswordReset =
    Boolean(String(passwordResetToken || "").trim()) && passwordPolicy.isValid && passwordsMatch;
  const showPasswordConfirmMismatch =
    (isCreateAccountMode || isResetPasswordMode || isRecoverPasswordMode) &&
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
  const canConfirmDeleteAccount = Boolean(String(accountDeletePasswordInput || ""));

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
    setAccountRecoveryCodeInput("");
    setPasswordConfirmInput("");
    setShowPasswordInput(false);
    setShowPasswordConfirmInput(false);
    setLoginErrorKind("");
    setRecoveryFeedbackMessage("");
    setRecoveryFeedbackTone("");
    setSignupChallenge(null);
    setSignupChallengeAnswer("");
    setRecoveryChallenge(null);
    setRecoveryChallengeAnswer("");
    setDeleteConfirmOpen(false);
    setAccountDeletePasswordInput("");
    setAccountDeleteFeedback("");
    setShowDeletePasswordInput(false);
    setRecoveryCodeCopied(false);
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
    const result = await onAccountSignupCreate?.({
      email,
      password,
      challengeToken: String(signupChallenge?.token || ""),
      challengeAnswer: String(signupChallengeAnswer || ""),
    });
    if (result?.ok) {
      resetAuthTransientState();
      return;
    }
    if (result?.reason === "challenge-required" && result?.challenge) {
      setSignupChallenge(result.challenge);
      setSignupChallengeAnswer("");
      window.setTimeout(() => {
        focusInput(signupChallengeInputRef);
      }, 0);
    }
  }

  async function handleRecoverPasswordClick() {
    const email = normalizedEmail;
    if (!email) {
      focusInput(emailInputRef);
      return;
    }
    if (normalizedRecoveryCode.length !== 12) {
      focusInput(recoveryCodeInputRef);
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
    if (!canRecoverPassword) return;
    setRecoveryFeedbackMessage("");
    setRecoveryFeedbackTone("");
    const result = await onAccountRecoveryReset?.({
      email,
      recoveryCode: normalizedRecoveryCode,
      password: passwordValue,
      challengeToken: String(recoveryChallenge?.token || ""),
      challengeAnswer: String(recoveryChallengeAnswer || ""),
    });
    if (result?.ok) {
      resetAuthTransientState();
      setAuthMode("signin");
      return;
    }
    if (result?.reason === "challenge-required" && result?.challenge) {
      setRecoveryChallenge(result.challenge);
      setRecoveryChallengeAnswer("");
      const challengeMessage =
        typeof result?.message === "string" && result.message.trim()
          ? result.message.trim()
          : "Please complete the quick check and try again.";
      setRecoveryFeedbackMessage(challengeMessage);
      setRecoveryFeedbackTone("error");
      window.setTimeout(() => {
        focusInput(recoveryChallengeInputRef);
      }, 0);
      return;
    }

    const failedMessage =
      typeof result?.message === "string" && result.message.trim()
        ? result.message.trim()
        : "Could not reset password. Please try again.";
    setRecoveryFeedbackMessage(failedMessage);
    setRecoveryFeedbackTone("error");
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

  async function handleCopyRecoveryCodeClick() {
    const value = String(accountRecoveryCode || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setRecoveryCodeCopied(true);
    } catch {
      setRecoveryCodeCopied(false);
    }
  }

  async function handleDeleteAccountClick() {
    const password = String(accountDeletePasswordInput || "");
    if (!password) {
      focusInput(deletePasswordInputRef);
      return;
    }
    setAccountDeleteFeedback("");
    const result = await onAccountDelete?.({ password });
    if (result?.ok) {
      setDeleteConfirmOpen(false);
      setAccountDeletePasswordInput("");
      setShowDeletePasswordInput(false);
      return;
    }
    if (typeof result?.message === "string" && result.message.trim()) {
      setAccountDeleteFeedback(result.message.trim());
    } else {
      setAccountDeleteFeedback("Could not delete account. Please try again.");
    }
  }

  const authFormTitle = isCreateAccountMode
    ? "Create account"
    : isRecoverPasswordMode
      ? "Recover password"
      : isResetPasswordMode
        ? "Set new password"
        : "Sign in";

  const authFormHint = isCreateAccountMode
    ? "Create your account to sync bills."
    : isRecoverPasswordMode
      ? "Use your recovery code to reset your password."
      : isResetPasswordMode
        ? "Set your new password to continue."
        : "Use email and password to sign in.";

  const headerTitle = accountUser?.email ? "Account" : authFormTitle;
  const headerSubtitle = accountUser?.email
    ? "Manage sync across phone and web."
    : authFormHint;

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div
        className={`modal modal-md accountModal ${accountUser?.email ? "" : "accountModalAuth"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div>
            <h3>{headerTitle}</h3>
            <p className="muted">{headerSubtitle}</p>
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

                {String(accountRecoveryCode || "").trim() ? (
                  <div className="settingsRow settingsRowStack accountRecoveryRow">
                    <div className="settingsMeta">
                      <span className="settingsLabel">Recovery code</span>
                      <span className="settingsHint">
                        Save this code. You can reset your password with it.
                      </span>
                    </div>
                    <div className="accountRecoveryCodeValue">
                      {String(accountRecoveryCode || "").trim()}
                    </div>
                    <div className="accountAssistRow accountAssistRowInfo">
                      <button
                        type="button"
                        className="accountAssistBtn"
                        disabled={accountBusy || accountSyncBusy}
                        onClick={async () => {
                          await handleCopyRecoveryCodeClick();
                        }}
                      >
                        {recoveryCodeCopied ? "Copied" : "Copy code"}
                      </button>
                      <button
                        type="button"
                        className="accountAssistBtn"
                        disabled={accountBusy || accountSyncBusy}
                        onClick={() => onClearAccountRecoveryCode?.()}
                      >
                        I saved it
                      </button>
                    </div>
                  </div>
                ) : null}

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
                        Loading...
                      </span>
                    ) : accountSyncBusy ? (
                      "Updating..."
                    ) : (
                      "Load from cloud"
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
                        Saving...
                      </span>
                    ) : accountSyncBusy ? (
                      "Updating..."
                    ) : (
                      "Save to cloud"
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

                <div className="settingsActions settingsDataActions accountDataActions">
                  <button
                    className="btn headerBtn settingsActionSecondary"
                    disabled={accountBusy || accountSyncBusy || isManualSyncBusy}
                    onClick={async () => {
                      await onAccountExport?.();
                    }}
                  >
                    Export account data
                  </button>
                  <button
                    type="button"
                    className="btn headerBtn settingsActionDanger"
                    disabled={accountBusy || accountSyncBusy || isManualSyncBusy}
                    onClick={() => {
                      setDeleteConfirmOpen((open) => !open);
                      setAccountDeleteFeedback("");
                      setShowDeletePasswordInput(false);
                    }}
                  >
                    {deleteConfirmOpen ? "Cancel delete" : "Delete account"}
                  </button>
                </div>

                {deleteConfirmOpen ? (
                  <div className="settingsRow settingsRowStack">
                    <div className="settingsMeta">
                      <span className="settingsLabel">Confirm account deletion</span>
                      <span className="settingsHint">
                        Enter your password. This permanently removes your account and cloud data.
                      </span>
                    </div>
                    <div className="settingsPasswordField">
                      <input
                        ref={deletePasswordInputRef}
                        className="input settingsAuthInput settingsPasswordInput"
                        type={showDeletePasswordInput ? "text" : "password"}
                        autoComplete="current-password"
                        aria-label="Confirm account deletion password"
                        value={accountDeletePasswordInput}
                        onChange={(e) => {
                          setAccountDeletePasswordInput(e.target.value);
                          if (accountDeleteFeedback) setAccountDeleteFeedback("");
                        }}
                        placeholder="Enter current password"
                        maxLength={128}
                      />
                      <button
                        type="button"
                        className="settingsPasswordToggleBtn"
                        onClick={() => setShowDeletePasswordInput((v) => !v)}
                        aria-label={showDeletePasswordInput ? "Hide password" : "Show password"}
                        aria-pressed={showDeletePasswordInput}
                      >
                        {showDeletePasswordInput ? (
                          <EyeOff aria-hidden="true" focusable="false" />
                        ) : (
                          <Eye aria-hidden="true" focusable="false" />
                        )}
                      </button>
                    </div>
                    <div className="settingsActions settingsDataActions accountDataActions is-single">
                      <button
                        type="button"
                        className="btn headerBtn settingsActionDanger"
                        disabled={!canConfirmDeleteAccount || accountBusy || accountSyncBusy}
                        onClick={async () => {
                          await handleDeleteAccountClick();
                        }}
                      >
                        {accountBusy ? "Please wait..." : "Delete permanently"}
                      </button>
                    </div>
                    <div
                      className={`accountAuthLiveRegion ${accountDeleteFeedback ? "is-error" : ""}`.trim()}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {accountDeleteFeedback}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {isSignInMode || isCreateAccountMode || isRecoverPasswordMode ? (
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

                {isSignInMode || isCreateAccountMode || isResetPasswordMode || isRecoverPasswordMode ? (
                  <div className="settingsRow settingsRowStack">
                    <div className="settingsMeta">
                      <span className="settingsLabel">
                        {isResetPasswordMode || isRecoverPasswordMode ? "New password" : "Password"}
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
                          isCreateAccountMode || isResetPasswordMode || isRecoverPasswordMode
                            ? "new-password"
                            : "current-password"
                        }
                        aria-label={
                          isResetPasswordMode || isRecoverPasswordMode
                            ? "New password"
                            : "Password"
                        }
                        aria-invalid={showSignInPasswordError ? "true" : undefined}
                        value={accountPasswordInput}
                        onChange={(e) => {
                          setAccountPasswordInput(e.target.value);
                          if (loginErrorKind) setLoginErrorKind("");
                        }}
                        placeholder={
                          isResetPasswordMode || isRecoverPasswordMode
                            ? "Enter new password"
                            : "Enter password"
                        }
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

                {isRecoverPasswordMode ? (
                  <div className="settingsRow settingsRowStack">
                    <div className="settingsMeta">
                      <span className="settingsLabel">Recovery code</span>
                    </div>
                    <input
                      ref={recoveryCodeInputRef}
                      className="input settingsAuthInput"
                      type="text"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      aria-label="Recovery code"
                      value={accountRecoveryCodeInput}
                      onChange={(e) => {
                        const digits = String(e.target.value || "").replace(/\D+/g, "").slice(0, 12);
                        const grouped = digits.replace(/(\d{4})(?=\d)/g, "$1-");
                        setAccountRecoveryCodeInput(grouped);
                      }}
                      placeholder="0000-0000-0000"
                      maxLength={14}
                    />
                  </div>
                ) : null}

                {isCreateAccountMode || isResetPasswordMode || isRecoverPasswordMode ? (
                  <div className="settingsRow settingsRowStack">
                    <div className="settingsMeta">
                      <span className="settingsLabel">
                        {isResetPasswordMode || isRecoverPasswordMode
                          ? "Re-enter new password"
                          : "Re-enter password"}
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
                          isResetPasswordMode || isRecoverPasswordMode
                            ? "Re-enter new password"
                            : "Re-enter password"
                        }
                        aria-invalid={showPasswordConfirmMismatch ? "true" : undefined}
                        value={passwordConfirmInput}
                        onChange={(e) => setPasswordConfirmInput(e.target.value)}
                        placeholder={
                          isResetPasswordMode || isRecoverPasswordMode
                            ? "Re-enter new password"
                            : "Re-enter password"
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
                  <>
                    {signupChallengeRequired ? (
                      <div className="settingsRow settingsRowStack">
                        <div className="settingsMeta">
                          <span className="settingsLabel">Quick verification</span>
                          <span className="settingsHint">{String(signupChallenge?.prompt || "")}</span>
                        </div>
                        <input
                          ref={signupChallengeInputRef}
                          className="input settingsAuthInput"
                          type="text"
                          autoComplete="off"
                          aria-label="Quick verification answer"
                          value={signupChallengeAnswer}
                          onChange={(e) => setSignupChallengeAnswer(e.target.value)}
                          placeholder="Enter answer"
                          maxLength={32}
                        />
                      </div>
                    ) : null}

                    <div className="settingsActions settingsDataActions accountDataActions is-single">
                      <button
                        type="button"
                        className="btn headerBtn settingsActionPrimary accountCreateActionBtn"
                        disabled={accountBusy || accountSyncBusy || !canStartSignup}
                        onClick={async () => {
                          await handleCreateAccountClick();
                        }}
                      >
                        {accountBusy ? "Please wait..." : "Create account"}
                      </button>
                    </div>
                    <div className="accountAssistRow accountAssistRowInfo accountRecoveryInfo">
                      <span className="accountAssistHint accountRecoveryInfoText">
                        Recovery code will appear after account creation. Save it safely.
                      </span>
                    </div>

                    <div className="accountAssistRow accountAssistRowInfo accountAuthLinksRow">
                      <span className="accountAssistHint">Already have an account?</span>
                      <button
                        type="button"
                        className="accountAssistBtn accountAssistCreateBtn"
                        disabled={accountBusy || accountSyncBusy}
                        onClick={() => handleAuthModeChange("signin")}
                      >
                        Sign in
                      </button>
                    </div>
                  </>
                ) : null}

                {isRecoverPasswordMode ? (
                  <>
                    {recoveryChallengeRequired ? (
                      <div className="settingsRow settingsRowStack">
                        <div className="settingsMeta">
                          <span className="settingsLabel">Quick verification</span>
                          <span className="settingsHint">
                            {String(recoveryChallenge?.prompt || "")}
                          </span>
                        </div>
                        <input
                          ref={recoveryChallengeInputRef}
                          className="input settingsAuthInput"
                          type="text"
                          autoComplete="off"
                          aria-label="Quick verification answer"
                          value={recoveryChallengeAnswer}
                          onChange={(e) => setRecoveryChallengeAnswer(e.target.value)}
                          placeholder="Enter answer"
                          maxLength={32}
                        />
                      </div>
                    ) : null}

                    <div className="settingsActions settingsDataActions accountDataActions is-single">
                      <button
                        type="button"
                        className="btn headerBtn settingsActionPrimary"
                        disabled={accountBusy || accountSyncBusy || !canRecoverPassword}
                        onClick={async () => {
                          await handleRecoverPasswordClick();
                        }}
                      >
                        {accountBusy ? "Please wait..." : "Reset password"}
                      </button>
                    </div>

                    <div
                      className={`accountAuthLiveRegion ${
                        recoveryFeedbackTone ? `is-${recoveryFeedbackTone}` : ""
                      }`.trim()}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {recoveryFeedbackMessage}
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

                    <div className="accountAssistRow accountAuthSplitLinks">
                      <button
                        type="button"
                        className="accountAssistBtn accountAssistBtnMuted"
                        disabled={accountBusy || accountSyncBusy}
                        onClick={() => handleAuthModeChange("recover-password")}
                      >
                        Forgot password
                      </button>
                      <div className="accountAuthCreateInline">
                        <span className="accountAssistHint">No account yet?</span>
                        <button
                          type="button"
                          className="accountAssistBtn accountAssistCreateBtn"
                          disabled={accountBusy || accountSyncBusy}
                          onClick={() => handleAuthModeChange("signup")}
                        >
                          Create one
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            )}

            {accountUser?.email ? (
              <div className="accountStatusFooter" role="status" aria-live="polite">
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
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}



