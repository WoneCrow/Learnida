/**
 * audio.js
 * Lit des fichiers son (.mp3) placés dans assets/sounds/. Respecte le
 * réglage "sons" des préférences. Si un fichier est absent, corrompu, ou si
 * la lecture est bloquée par le navigateur, l'échec est silencieux : le jeu
 * ne doit jamais planter pour un problème de son.
 *
 * Fichiers attendus (remplaçables par les tiens, mêmes noms) :
 *   assets/sounds/click.mp3     -> clic / navigation générale
 *   assets/sounds/correct.mp3   -> bonne réponse
 *   assets/sounds/incorrect.mp3 -> mauvaise réponse
 *   assets/sounds/badge.mp3     -> badge de prestige / jalon obtenu
 *   assets/sounds/bgm.mp3       -> musique de fond, en boucle pendant une session de jeu
 */

const AudioFX = (() => {
  const SOUND_FILES = {
    click: 'assets/sounds/click.mp3',
    correct: 'assets/sounds/correct.mp3',
    incorrect: 'assets/sounds/incorrect.mp3',
    badge: 'assets/sounds/badge.mp3'
  };

  const BGM_SRC = 'assets/sounds/bgm.mp3';
  const BGM_VOLUME = 0.32;

  const VOLUME = {
    click: 0.45,
    correct: 0.8,
    incorrect: 0.8,
    badge: 0.85
  };

  let bgmEl = null;
  let bgmWanted = false; // true si une session de jeu est active et souhaite le BGM

  async function soundEnabled() {
    try {
      const s = await Settings.get();
      return !!s.sound;
    } catch (err) {
      return true;
    }
  }

  async function play(name) {
    if (!(await soundEnabled())) return;
    const src = SOUND_FILES[name];
    if (!src) return;
    try {
      // window.Audio : constructeur natif du navigateur (non redéfini ici).
      const audio = new window.Audio(src);
      audio.volume = VOLUME[name] ?? 0.7;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => { /* lecture bloquée ou fichier indisponible : on ignore */ });
      }
    } catch (err) {
      // Ne jamais interrompre le jeu pour un problème de lecture audio.
    }
  }

  const playClick = () => play('click');
  const playCorrect = () => play('correct');
  const playIncorrect = () => play('incorrect');
  const playBadge = () => play('badge');

  function getBgmEl() {
    if (!bgmEl) {
      bgmEl = new window.Audio(BGM_SRC);
      bgmEl.loop = true;
      bgmEl.volume = BGM_VOLUME;
      bgmEl.preload = 'auto';
    }
    return bgmEl;
  }

  /** À appeler quand une session de jeu démarre. */
  async function startBgm() {
    bgmWanted = true;
    if (!(await soundEnabled())) return;
    try {
      const el = getBgmEl();
      if (el.paused) {
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay bloqué : ignoré */ });
      }
    } catch (err) {
      // silencieux
    }
  }

  /** À appeler quand on quitte une session de jeu (retour, fin de session...). */
  function stopBgm() {
    bgmWanted = false;
    if (bgmEl) {
      bgmEl.pause();
      bgmEl.currentTime = 0;
    }
  }

  /** À appeler quand le réglage "sons" change, pour réagir immédiatement. */
  async function refreshBgmForSettings() {
    const enabled = await soundEnabled();
    if (!enabled) {
      if (bgmEl) bgmEl.pause();
      return;
    }
    if (bgmWanted) startBgm();
  }

  // Politesse : on coupe le BGM si l'onglet passe en arrière-plan, et on le
  // reprend au retour si une session est toujours en cours.
  document.addEventListener('visibilitychange', () => {
    if (!bgmEl) return;
    if (document.hidden) {
      bgmEl.pause();
    } else if (bgmWanted) {
      startBgm();
    }
  });

  async function vibrateWrong() {
    try {
      const s = await Settings.get();
      if (!s.vibration) return;
      if (navigator && typeof navigator.vibrate === 'function') {
        navigator.vibrate(120);
      }
    } catch (err) {
      // On n'interrompt jamais le jeu pour un problème de vibration.
    }
  }

  return {
    playClick,
    playCorrect,
    playIncorrect,
    playBadge,
    startBgm,
    stopBgm,
    refreshBgmForSettings,
    vibrateWrong
  };
})();

window.AudioFX = AudioFX;
