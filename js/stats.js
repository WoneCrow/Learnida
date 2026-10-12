/**
 * stats.js
 * Calcule les statistiques affichées dans la page "Stats", à partir des
 * données de progression (profil, stats par question, progression séquence).
 */

const Stats = (() => {
  function successRate(correct, incorrect) {
    const total = correct + incorrect;
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }

  async function getGlobalStats() {
    const profile = await Progression.getProfile();
    const levelInfo = Progression.levelProgress(profile.xp);
    return {
      xp: profile.xp,
      level: levelInfo.level,
      levelInfo,
      totalPlayed: profile.totalPlayed,
      correct: profile.correct,
      incorrect: profile.incorrect,
      successRate: successRate(profile.correct, profile.incorrect),
      bestSessionScore: profile.bestSessionScore,
      sessionsCompleted: profile.sessionsCompleted
    };
  }

  async function statsForQuestionSet(questions) {
    const allStats = await Progression.getAllQuestionStats();
    const statsById = {};
    for (const s of allStats) statsById[s.id] = s;

    let played = 0;
    let correct = 0;
    let incorrect = 0;

    for (const q of questions) {
      const s = statsById[q.id];
      if (s) {
        played += s.attempts;
        correct += s.correct;
        incorrect += s.incorrect;
      }
    }

    const mastery = await Progression.computeMastery(questions.map((q) => q.id));

    return {
      questionsPlayed: played,
      correct,
      incorrect,
      successRate: successRate(correct, incorrect),
      mastery: mastery.mastery
    };
  }

  async function getSubjectStats(subjectId) {
    const questions = Questions.getQuestionsForSubject(subjectId);
    const base = await statsForQuestionSet(questions);

    const sequences = Questions.getSequencesForSubject(subjectId);
    const allProgress = await Progression.getAllSequenceProgress();
    const progressById = {};
    for (const p of allProgress) progressById[p.sequenceId] = p;

    let sessionsCompleted = 0;
    for (const seq of sequences) {
      const p = progressById[seq.uid];
      if (p) sessionsCompleted += p.sessionsCompleted;
    }

    return { ...base, sessionsCompleted };
  }

  async function getSequenceStats(subjectId, sequenceId) {
    const questions = Questions.getQuestionsForSequence(subjectId, sequenceId);
    const base = await statsForQuestionSet(questions);
    const meta = Questions.getSequenceMeta(subjectId, sequenceId);
    const progress = await Progression.getSequenceProgress(meta ? meta.uid : sequenceId, meta);

    return {
      ...base,
      sessionsCompleted: progress.sessionsCompleted,
      bestScore: progress.bestScore,
      prestigeStreak: progress.prestigeStreak,
      badgeEarned: progress.badgeEarned
    };
  }

  return { getGlobalStats, getSubjectStats, getSequenceStats, successRate };
})();

window.Stats = Stats;
