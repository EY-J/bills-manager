function backupKeyFor(key) {
  return `${key}__backup`;
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function archiveCorruptRaw(key, raw) {
  if (!raw) return;
  try {
    localStorage.setItem(`${key}__corrupt_${Date.now()}`, raw);
  } catch {
    // ignore if quota/security blocks archival
  }
}

export const localStorageAdapter = {
  get(key) {
    const raw = localStorage.getItem(key);
    const parsed = safeParse(raw);
    if (parsed !== null) return parsed;

    // Recover from malformed primary payload using backup copy.
    if (raw) {
      archiveCorruptRaw(key, raw);
      localStorage.removeItem(key);
    }

    const backupRaw = localStorage.getItem(backupKeyFor(key));
    const backupParsed = safeParse(backupRaw);
    if (backupParsed !== null) {
      try {
        localStorage.setItem(key, backupRaw);
      } catch {
        // ignore restore write failure
      }
      return backupParsed;
    }

    return null;
  },

  set(key, value) {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    try {
      localStorage.setItem(backupKeyFor(key), serialized);
    } catch {
      // ignore if quota/security blocks backup mirror
    }
  },

  remove(key) {
    localStorage.removeItem(key);
    localStorage.removeItem(backupKeyFor(key));
  },
};
