/**
 * notes.js
 * Sauvegarde des explications de questions choisies par l'utilisateur.
 * Une même question ne peut être enregistrée qu'une seule fois.
 */

const Notes = (() => {
  async function getAll() {
    const all = await Storage.getAll('notes');
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }

  async function findByQuestionId(questionId) {
    const all = await Storage.getAll('notes');
    return all.find((n) => n.questionId === questionId) || null;
  }

  async function isSaved(questionId) {
    return !!(await findByQuestionId(questionId));
  }

  async function addNote(question) {
    const existing = await findByQuestionId(question.id);
    if (existing) return existing; // pas de doublon

    const note = {
      questionId: question.id,
      ueId: question.ueId,
      ueName: question.ueName,
      subjectId: question.subjectId,
      subjectName: question.subjectName,
      sequenceId: question.sequenceId,
      sequenceName: question.sequenceName,
      questionText: question.question,
      explanation: question.explanation || '',
      savedAt: Date.now()
    };
    const id = await Storage.putRecord('notes', note);
    note.id = id;
    return note;
  }

  async function removeNote(id) {
    await Storage.deleteRecord('notes', id);
  }

  /**
   * filter: { type: 'all' | 'ue' | 'subject' | 'sequence', value?: string }
   */
  async function getFiltered(filter) {
    const all = await getAll();
    if (!filter || filter.type === 'all' || !filter.value) return all;
    const field = filter.type === 'ue' ? 'ueId' : filter.type === 'subject' ? 'subjectId' : 'sequenceId';
    return all.filter((n) => n[field] === filter.value);
  }

  return { getAll, findByQuestionId, isSaved, addNote, removeNote, getFiltered };
})();

window.Notes = Notes;
