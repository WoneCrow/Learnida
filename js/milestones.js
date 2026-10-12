/**
 * milestones.js
 * Petits jalons permanents, distincts du badge de prestige par séquence.
 * Une fois débloqué, un jalon n'est jamais retiré (même logique que le
 * badge de prestige). Deux familles de vérifications :
 *  - "légères" (niveau, série, volume de questions) : bon marché, évaluées
 *    après chaque réponse.
 *  - "maîtrise" (une matière à 90%+) : plus coûteuses, évaluées seulement
 *    en fin de session.
 */

const Milestones = (() => {
  const CHEAP_DEFS = [
    { id: 'streak-3', icon: '🔥', title: '3 jours d\'affilée', check: (ctx) => ctx.streak >= 3 },
    { id: 'streak-7', icon: '🔥', title: '7 jours d\'affilée', check: (ctx) => ctx.streak >= 7 },
    { id: 'streak-30', icon: '🔥', title: '30 jours d\'affilée', check: (ctx) => ctx.streak >= 30 },
    { id: 'level-10', icon: '⭐', title: 'Niveau 10 atteint', check: (ctx) => ctx.level >= 10 },
    { id: 'level-20', icon: '⭐', title: 'Niveau 20 atteint', check: (ctx) => ctx.level >= 20 },
    { id: 'questions-100', icon: '📚', title: '100 questions jouées', check: (ctx) => ctx.totalPlayed >= 100 },
    { id: 'questions-500', icon: '📚', title: '500 questions jouées', check: (ctx) => ctx.totalPlayed >= 500 }
  ];

  const MASTERY_DEFS = [
    { id: 'mastery-90', icon: '🎯', title: 'Une matière maîtrisée à 90 %', check: (ctx) => ctx.bestSubjectMastery >= 90 }
  ];

  const ALL_DEFS = [...CHEAP_DEFS, ...MASTERY_DEFS];

  async function getEarned() {
    return Storage.getAll('milestones');
  }

  async function getEarnedIds() {
    const all = await getEarned();
    return new Set(all.map((m) => m.id));
  }

  async function unlockNew(defs, ctx) {
    const earnedIds = await getEarnedIds();
    const newly = [];
    for (const def of defs) {
      if (earnedIds.has(def.id)) continue;
      if (def.check(ctx)) {
        await Storage.putRecord('milestones', { id: def.id, earnedAt: Date.now() });
        newly.push(def);
      }
    }
    return newly;
  }

  /** À appeler après chaque réponse (peu coûteux : pas de scan des matières). */
  async function evaluateCheap({ level, totalPlayed, streak }) {
    return unlockNew(CHEAP_DEFS, { level, totalPlayed, streak });
  }

  /** À appeler en fin de session (scan de la maîtrise par matière). */
  async function evaluateMastery() {
    const subjects = Questions.getSubjects();
    let best = 0;
    for (const s of subjects) {
      const stats = await Stats.getSubjectStats(s.id);
      if (stats.mastery !== null && stats.mastery > best) best = stats.mastery;
    }
    return unlockNew(MASTERY_DEFS, { bestSubjectMastery: best });
  }

  function getDefinition(id) {
    return ALL_DEFS.find((d) => d.id === id) || null;
  }

  return { ALL_DEFS, getEarned, getEarnedIds, evaluateCheap, evaluateMastery, getDefinition };
})();

window.Milestones = Milestones;
