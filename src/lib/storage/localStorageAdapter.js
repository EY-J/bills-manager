export const localStorageAdapter = {
  get(key) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};
