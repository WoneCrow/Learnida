/**
 * settings.js
 * Préférences persistées dans IndexedDB (store "settings").
 */

const Settings = (() => {
  const KEY = 'settings';
  let cache = null;

  function defaults() {
    return {
      key: KEY,
      theme: 'dark',
      sound: true,
      vibration: true,
      notifications: false
    };
  }

  async function get() {
    if (cache) return cache;
    let s = null;
    try {
      s = await Storage.getRecord('settings', KEY);
    } catch (err) {
      s = null;
    }
    if (!s) {
      s = defaults();
      try { await Storage.putRecord('settings', s); } catch (err) { /* silencieux */ }
    }
    cache = s;
    return s;
  }

  async function update(patch) {
    const current = await get();
    const next = { ...current, ...patch };
    cache = next;
    try {
      await Storage.putRecord('settings', next);
    } catch (err) {
      console.warn('[Learnida] Impossible d\'enregistrer les préférences.', err);
    }
    applyTheme(next.theme);
    return next;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  async function init() {
    const s = await get();
    applyTheme(s.theme);
    return s;
  }

  return { get, update, init, applyTheme };
})();

window.Settings = Settings;
