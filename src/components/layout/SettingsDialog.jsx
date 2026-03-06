import React, { useEffect, useRef, useState } from "react";

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatLastBackup(value) {
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

export default function SettingsDialog({
  open,
  onClose,
  maxRestoreFileBytes = 2 * 1024 * 1024,
  notifyEnabled,
  setNotifyEnabled,
  notificationMode,
  setNotificationMode,
  compactMode,
  setCompactMode,
  tableDensity,
  setTableDensity,
  lastBackupAt,
  hasRiskRestorePoint,
  onRollbackRiskRestore,
  canInstall,
  onInstall,
  onBackup,
  onRestorePreview,
  onRestoreApply,
  onTestNotification,
  onClear,
}) {
  const settingsBodyRef = useRef(null);
  const restoreInputRef = useRef(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isApplyingRestore, setIsApplyingRestore] = useState(false);
  const [restoreState, setRestoreState] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [applyRestoreConfirmOpen, setApplyRestoreConfirmOpen] = useState(false);
  const [restoreMode, setRestoreMode] = useState("replace");
  const [restoreConflictPolicy, setRestoreConflictPolicy] = useState("overwrite");
  const [bodyCanScroll, setBodyCanScroll] = useState(false);
  const rawVersion = String(import.meta.env.VITE_APP_VERSION || "0.0.0").trim();
  const versionText = rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;
  const hasLastBackup =
    Boolean(lastBackupAt) && !Number.isNaN(new Date(lastBackupAt).getTime());
  const lastBackupLabel = formatLastBackup(lastBackupAt);

  useEffect(() => {
    if (!open) {
      setIsRestoring(false);
      setIsApplyingRestore(false);
      setRestoreState(null);
      setPendingRestore(null);
      setApplyRestoreConfirmOpen(false);
      setRestoreMode("replace");
      setRestoreConflictPolicy("overwrite");
      setBodyCanScroll(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function updateScrollState() {
      const el = settingsBodyRef.current;
      if (!el) return;
      const overflowPx = Math.ceil(el.scrollHeight - el.clientHeight);
      setBodyCanScroll(overflowPx > 10);
    }

    updateScrollState();
    const raf = requestAnimationFrame(updateScrollState);
    const timeout = setTimeout(updateScrollState, 0);
    window.addEventListener("resize", updateScrollState);

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined" && settingsBodyRef.current) {
      resizeObserver = new ResizeObserver(updateScrollState);
      resizeObserver.observe(settingsBodyRef.current);
    }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      window.removeEventListener("resize", updateScrollState);
      resizeObserver?.disconnect();
    };
  }, [
    open,
    restoreState,
    isRestoring,
    isApplyingRestore,
    pendingRestore,
    canInstall,
    hasRiskRestorePoint,
    lastBackupAt,
  ]);

  useEffect(() => {
    if (!open || !applyRestoreConfirmOpen) return undefined;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setApplyRestoreConfirmOpen(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, applyRestoreConfirmOpen]);

  if (!open) return null;

  function resetRestoreFlow() {
    setIsRestoring(false);
    setIsApplyingRestore(false);
    setRestoreState(null);
    setPendingRestore(null);
    setApplyRestoreConfirmOpen(false);
    setRestoreMode("replace");
    setRestoreConflictPolicy("overwrite");
    if (restoreInputRef.current) {
      restoreInputRef.current.value = "";
    }
  }

  function handleRestoreClick() {
    resetRestoreFlow();
    restoreInputRef.current?.click();
  }

  function getRestorePlanKey(mode, policy) {
    return `${mode === "merge" ? "merge" : "replace"}:${
      policy === "skip" ? "skip" : "overwrite"
    }`;
  }

  function getSelectedRestorePreview() {
    if (!pendingRestore) return restoreState?.preview || null;
    const key = getRestorePlanKey(restoreMode, restoreConflictPolicy);
    const planned = pendingRestore?.previewBundle?.plans?.[key];
    return planned || pendingRestore?.preview || restoreState?.preview || null;
  }

  async function handleRestoreFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (Number(file.size || 0) <= 0) {
      event.target.value = "";
      setRestoreState({
        ok: false,
        state: "error",
        title: "Empty file",
        message: "The selected file is empty.",
        hint: "Pick a valid backup .json file exported from this app.",
      });
      return;
    }

    if (Number(file.size || 0) > Number(maxRestoreFileBytes || 0)) {
      event.target.value = "";
      setRestoreState({
        ok: false,
        state: "error",
        title: "File too large",
        message: "This backup is too large to safely restore on this device.",
        hint: `Use a backup up to ${formatMb(maxRestoreFileBytes)}.`,
      });
      return;
    }

    setIsRestoring(true);
    setRestoreState(null);
    setPendingRestore(null);
    let result = null;
    try {
      result = await onRestorePreview?.(file);
    } catch {
      result = {
        ok: false,
        state: "error",
        title: "Import failed",
        message: "We could not import that file.",
        hint: "Use a valid JSON backup exported from this app.",
      };
    }

    event.target.value = "";

    if (result?.ok) {
      if (result.data) {
        setPendingRestore(result.data);
        setRestoreMode(result.data.restoreMode === "merge" ? "merge" : "replace");
        setRestoreConflictPolicy(
          result.data.conflictPolicy === "skip" ? "skip" : "overwrite"
        );
      }
      setRestoreState(result);
      setIsRestoring(false);
      return;
    }

    setIsRestoring(false);
    setRestoreState(
      result || {
        ok: false,
        state: "error",
        title: "Restore failed",
        message: "The selected backup could not be restored.",
        hint: "Try another backup file exported from this app.",
      }
    );
  }

  async function handleApplyRestore() {
    if (!pendingRestore || isApplyingRestore) return;

    setApplyRestoreConfirmOpen(false);
    setIsApplyingRestore(true);
    try {
      const result = await onRestoreApply?.({
        ...pendingRestore,
        restoreMode,
        conflictPolicy: restoreConflictPolicy,
      });
      if (result?.ok) {
        setIsApplyingRestore(false);
        onClose?.();
        return;
      }

      setRestoreState(
        result || {
          ok: false,
          state: "error",
          title: "Restore failed",
          message: "The restore could not be applied.",
          hint: "Try another backup file.",
        }
      );
    } catch {
      setRestoreState({
        ok: false,
        state: "error",
        title: "Restore failed",
        message: "The restore could not be applied.",
        hint: "Try another backup file.",
      });
    } finally {
      setIsApplyingRestore(false);
    }
  }

  function handleRequestApplyRestore() {
    if (!pendingRestore || isApplyingRestore) return;
    setApplyRestoreConfirmOpen(true);
  }

  const selectedRestorePreview = getSelectedRestorePreview();
  const isMergeMode = restoreMode === "merge";
  const confirmPreview = selectedRestorePreview || {
    added: 0,
    updated: 0,
    deleted: 0,
    conflicts: 0,
    skipped: 0,
  };
  const confirmModeLabel = restoreMode === "merge" ? "Merge" : "Replace list";
  const confirmDeletedCount = Number(confirmPreview.deleted || 0);
  const confirmConflictCount = Number(confirmPreview.conflicts || 0);
  const confirmSkippedCount = Number(confirmPreview.skipped || 0);

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modal modal-lg settingsModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="settingsTitleRow">
              <h3>Settings</h3>
              <span className="settingsVersionBadge" title={versionText}>{versionText}</span>
            </div>
            <p className="muted">Manage notifications, backup, and app actions.</p>
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close settings">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div
          ref={settingsBodyRef}
          className={`modalBody settingsBody ${bodyCanScroll ? "is-scrollable" : "no-scrollbar"}`}
        >
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hiddenFileInput"
            onChange={handleRestoreFileChange}
          />

          <div className="settingsDesktopGrid">
            <div className="settingsDesktopCol settingsDesktopColInfo">
              <section className="settingsSection">
                <p className="settingsSectionTitle">Privacy</p>
                <div className="settingsInfoCard" role="note" aria-label="Data privacy note">
                  <p className="settingsInfoText">
                    Your bills data stays local by default. Use the Account icon in
                    the header (or bottom nav on mobile) to sign in and sync across devices.
                  </p>
                </div>
              </section>

              <section className="settingsSection">
                <p className="settingsSectionTitle">Mobile readiness checklist</p>
                <div className="settingsInfoCard settingsChecklistCard" role="note" aria-label="Mobile test checklist">
                  <ol className="settingsChecklist">
                    <li>Install app: Android (Chrome menu to Install app), iPhone (Safari Share to Add to Home Screen).</li>
                    <li>Create one test bill and one payment entry.</li>
                    <li>Close and reopen the app; verify the same data is still there.</li>
                    <li>Reconnect online and verify your latest synced data is still available.</li>
                    <li>Use Backup data, then clear/restore using Restore data; verify records come back correctly.</li>
                  </ol>
                  {!canInstall ? (
                    <p className="settingsInfoText settingsChecklistHint">
                      Install prompt not available in this browser right now. Open from mobile browser to install.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="settingsDesktopCol settingsDesktopColControls">
              <section className="settingsSection">
                <p className="settingsSectionTitle">Preferences</p>
                <div className="settingsRow">
                  <div className="settingsMeta">
                    <span className="settingsLabel">Notifications</span>
                    <span className="settingsHint">Turn due reminders on or off.</span>
                  </div>
                  <label className="toggle switchToggle settingsSwitch" aria-label="Toggle notifications">
                    <input
                      type="checkbox"
                      checked={notifyEnabled}
                      onChange={(e) => setNotifyEnabled(e.target.checked)}
                    />
                    <span className="switchTrack" aria-hidden="true">
                      <span className="switchThumb" />
                    </span>
                  </label>
                </div>

                <div className="settingsRow settingsRowNotificationMode">
                  <div className="settingsMeta">
                    <span className="settingsLabel">Notification mode</span>
                    <span className="settingsHint">Daily summary or instant per bill.</span>
                  </div>
                  <select
                    className="select settingsInlineSelect"
                    value={notificationMode === "instant" ? "instant" : "digest"}
                    onChange={(e) => setNotificationMode?.(e.target.value === "instant" ? "instant" : "digest")}
                    aria-label="Notification mode"
                  >
                    <option value="digest">Digest (daily)</option>
                    <option value="instant">Instant (per bill)</option>
                  </select>
                </div>

                <div className="settingsRow">
                  <div className="settingsMeta">
                    <span className="settingsLabel">Compact mode</span>
                    <span className="settingsHint">Reduce spacing for smaller phone screens.</span>
                  </div>
                  <label className="toggle switchToggle settingsSwitch" aria-label="Toggle compact mode">
                    <input
                      type="checkbox"
                      checked={Boolean(compactMode)}
                      onChange={(e) => setCompactMode?.(e.target.checked)}
                    />
                    <span className="switchTrack" aria-hidden="true">
                      <span className="switchThumb" />
                    </span>
                  </label>
                </div>

                <div className="settingsRow settingsRowStack">
                  <div className="settingsMeta">
                    <span className="settingsLabel">Table density</span>
                    <span className="settingsHint">Controls row spacing independently from compact mode.</span>
                  </div>
                  <div className="settingsPills" role="group" aria-label="Table density">
                    <button
                      type="button"
                      className={`settingsPill ${tableDensity !== "compact" ? "active" : ""}`}
                      onClick={() => setTableDensity?.("comfortable")}
                    >
                      Comfortable
                    </button>
                    <button
                      type="button"
                      className={`settingsPill ${tableDensity === "compact" ? "active" : ""}`}
                      onClick={() => setTableDensity?.("compact")}
                    >
                      Compact
                    </button>
                  </div>
                </div>
              </section>

              <section className="settingsSection">
                <p className="settingsSectionTitle">Data</p>
                <div className="settingsActions settingsDataActions">
                  {canInstall ? (
                    <button
                      className="btn headerBtn settingsInstallBtn"
                      onClick={async () => {
                        await onInstall?.();
                        onClose?.();
                      }}
                    >
                      Install app
                    </button>
                  ) : null}

                  <button
                    className="btn primary headerBtn settingsActionPrimary"
                    onClick={() => {
                      onBackup?.();
                      onClose?.();
                    }}
                  >
                    Backup data
                  </button>

                  <button
                    className="btn headerBtn settingsActionSecondary"
                    disabled={isRestoring || isApplyingRestore}
                    onClick={handleRestoreClick}
                  >
                    {isRestoring ? "Importing..." : "Restore data"}
                  </button>

                  <button
                    className="btn headerBtn settingsActionTertiary settingsRollbackBtn"
                    disabled={!hasRiskRestorePoint}
                    onClick={() => {
                      onRollbackRiskRestore?.();
                      onClose?.();
                    }}
                  >
                    {hasRiskRestorePoint ? "Rollback" : "Rollback unavailable"}
                  </button>

                  <div className="settingsDataStatusInline" role="status" aria-live="polite">
                    <span className="settingsDataStatusInlineLabel">Last backup:</span>
                    <strong
                      className={`settingsDataStatusInlineValue ${hasLastBackup ? "is-ok" : "is-empty"}`}
                    >
                      {lastBackupLabel}
                    </strong>
                  </div>
                </div>

                {restoreState ? (
                  <div className={`settingsImportState ${restoreState.state || "error"}`}>
                    <div className="settingsImportTitle">{restoreState.title || "Restore failed"}</div>
                    <div className="settingsImportText">
                      {restoreState.message || "The selected file could not be restored."}
                    </div>
                    {pendingRestore ? (
                      <div className="settingsRestoreOptions">
                        <div className="settingsRestoreOptionRow">
                          <span className="settingsImportHint">Import mode</span>
                          <div className="settingsPills settingsRestorePills" role="group" aria-label="Import mode">
                            <button
                              type="button"
                              className={`settingsPill ${restoreMode === "replace" ? "active" : ""}`}
                              onClick={() => setRestoreMode("replace")}
                            >
                              Replace list
                            </button>
                            <button
                              type="button"
                              className={`settingsPill ${restoreMode === "merge" ? "active" : ""}`}
                              onClick={() => setRestoreMode("merge")}
                            >
                              Merge
                            </button>
                          </div>
                        </div>

                        {isMergeMode ? (
                          <div className="settingsRestoreOptionRow">
                            <span className="settingsImportHint">If bill ID already exists</span>
                            <div className="settingsPills settingsRestorePills" role="group" aria-label="Conflict handling">
                              <button
                                type="button"
                                className={`settingsPill ${restoreConflictPolicy !== "skip" ? "active" : ""}`}
                                onClick={() => setRestoreConflictPolicy("overwrite")}
                              >
                                Overwrite existing
                              </button>
                              <button
                                type="button"
                                className={`settingsPill ${restoreConflictPolicy === "skip" ? "active" : ""}`}
                                onClick={() => setRestoreConflictPolicy("skip")}
                              >
                                Keep existing
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {selectedRestorePreview ? (
                      <div className="settingsRestorePreview">
                        <span>Incoming: {selectedRestorePreview.incoming}</span>
                        <span>Added: {selectedRestorePreview.added}</span>
                        <span>Updated: {selectedRestorePreview.updated}</span>
                        <span>Removed: {selectedRestorePreview.deleted}</span>
                        <span>Conflicts: {selectedRestorePreview.conflicts || 0}</span>
                        <span>Kept: {selectedRestorePreview.skipped || 0}</span>
                      </div>
                    ) : null}
                    {restoreState.hint ? (
                      <div className="settingsImportHint">{restoreState.hint}</div>
                    ) : null}

                    <div className="settingsImportActions">
                      {pendingRestore ? (
                        <button
                          className="btn small primary settingsImportBtn settingsImportApplyBtn"
                          disabled={isApplyingRestore}
                          onClick={handleRequestApplyRestore}
                        >
                          {isApplyingRestore ? "Applying..." : "Apply restore"}
                        </button>
                      ) : null}
                      <button className="btn small settingsImportBtn settingsImportRetryBtn" onClick={handleRestoreClick}>
                        Try another file
                      </button>
                      <button
                        className="btn small settingsImportBtn settingsImportCancelBtn"
                        disabled={isApplyingRestore}
                        onClick={resetRestoreFlow}
                      >
                        Cancel restore
                      </button>
                      <button
                        className="btn small settingsImportBtn settingsImportBackupBtn"
                        onClick={() => {
                          onBackup?.();
                        }}
                      >
                        Backup current
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="settingsSection">
                <p className="settingsSectionTitle">Actions</p>
                <div className="settingsActions">
                  <button
                    className="btn headerBtn settingsActionSecondary"
                    onClick={async () => {
                      await onTestNotification?.();
                      onClose?.();
                    }}
                  >
                    Send test
                  </button>
                </div>
              </section>

              <section className="settingsSection settingsSectionDanger">
                <p className="settingsSectionTitle">Danger zone</p>
                <span className="settingsDangerHint">This permanently removes your current bill list.</span>

                <button
                  className="btn danger headerBtn"
                  onClick={() => {
                    onClear?.();
                    onClose?.();
                  }}
                >
                  Clear all bills
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>

      {applyRestoreConfirmOpen ? (
        <div
          className="modalBackdrop confirmBackdrop"
          onMouseDown={(e) => {
            e.stopPropagation();
            setApplyRestoreConfirmOpen(false);
          }}
        >
          <div
            className="modal modal-sm confirmModal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="confirmBody">
              <div className="confirmTitleRow">
                <h3>Apply restore?</h3>
              </div>
              <p className="muted confirmText">
                This will run <strong>{confirmModeLabel}</strong> on your current list.
              </p>
              <div className="settingsRestoreConfirmMeta" role="status" aria-live="polite">
                <span>Added: {Number(confirmPreview.added || 0)}</span>
                <span>Updated: {Number(confirmPreview.updated || 0)}</span>
                <span>Removed: {confirmDeletedCount}</span>
                <span>Kept: {Number(confirmPreview.skipped || 0)}</span>
              </div>
              {restoreMode === "replace" && confirmDeletedCount > 0 ? (
                <p className="confirmText settingsRestoreConfirmWarn">
                  This will remove {confirmDeletedCount} current bill
                  {confirmDeletedCount === 1 ? "" : "s"} not present in the backup.
                </p>
              ) : null}
              {restoreMode === "merge" && confirmConflictCount > 0 ? (
                <p className="confirmText settingsRestoreConfirmWarn">
                  {restoreConflictPolicy === "skip"
                    ? `Conflicts detected (${confirmConflictCount}). Keeping ${confirmSkippedCount} current bill${confirmSkippedCount === 1 ? "" : "s"}.`
                    : `Conflicts detected (${confirmConflictCount}). Existing bills will be overwritten.`}
                </p>
              ) : null}
              <div className="confirmActions">
                <button
                  className="btn small"
                  disabled={isApplyingRestore}
                  onClick={() => setApplyRestoreConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn small danger confirmDangerBtn"
                  disabled={isApplyingRestore}
                  onClick={handleApplyRestore}
                >
                  {isApplyingRestore ? "Applying..." : "Yes, apply"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
