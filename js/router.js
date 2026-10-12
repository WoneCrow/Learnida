/**
 * router.js
 * Routeur SPA très simple basé sur location.hash.
 * Format des routes : #/segment1/segment2/...
 */

const Router = (() => {
  let onChangeHandler = null;

  function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, '');
    const segments = raw.length ? raw.split('/').map(decodeURIComponent) : [];
    return segments;
  }

  function navigate(pathSegments) {
    if (window.AudioFX) AudioFX.playClick();
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments;
    const target = `#/${path}`;
    if (window.location.hash === target) {
      // Même route : on force quand même le re-rendu (ex: relancer une session)
      onChangeHandler && onChangeHandler(parseHash());
    } else {
      window.location.hash = target;
    }
  }

  function init(handler) {
    onChangeHandler = handler;
    window.addEventListener('hashchange', () => handler(parseHash()));
    handler(parseHash());
  }

  return { init, navigate, parseHash };
})();

window.Router = Router;
