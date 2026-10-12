/**
 * splash.js
 * Écran de démarrage (splash screen) affiché pendant le chargement des questions.
 *
 * Règles :
 *  - Durée minimale : MIN_MS (3 s) pour que l'écran soit lisible et agréable,
 *    même si les données sont déjà prêtes.
 *  - Si le chargement est plus long, on reste affiché jusqu'à ce que ce soit
 *    prêt (le message change après SLOW_MS = 5 s pour rassurer l'utilisateur).
 *  - La barre de progression est HONNÊTE : elle ne peut pas dépasser ni le temps
 *    écoulé, ni la progression réelle du chargement. Elle n'atteint 100 % que
 *    lorsque les deux sont terminés.
 *  - Accessibilité : zone vocale (aria-live) pour les lecteurs d'écran,
 *    barre exposée en role="progressbar", animations coupées si
 *    "réduire les animations" est activé (voir splash.css).
 */

const Splash = (() => {
  const MIN_MS = 3000;
  const SLOW_MS = 5000;
  const FADE_MS = 450;

  const TIPS = [
    'Se tester est plus efficace que relire : c\'est le rappel actif.',
    'Quelques minutes chaque jour valent mieux qu\'une longue session.',
    'Lisez toujours l\'explication, même quand vous avez juste.',
    'Une question ratée revient plus souvent : c\'est voulu, ça aide à retenir.',
    'Ajoutez les explications difficiles à vos notes pour les relire plus tard.',
    'Le mode examen permet de vous tester sans filet avant le jour J.'
  ];

  function pickTip() {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  /**
   * Exécute `loadFn(onProgress)` en gardant le splash affiché.
   * Résout avec le résultat de loadFn. Si loadFn échoue, le splash est retiré
   * immédiatement et l'erreur est relancée (pour afficher l'écran d'erreur).
   */
  async function run(loadFn) {
    const root = document.getElementById('splash');
    // Si le splash est absent du HTML, on charge simplement sans écran.
    if (!root) return loadFn(() => {});

    const bar = root.querySelector('.splash__bar-fill');
    const track = root.querySelector('.splash__bar');
    const status = root.querySelector('.splash__status');
    const tip = root.querySelector('.splash__tip');
    if (tip) tip.textContent = pickTip();

    const startedAt = performance.now();
    let realFraction = 0;     // progression réelle du chargement (0 → 1)
    let finished = false;     // chargement terminé ET durée minimale atteinte
    let lastShown = -1;
    let slowShown = false;

    function render(now) {
      const elapsed = now - startedAt;
      const timeFraction = Math.min(1, elapsed / MIN_MS);
      const shown = Math.min(timeFraction, realFraction);

      if (shown !== lastShown) {
        lastShown = shown;
        // scaleX = animation sur le GPU : fluide même sur un téléphone modeste.
        if (bar) bar.style.transform = `scaleX(${shown})`;
        if (track) track.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
      }

      if (!slowShown && elapsed > SLOW_MS && realFraction < 1 && status) {
        slowShown = true;
        status.textContent = 'Encore un instant…';
      }

      if (!finished) requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    const minDelay = new Promise((resolve) => setTimeout(resolve, MIN_MS));

    let result;
    try {
      result = await loadFn((done, total) => {
        realFraction = total > 0 ? Math.min(1, done / total) : 1;
      });
      realFraction = 1;
    } catch (err) {
      finished = true;
      root.remove();
      throw err;
    }

    await minDelay;
    finished = true;
    if (bar) bar.style.transform = 'scaleX(1)';
    if (track) track.setAttribute('aria-valuenow', '100');
    if (status) status.textContent = 'Prêt !';

    // Petite pause pour voir la barre pleine, puis fondu enchaîné vers l'app.
    await new Promise((resolve) => setTimeout(resolve, 200));
    root.classList.add('splash--out');
    root.setAttribute('aria-hidden', 'true');
    setTimeout(() => root.remove(), FADE_MS);

    return result;
  }

  return { run };
})();

window.Splash = Splash;
