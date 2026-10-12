/**
 * quiz.js
 * Moteur de session de quiz. Un seul objet "QuizSession" gère les 4 modes :
 *  - random           : toutes les questions, infini, cycle mélangé
 *  - classic-global    : toutes les questions d'une matière, infini, cycle mélangé
 *  - classic-sequence  : questions d'une séquence, une fois chacune, session finie
 *  - exam              : N questions, correction uniquement à la fin, pas d'XP
 */

const Quiz = (() => {
  /**
   * Retourne un clone de la question avec ses options mélangées
   * aléatoirement (et les index de bonne(s) réponse(s) remappés en
   * conséquence). L'id, le texte, l'explication et l'image restent
   * identiques : seule la présentation (ordre A/B/C/D) change à chaque
   * apparition de la question.
   */
  function shuffleOptions(question) {
    const order = Progression.simpleShuffle(question.options.map((_, i) => i));
    const options = order.map((originalIndex) => question.options[originalIndex]);
    const answer = question.answer
      .map((originalIndex) => order.indexOf(originalIndex))
      .sort((a, b) => a - b);
    return { ...question, options, answer };
  }

  function shuffleOptionsForAll(questions) {
    return questions.map(shuffleOptions);
  }

  async function buildCycle(pool, avoidFirstId) {
    let order = await Progression.weightedShuffle(pool);
    let attempts = 0;
    while (avoidFirstId && order.length > 1 && order[0].id === avoidFirstId && attempts < 5) {
      order = await Progression.weightedShuffle(pool);
      attempts += 1;
    }
    return shuffleOptionsForAll(order);
  }

  function createSession() {
    return {
      mode: null,
      label: '',
      pool: [],
      order: [],
      pointer: 0,
      infinite: false,
      finished: false,
      lastCycleLastId: null,
      answers: [], // { question, selected, correct }
      correctCount: 0,
      incorrectCount: 0,
      sequenceMeta: null, // pour classic-sequence : contexte du badge
      targetCount: null,  // objectif de session facultatif (modes infinis)
      answeredCount: 0,   // nombre de réponses données (hors examen : sert au ciblage)
      runStreak: 0,       // série de bonnes réponses consécutives EN COURS (cette session)
      bestRunStreak: 0,
      xpGained: 0         // somme des deltas XP de cette session
    };
  }

  /**
   * scope: { type: 'all' } | { type: 'subject', subjectId } | { type: 'sequence', sequenceId }
   */
  async function startRandom(targetCount = null) {
    const session = createSession();
    session.mode = 'random';
    session.label = 'Mode aléatoire';
    session.infinite = true;
    session.targetCount = targetCount;
    session.pool = Questions.getAllQuestions();
    if (!session.pool.length) throw new Error('Aucune question disponible.');
    session.order = await buildCycle(session.pool, null);
    return session;
  }

  async function startClassicGlobal(subjectId, targetCount = null) {
    const subject = Questions.getSubjectMeta(subjectId);
    const session = createSession();
    session.mode = 'classic-global';
    session.label = subject ? `${subject.name} · Global` : 'Global';
    session.infinite = true;
    session.targetCount = targetCount;
    session.pool = Questions.getQuestionsForSubject(subjectId);
    if (!session.pool.length) throw new Error('Aucune question disponible pour cette matière.');
    session.order = await buildCycle(session.pool, null);
    return session;
  }

  async function startClassicSequence(subjectId, sequenceId) {
    const meta = Questions.getSequenceMeta(subjectId, sequenceId);
    const session = createSession();
    session.mode = 'classic-sequence';
    session.label = meta ? meta.name : 'Séquence';
    session.infinite = false;
    session.pool = Questions.getQuestionsForSequence(subjectId, sequenceId);
    session.sequenceMeta = meta;
    if (!session.pool.length) throw new Error('Aucune question disponible pour cette séquence.');
    session.order = shuffleOptionsForAll(await Progression.weightedShuffle(session.pool));
    return session;
  }

  /**
   * scope: { type: 'subject', subjectId } | { type: 'sequence', subjectId, sequenceId }
   */
  async function startExam(scope, count) {
    const session = createSession();
    session.mode = 'exam';
    session.infinite = false;

    let pool;
    if (scope.type === 'sequence') {
      const meta = Questions.getSequenceMeta(scope.subjectId, scope.sequenceId);
      pool = Questions.getQuestionsForSequence(scope.subjectId, scope.sequenceId);
      session.label = meta ? `Examen · ${meta.name}` : 'Examen';
    } else {
      const subject = Questions.getSubjectMeta(scope.subjectId);
      pool = Questions.getQuestionsForSubject(scope.subjectId);
      session.label = subject ? `Examen · ${subject.name} (Global)` : 'Examen';
    }
    if (!pool.length) throw new Error('Aucune question disponible pour cet examen.');

    const shuffled = Progression.simpleShuffle(pool);
    const total = Math.min(count, shuffled.length);
    session.pool = shuffled.slice(0, total);
    session.order = shuffleOptionsForAll(session.pool);
    return session;
  }

  function currentQuestion(session) {
    if (session.pointer >= session.order.length) return null;
    return session.order[session.pointer];
  }

  function gradeAnswer(question, selectedIndices) {
    const selected = [...selectedIndices].sort((a, b) => a - b);
    const correctAnswer = [...question.answer].sort((a, b) => a - b);
    const isCorrect = selected.length === correctAnswer.length
      && selected.every((v, i) => v === correctAnswer[i]);
    return isCorrect;
  }

  /**
   * Soumet une réponse. Pour les modes avec correction immédiate, met à jour
   * XP + stats de répétition et renvoie le résultat détaillé.
   * Pour l'examen : stocke la réponse, ne touche pas à l'XP, ne renvoie pas
   * la correction (elle sera visible seulement au résultat final).
   */
  async function submitAnswer(session, question, selectedIndices) {
    const isCorrect = gradeAnswer(question, selectedIndices);

    if (session.mode === 'exam') {
      session.answers.push({ question, selected: selectedIndices, correct: isCorrect });
      if (isCorrect) session.correctCount += 1; else session.incorrectCount += 1;
      // On alimente quand même les statistiques de répétition (utile pour la
      // maîtrise), mais SANS toucher à l'XP, conformément aux règles de l'examen.
      await Progression.recordQuestionAnswer(question.id, isCorrect);
      return { exam: true, correct: isCorrect };
    }

    await Progression.recordQuestionAnswer(question.id, isCorrect);
    const xpResult = await Progression.applyAnswer(isCorrect);

    if (isCorrect) session.correctCount += 1; else session.incorrectCount += 1;
    session.answers.push({ question, selected: selectedIndices, correct: isCorrect });
    session.answeredCount += 1;
    session.xpGained += xpResult.delta;
    if (isCorrect) {
      session.runStreak += 1;
      session.bestRunStreak = Math.max(session.bestRunStreak, session.runStreak);
    } else {
      session.runStreak = 0;
    }

    return {
      exam: false,
      correct: isCorrect,
      correctAnswer: question.answer,
      explanation: question.explanation,
      xp: xpResult,
      runStreak: session.runStreak
    };
  }

  /** True si une session à objectif (modes infinis) a atteint sa cible. */
  function targetReached(session) {
    return session.infinite && session.targetCount && session.answeredCount >= session.targetCount;
  }

  /**
   * Avance à la question suivante. Pour les modes infinis, régénère un
   * nouveau cycle mélangé lorsque le précédent est épuisé.
   * Retourne false si la session est terminée (modes finis).
   */
  async function advance(session) {
    session.pointer += 1;

    if (session.pointer >= session.order.length) {
      if (session.infinite) {
        session.lastCycleLastId = session.order[session.order.length - 1]?.id || null;
        session.order = await buildCycle(session.pool, session.lastCycleLastId);
        session.pointer = 0;
        return true;
      }
      session.finished = true;
      return false;
    }
    return true;
  }

  /** À appeler uniquement pour le mode classic-sequence, une fois terminé. */
  async function finalizeSequenceSession(session) {
    const total = session.order.length;
    const ratio = total > 0 ? Math.round((session.correctCount / total) * 100) : 0;
    const progress = await Progression.recordSequenceSession(
      session.sequenceMeta.uid,
      session.sequenceMeta,
      ratio
    );
    return { ratio, correct: session.correctCount, incorrect: session.incorrectCount, total, progress };
  }

  function examSummary(session) {
    const total = session.order.length;
    const ratio = total > 0 ? Math.round((session.correctCount / total) * 100) : 0;
    const incorrectAnswers = session.answers.filter((a) => !a.correct);
    return {
      ratio,
      correct: session.correctCount,
      incorrect: session.incorrectCount,
      total,
      incorrectAnswers
    };
  }

  /** Récapitulatif pour les modes infinis (aléatoire / classique global), quand
   *  l'objectif est atteint ou que l'utilisateur choisit de terminer. */
  function freeSummary(session) {
    const total = session.answeredCount;
    const ratio = total > 0 ? Math.round((session.correctCount / total) * 100) : 0;
    return {
      ratio,
      correct: session.correctCount,
      incorrect: session.incorrectCount,
      total,
      xpGained: session.xpGained,
      bestStreak: session.bestRunStreak
    };
  }

  return {
    startRandom,
    startClassicGlobal,
    startClassicSequence,
    startExam,
    currentQuestion,
    submitAnswer,
    advance,
    targetReached,
    finalizeSequenceSession,
    freeSummary,
    examSummary
  };
})();

window.Quiz = Quiz;
