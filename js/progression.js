/**
 * progression.js
 * Gère : XP / niveaux, statistiques par question (EMA de réussite pour la
 * répétition intelligente), progression par séquence (ratio, badge de
 * prestige permanent), et calcul de maîtrise par séquence / matière.
 */

const Progression = (() => {
  const XP_CORRECT = 50;
  const XP_INCORRECT = -40;
  const EMA_ALPHA = 0.35; // poids donné à la dernière réponse (récence)

  let profileCache = null;

  // ---------- XP & niveaux ----------

  // threshold(n) = XP requis pour ATTEINDRE le niveau n (threshold(1) = 0)
  function xpForLevel(n) {
    if (n <= 1) return 0;
    return 50 * ((n * (n + 1)) / 2 - 1);
  }

  function levelForXP(xp) {
    if (xp < xpForLevel(2)) return 1;
    let n = 1;
    // Recherche linéaire : les niveaux restent dans une plage raisonnable
    // pour un usage normal ; largement suffisant en pratique.
    while (xpForLevel(n + 1) <= xp) {
      n += 1;
      if (n > 500) break; // garde-fou
    }
    return n;
  }

  function levelProgress(xp) {
    const level = levelForXP(xp);
    const currentFloor = xpForLevel(level);
    const nextFloor = xpForLevel(level + 1);
    const span = nextFloor - currentFloor;
    const gained = Math.max(0, xp - currentFloor);
    const ratio = span > 0 ? Math.min(1, gained / span) : 1;
    return {
      level,
      xp,
      currentLevelFloor: currentFloor,
      nextLevelFloor: nextFloor,
      xpIntoLevel: gained,
      xpNeededForNext: span,
      ratio
    };
  }

  async function getProfile() {
    if (profileCache) return profileCache;
    let profile = await Storage.getRecord('profile', 'profile');
    if (!profile) {
      profile = defaultProfile();
      await Storage.putRecord('profile', profile);
    }
    profileCache = profile;
    return profile;
  }

  function defaultProfile() {
    return {
      key: 'profile',
      xp: 0,
      level: 1,
      totalPlayed: 0,
      correct: 0,
      incorrect: 0,
      sessionsCompleted: 0,
      bestSessionScore: 0,
      dailyStreak: 0,
      longestDailyStreak: 0,
      lastActiveDate: null,
      lastPlayed: null
    };
  }

  // ---------- Titres de niveau ----------

  const LEVEL_TITLES = [
    { min: 1, title: 'Novice' },
    { min: 3, title: 'Apprenti' },
    { min: 6, title: 'Initié' },
    { min: 10, title: 'Analyste' },
    { min: 15, title: 'Expert' },
    { min: 20, title: 'Virtuose' },
    { min: 30, title: 'Maître Learnida' }
  ];

  function levelTitle(level) {
    let title = LEVEL_TITLES[0].title;
    for (const t of LEVEL_TITLES) {
      if (level >= t.min) title = t.title;
      else break;
    }
    return title;
  }

  // ---------- Série quotidienne ----------

  function dateStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * À appeler une fois au démarrage de l'app. Met à jour la série de jours
   * consécutifs d'activité (calculée localement, aucune notification requise).
   */
  async function touchDailyStreak() {
    const profile = await getProfile();
    const today = dateStr();

    if (profile.lastActiveDate === today) {
      return { streak: profile.dailyStreak || 1, isNewDay: false, longest: profile.longestDailyStreak || profile.dailyStreak || 1 };
    }

    const yesterday = dateStr(new Date(Date.now() - 86400000));
    if (profile.lastActiveDate === yesterday) {
      profile.dailyStreak = (profile.dailyStreak || 0) + 1;
    } else {
      profile.dailyStreak = 1;
    }
    profile.longestDailyStreak = Math.max(profile.longestDailyStreak || 0, profile.dailyStreak);
    profile.lastActiveDate = today;
    await saveProfile(profile);
    return { streak: profile.dailyStreak, isNewDay: true, longest: profile.longestDailyStreak };
  }

  // ---------- Reprise rapide ----------

  async function setLastPlayed(info) {
    const profile = await getProfile();
    profile.lastPlayed = info; // { label, path }
    await saveProfile(profile);
  }

  async function getLastPlayed() {
    const profile = await getProfile();
    return profile.lastPlayed || null;
  }

  async function saveProfile(profile) {
    profileCache = profile;
    await Storage.putRecord('profile', profile);
  }

  /**
   * Applique le résultat d'une réponse au profil global (hors mode examen).
   * Retourne les infos utiles pour l'UI (XP gagné, changement de niveau...).
   */
  async function applyAnswer(correct) {
    const profile = await getProfile();
    const previousLevel = levelForXP(profile.xp);

    const delta = correct ? XP_CORRECT : XP_INCORRECT;
    profile.xp += delta;
    profile.totalPlayed += 1;
    if (correct) profile.correct += 1;
    else profile.incorrect += 1;
    profile.level = levelForXP(profile.xp);

    await saveProfile(profile);

    return {
      delta,
      xp: profile.xp,
      level: profile.level,
      leveledUp: profile.level > previousLevel,
      leveledDown: profile.level < previousLevel
    };
  }

  async function recordSessionCompletion({ score }) {
    const profile = await getProfile();
    profile.sessionsCompleted += 1;
    if (typeof score === 'number' && score > profile.bestSessionScore) {
      profile.bestSessionScore = score;
    }
    await saveProfile(profile);
  }

  // ---------- Statistiques par question (répétition intelligente) ----------

  function defaultQuestionStat(id) {
    return {
      id,
      attempts: 0,
      correct: 0,
      incorrect: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastAnswer: null,
      lastSeen: null,
      emaScore: null // null tant que la question n'a jamais été répondue
    };
  }

  async function getQuestionStat(id) {
    const stat = await Storage.getRecord('questionStats', id);
    return stat || defaultQuestionStat(id);
  }

  async function getAllQuestionStats() {
    return Storage.getAll('questionStats');
  }

  async function recordQuestionAnswer(id, correct) {
    const stat = await getQuestionStat(id);
    stat.attempts += 1;
    if (correct) {
      stat.correct += 1;
      stat.currentStreak += 1;
      stat.bestStreak = Math.max(stat.bestStreak, stat.currentStreak);
    } else {
      stat.incorrect += 1;
      stat.currentStreak = 0;
    }
    stat.lastAnswer = correct;
    stat.lastSeen = Date.now();
    stat.emaScore = stat.emaScore === null
      ? (correct ? 1 : 0)
      : stat.emaScore * (1 - EMA_ALPHA) + (correct ? 1 : 0) * EMA_ALPHA;

    await Storage.putRecord('questionStats', stat);
    return stat;
  }

  /**
   * Poids de priorité pour la répétition intelligente : plus une question
   * est mal maîtrisée, plus son poids est élevé. Les questions jamais vues
   * reçoivent un poids moyen (ni ignorées, ni sur-priorisées).
   */
  function priorityWeight(stat) {
    const score = stat && stat.emaScore !== null ? stat.emaScore : 0.5;
    return 1 + (1 - score) * 4; // entre 1 (maîtrisé) et 5 (mal maîtrisé)
  }

  /**
   * Mélange pondéré sans répétition (Efraimidis–Spirakis) : chaque question
   * apparaît EXACTEMENT une fois (respect de la règle "pas de répétition
   * avant la fin du cycle"), mais celles à forte priorité ont statistiquement
   * plus de chances de sortir plus tôt dans le cycle.
   */
  async function weightedShuffle(questions) {
    const statsById = {};
    const allStats = await getAllQuestionStats();
    for (const s of allStats) statsById[s.id] = s;

    const keyed = questions.map((q) => {
      const weight = priorityWeight(statsById[q.id]);
      const u = Math.random() || 1e-9;
      const key = Math.pow(u, 1 / weight);
      return { q, key };
    });

    keyed.sort((a, b) => b.key - a.key);
    return keyed.map((k) => k.q);
  }

  /** Mélange simple (Fisher-Yates), utilisé quand la pondération n'est pas nécessaire. */
  function simpleShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Progression par séquence & badge de prestige ----------

  function defaultSequenceProgress(sequenceId, meta) {
    return {
      sequenceId,
      subjectId: meta ? meta.subjectId : null,
      ueId: meta ? meta.ueId : null,
      prestigeStreak: 0,
      badgeEarned: false,
      sessionsCompleted: 0,
      bestScore: 0
    };
  }

  async function getSequenceProgress(sequenceId, meta) {
    const rec = await Storage.getRecord('sequenceProgress', sequenceId);
    return rec || defaultSequenceProgress(sequenceId, meta);
  }

  async function getAllSequenceProgress() {
    return Storage.getAll('sequenceProgress');
  }

  /**
   * À appeler à la fin d'une session "séquence" en mode classique.
   * ratioPercent : pourcentage de bonnes réponses (0-100).
   */
  async function recordSequenceSession(sequenceId, meta, ratioPercent) {
    const progress = await getSequenceProgress(sequenceId, meta);
    progress.sessionsCompleted += 1;
    progress.bestScore = Math.max(progress.bestScore, ratioPercent);

    if (ratioPercent === 100) {
      progress.prestigeStreak += 1;
      if (progress.prestigeStreak >= 3) {
        progress.badgeEarned = true; // permanent : jamais retiré
      }
    } else {
      progress.prestigeStreak = 0;
    }

    await Storage.putRecord('sequenceProgress', progress);
    await recordSessionCompletion({ score: ratioPercent });
    return progress;
  }

  // ---------- Maîtrise ----------

  /**
   * Maîtrise d'un ensemble de questions : moyenne des emaScore des questions
   * déjà tentées (les questions jamais vues ne comptent pas dans la moyenne,
   * afin de ne pas fausser artificiellement le résultat).
   */
  async function computeMastery(questionIds) {
    if (!questionIds.length) return { mastery: null, attempted: 0, total: 0 };
    const allStats = await getAllQuestionStats();
    const statsById = {};
    for (const s of allStats) statsById[s.id] = s;

    let sum = 0;
    let attempted = 0;
    for (const id of questionIds) {
      const s = statsById[id];
      if (s && s.emaScore !== null) {
        sum += s.emaScore;
        attempted += 1;
      }
    }

    if (attempted === 0) return { mastery: null, attempted: 0, total: questionIds.length };
    return {
      mastery: Math.round((sum / attempted) * 100),
      attempted,
      total: questionIds.length
    };
  }

  return {
    XP_CORRECT,
    XP_INCORRECT,
    xpForLevel,
    levelForXP,
    levelProgress,
    levelTitle,
    getProfile,
    applyAnswer,
    recordSessionCompletion,
    touchDailyStreak,
    setLastPlayed,
    getLastPlayed,
    getQuestionStat,
    getAllQuestionStats,
    recordQuestionAnswer,
    weightedShuffle,
    simpleShuffle,
    getSequenceProgress,
    getAllSequenceProgress,
    recordSequenceSession,
    computeMastery
  };
})();

window.Progression = Progression;
