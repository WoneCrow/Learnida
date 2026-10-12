/**
 * questions.js
 * Charge subjects.json et les fichiers de questions associés, les met en
 * cache mémoire, et expose des vues pratiques (par UE / matière / séquence /
 * toutes les questions à plat avec leur contexte).
 *
 * IMPORTANT — unicité des identifiants :
 * Les fichiers de contenu peuvent réutiliser les mêmes ids de séquence
 * (ex. "sequence-1" dans chaque matière) ou les mêmes ids de question
 * (ex. "s4-q001" copié d'un gabarit). C'est un cas tout à fait normal quand
 * le contenu est écrit à la main ou généré matière par matière : on ne
 * demande pas à l'auteur de gérer un espace de noms global.
 *
 * Ce module absorbe donc cette réalité : en interne, chaque séquence et
 * chaque question reçoit un identifiant unique COMPOSÉ (matière + séquence
 * [+ question]), utilisé pour tout le stockage (IndexedDB) et le routage.
 * L'id d'origine reste disponible (question.rawId) pour l'export/affichage,
 * mais aucun autre module n'a besoin d'y penser : Quiz, Progression, Notes,
 * Stats manipulent toujours "l'id de la question" comme avant, il est
 * simplement garanti unique dès la source.
 */

const Questions = (() => {
  let subjectsConfig = null;      // contenu brut de subjects.json
  let flatIndex = null;           // { ues, subjects, sequences, questionsBySequence, allQuestions }
  let loadError = null;

  async function fetchJSON(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Fichier introuvable : ${path} (HTTP ${res.status})`);
    }
    return res.json();
  }

  /** Clé interne unique pour une séquence : insensible aux ids de séquence
   *  dupliqués d'une matière à l'autre (ex. "sequence-1" partout). */
  function sequenceUid(subjectId, sequenceId) {
    return `${subjectId}::${sequenceId}`;
  }

  /** Accepte un tableau de questions tel quel, ou un objet enveloppant le
   *  tableau sous une clé courante ("quiz", "questions", "items", "data"). */
  function extractQuestionArray(raw, context) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      for (const key of ['quiz', 'questions', 'items', 'data']) {
        if (Array.isArray(raw[key])) {
          console.info(`[Learnida] ${context} : tableau de questions trouvé sous la clé "${key}" (format enveloppé, accepté automatiquement).`);
          return raw[key];
        }
      }
    }
    throw new Error('Le fichier ne contient pas un tableau de questions reconnaissable.');
  }

  /**
   * Charge la configuration puis TOUS les fichiers de questions en parallèle
   * (bien plus rapide qu'un chargement séquentiel quand il y a beaucoup de
   * séquences). `onProgress(fait, total)` est appelé à chaque fichier terminé :
   * il alimente la barre du splash screen.
   */
  async function load(onProgress) {
    if (flatIndex) return flatIndex;
    if (loadError) throw loadError;

    const report = (done, total) => {
      try { if (onProgress) onProgress(done, total); } catch (err) { /* l'UI ne doit jamais bloquer le chargement */ }
    };

    try {
      subjectsConfig = await fetchJSON('data/config/subjects.json');
    } catch (err) {
      loadError = new Error('Impossible de charger la configuration des matières (subjects.json).');
      throw loadError;
    }

    const ues = [];
    const subjects = [];
    const sequences = [];
    const questionsBySequence = {};
    const allQuestions = [];
    const seenSequenceUids = new Set();

    // 1) On parcourt la config pour lister les séquences (dans l'ordre d'origine).
    const ueList = Array.isArray(subjectsConfig?.ues) ? subjectsConfig.ues : [];
    for (const ue of ueList) {
      ues.push({ id: ue.id, name: ue.name });

      const subjectList = Array.isArray(ue.subjects) ? ue.subjects : [];
      for (const subject of subjectList) {
        subjects.push({ id: subject.id, name: subject.name, ueId: ue.id, ueName: ue.name });

        const seqList = Array.isArray(subject.sequences) ? subject.sequences : [];
        for (const seq of seqList) {
          const meta = {
            id: seq.id,
            uid: sequenceUid(subject.id, seq.id),
            name: seq.name,
            file: seq.file,
            subjectId: subject.id,
            subjectName: subject.name,
            ueId: ue.id,
            ueName: ue.name
          };

          if (seenSequenceUids.has(meta.uid)) {
            console.warn(`[Learnida] Séquence dupliquée ignorée : "${seq.id}" apparaît deux fois dans la matière "${subject.id}".`);
            continue;
          }
          seenSequenceUids.add(meta.uid);
          sequences.push(meta);
        }
      }
    }

    // 2) On télécharge tous les fichiers en même temps.
    const total = sequences.length + 1; // +1 pour subjects.json déjà chargé
    let done = 1;
    report(done, total);

    const rawBySequence = await Promise.all(sequences.map(async (meta) => {
      const context = `${meta.subjectId}/${meta.file}`;
      let raw = [];
      try {
        const rawData = await fetchJSON(`data/questions/${meta.subjectId}/${meta.file}`);
        raw = extractQuestionArray(rawData, context);
      } catch (err) {
        console.error(`[Learnida] Erreur de chargement pour ${context}`, err.message || err);
        raw = [];
      }
      done += 1;
      report(done, total);
      return raw;
    }));

    // 3) Validation, dans l'ordre d'origine (Promise.all conserve l'ordre).
    sequences.forEach((meta, i) => {
      const context = `${meta.subjectId}/${meta.file}`;
      const validated = [];
      const seenRawIdsInSequence = new Set();
      rawBySequence[i].forEach((q, index) => {
        const cleaned = validateQuestion(q, meta, index);
        if (!cleaned) return;
        if (seenRawIdsInSequence.has(cleaned.rawId)) {
          console.warn(`[Learnida] Id de question dupliqué dans ${context} : "${cleaned.rawId}" (les deux exemplaires sont conservés, distingués automatiquement).`);
        }
        seenRawIdsInSequence.add(cleaned.rawId);
        validated.push(cleaned);
      });

      questionsBySequence[meta.uid] = validated;
      for (const q of validated) allQuestions.push(q);
    });

    flatIndex = { ues, subjects, sequences, questionsBySequence, allQuestions };
    return flatIndex;
  }

  const TYPE_ALIASES = {
    single: 'single',
    multiple: 'multiple',
    true_false: 'true_false',
    boolean: 'true_false',
    bool: 'true_false',
    truefalse: 'true_false',
    'vrai_faux': 'true_false'
  };

  function validateQuestion(q, meta, index) {
    if (!q || typeof q !== 'object') return null;
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
      console.warn(`[Learnida] Question mal configurée ignorée (${meta.subjectId}/${meta.id}, index ${index}) :`, q);
      return null;
    }

    // L'id d'origine (tel qu'écrit dans le fichier) peut manquer ou être
    // dupliqué : dans les deux cas on ne rejette pas la question, on la
    // rend simplement identifiable de façon unique en interne.
    const rawId = (q.id !== undefined && q.id !== null && String(q.id).trim() !== '')
      ? String(q.id)
      : `auto-${index + 1}`;
    const uniqueId = `${meta.subjectId}::${meta.id}::${rawId}::${index}`;

    const normalizedType = typeof q.type === 'string' ? q.type.trim().toLowerCase() : '';
    const type = TYPE_ALIASES[normalizedType] || 'single';

    const answer = Array.isArray(q.answer)
      ? q.answer.filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length)
      : [];
    if (answer.length === 0) {
      console.warn(`[Learnida] Question sans réponse valide ignorée : ${meta.subjectId}/${meta.id}/${rawId}`);
      return null;
    }

    return {
      id: uniqueId,
      rawId,
      question: String(q.question),
      type,
      options: q.options.map(String),
      answer,
      explanation: q.explanation ? String(q.explanation) : '',
      image: q.image || null,
      ueId: meta.ueId,
      ueName: meta.ueName,
      subjectId: meta.subjectId,
      subjectName: meta.subjectName,
      sequenceId: meta.id,
      sequenceUid: meta.uid,
      sequenceName: meta.name
    };
  }

  function getIndexSync() {
    return flatIndex;
  }

  function getUES() {
    return flatIndex ? flatIndex.ues : [];
  }

  function getSubjects() {
    return flatIndex ? flatIndex.subjects : [];
  }

  function getSequencesForSubject(subjectId) {
    if (!flatIndex) return [];
    return flatIndex.sequences.filter((s) => s.subjectId === subjectId);
  }

  function getSequenceMeta(subjectId, sequenceId) {
    if (!flatIndex) return null;
    const uid = sequenceUid(subjectId, sequenceId);
    return flatIndex.sequences.find((s) => s.uid === uid) || null;
  }

  function getSubjectMeta(subjectId) {
    if (!flatIndex) return null;
    return flatIndex.subjects.find((s) => s.id === subjectId) || null;
  }

  function getAllQuestions() {
    return flatIndex ? flatIndex.allQuestions : [];
  }

  function getQuestionsForSequence(subjectId, sequenceId) {
    if (!flatIndex) return [];
    const uid = sequenceUid(subjectId, sequenceId);
    return flatIndex.questionsBySequence[uid] || [];
  }

  function getQuestionsForSubject(subjectId) {
    if (!flatIndex) return [];
    return flatIndex.allQuestions.filter((q) => q.subjectId === subjectId);
  }

  function getQuestionById(id) {
    if (!flatIndex) return null;
    return flatIndex.allQuestions.find((q) => q.id === id) || null;
  }

  return {
    load,
    getIndexSync,
    getUES,
    getSubjects,
    getSequencesForSubject,
    getSequenceMeta,
    getSubjectMeta,
    getAllQuestions,
    getQuestionsForSequence,
    getQuestionsForSubject,
    getQuestionById,
    sequenceUid
  };
})();

window.Questions = Questions;
