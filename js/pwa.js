/**
 * pwa.js
 * Tout ce qui concerne Learnida en tant qu'application installable :
 *  - enregistrement du service worker (+ détection des mises à jour) ;
 *  - installation : capture de l'invite native (Chrome/Edge/Android/desktop),
 *    aide dédiée pour iPhone/iPad (Safari n'a pas d'invite native) ;
 *  - détection "déjà installée" (mode standalone) ;
 *  - indicateur hors ligne / retour en ligne.
 *
 * Ce module est autonome : app.js l'interroge via window.PWA et s'abonne aux
 * changements avec PWA.onChange(callback).
 */

const PWA = (() => {
  const DISMISS_KEY = 'learnida.installCard.dismissedUntil';
  const DISMISS_DAYS = 14;

  let deferredPrompt = null;
  let installed = false;
  const listeners = new Set();

  function notify() {
    listeners.forEach((cb) => { try { cb(); } catch (err) { /* un abonné ne doit jamais casser les autres */ } });
  }

  // ---------- État ----------

  /** true si l'app tourne déjà comme une application installée (ou APK Capacitor). */
  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches
        || window.navigator.standalone === true
        || document.referrer.startsWith('android-app://')
        || (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (err) {
      return false;
    }
  }

  function isIos() {
    const ua = navigator.userAgent || '';
    const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; // iPadOS se fait passer pour un Mac
    return /iPad|iPhone|iPod/.test(ua) || iPadOs;
  }

  /** Safari iOS uniquement : seul navigateur iOS capable d'ajouter à l'écran d'accueil de façon fiable. */
  function isIosSafari() {
    const ua = navigator.userAgent || '';
    return isIos() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  }

  /** Installation en un tap possible (invite native disponible). */
  function canInstall() {
    return !!deferredPrompt && !installed && !isStandalone();
  }

  /** Installation possible mais manuelle (iPhone/iPad). */
  function needsManualIosInstall() {
    return isIos() && !installed && !isStandalone();
  }

  async function promptInstall() {
    if (!deferredPrompt) return 'unavailable';
    const promptEvent = deferredPrompt;
    deferredPrompt = null; // une invite ne peut servir qu'une seule fois
    promptEvent.prompt();
    let outcome = 'dismissed';
    try {
      const choice = await promptEvent.userChoice;
      outcome = choice && choice.outcome;
    } catch (err) { /* ignoré */ }
    notify();
    return outcome;
  }

  // ---------- Carte d'installation "ignorée pendant N jours" ----------
  // (localStorage = simple confort par appareil : s'il est indisponible, la carte réapparaît, sans conséquence)

  function isCardDismissed() {
    try {
      const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return Date.now() < until;
    } catch (err) {
      return false;
    }
  }

  function dismissCard() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000));
    } catch (err) { /* ignoré */ }
    notify();
  }

  function shouldShowInstallCard() {
    if (isStandalone() || installed || isCardDismissed()) return false;
    return canInstall() || needsManualIosInstall();
  }

  function onChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  // ---------- Événements navigateur ----------

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // on affiche NOTRE bouton, au bon moment
    deferredPrompt = event;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    if (window.UI) UI.toast('Learnida est installé sur cet appareil 🎉', 'success');
    notify();
  });

  // Passage en mode installé (ex. l'utilisateur installe via le menu du navigateur)
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', notify);
  } catch (err) { /* anciens navigateurs */ }

  // ---------- Hors ligne ----------

  let wasOffline = !navigator.onLine;
  window.addEventListener('offline', () => {
    wasOffline = true;
    if (window.UI) UI.toast('📴 Mode hors ligne — tout reste disponible', 'info');
  });
  window.addEventListener('online', () => {
    if (wasOffline && window.UI) UI.toast('✅ De nouveau en ligne', 'success');
    wasOffline = false;
  });

  // ---------- Service worker + mises à jour ----------

  function register() {
    if (!('serviceWorker' in navigator)) return;

    // Une nouvelle version ne remplace l'ancienne qu'à la prochaine ouverture de l'app :
    // on prévient simplement l'utilisateur (jamais de rechargement forcé en plein quiz).
    const hadController = !!navigator.serviceWorker.controller;
    let notified = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || notified) return;
      notified = true;
      if (window.UI) UI.toast('🔄 Nouvelle version prête — rouvrez l\'app pour en profiter', 'success');
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((registration) => {
        // Vérifie les mises à jour à chaque retour au premier plan (app installée = rarement rechargée).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });
      }).catch(() => {
        // Installation hors ligne indisponible (ex : ouverture en file://) :
        // l'application reste fonctionnelle tant que la connexion est active.
      });
    });
  }

  register();

  return {
    isStandalone,
    isIos,
    isIosSafari,
    canInstall,
    needsManualIosInstall,
    promptInstall,
    shouldShowInstallCard,
    dismissCard,
    onChange
  };
})();

window.PWA = PWA;
