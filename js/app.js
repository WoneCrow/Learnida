/**
 * app.js
 * Orchestre le routeur, les vues et les modules métier (Quiz, Progression,
 * Notes, Stats, Settings). C'est le seul fichier qui manipule directement
 * le DOM de l'écran principal (#app).
 */

(() => {
  const { el, toast, confirmModal, progressBar, xpBar, levelRing, streakChip, masteryStrip, renderQuestionText, clear } = UI;

  const appRoot = document.getElementById('app');
  const navRoot = document.getElementById('nav');

  let activeSession = null; // session de quiz en cours (Quiz.*)
  let activeSelection = new Set();
  let answered = false;
  let lastResult = null;
  let dailyStreakValue = 0;
  let explainOverlay = null;    // fenêtre d'explication centrée actuellement ouverte
  let explainKeyHandler = null; // raccourcis clavier (Entrée / Espace / →) tant qu'elle est ouverte
  let advancing = false;        // évite de passer 2 fois à la question suivante (double tap)

  // ---------- Installation PWA (logique dans js/pwa.js) ----------
  let bootDone = false;
  PWA.onChange(() => {
    // L'état d'installation a changé (invite disponible, app installée…) : on rafraîchit
    // uniquement les écrans concernés, jamais en plein quiz.
    if (!bootDone || activeSession) return;
    const [root] = Router.parseHash();
    if (!root) renderHome();
    else if (root === 'settings') renderSettingsView();
  });

  // ---------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------

  async function boot() {
    renderNav('');

    try {
      // Le splash reste affiché ≥ 3 s ; réglages (thème), questions et série
      // quotidienne se chargent pendant ce temps.
      await Splash.run(async (onProgress) => {
        await Settings.init();
        await Questions.load(onProgress);
        try {
          const streakInfo = await Progression.touchDailyStreak();
          dailyStreakValue = streakInfo.streak;
        } catch (err) {
          dailyStreakValue = 0;
        }
      });
    } catch (err) {
      renderFatalError(err);
      return;
    }

    Router.init(handleRoute);
    bootDone = true;
  }

  function renderFatalError(err) {
    clear(appRoot);
    appRoot.appendChild(el('div', { class: 'view view--error' }, [
      el('h2', {}, 'Impossible de charger Learnida'),
      el('p', {}, err.message || 'Une erreur inconnue est survenue.'),
      el('p', { class: 'muted' }, 'Vérifiez que l\'application est servie par un serveur local (les fichiers JSON ne se chargent pas en ouvrant index.html directement depuis le disque).')
    ]));
  }

  // ---------------------------------------------------------------------
  // "Juice" : retours visuels/sonores immédiats
  // ---------------------------------------------------------------------

  const CORRECT_MESSAGES = ['✅ Correct', '✅ Exact !', '✅ Bien joué', '✅ Dans le mille', '✅ Nickel'];
  const INCORRECT_MESSAGES = ['❌ Incorrect', '❌ Pas tout à fait', '❌ Raté de peu', '❌ On y revient'];

  function pickMessage(bank) {
    return bank[Math.floor(Math.random() * bank.length)];
  }

  function showXpFloat(delta) {
    if (!delta) return;
    const host = document.getElementById('app-shell') || document.body;
    const node = el('div', { class: `xp-float ${delta > 0 ? 'xp-float--pos' : 'xp-float--neg'}` }, `${delta > 0 ? '+' : ''}${delta} XP`);
    host.appendChild(node);
    setTimeout(() => node.remove(), 950);
  }

  function flashScreen(kind) {
    const overlay = el('div', { class: `screen-flash screen-flash--${kind}` });
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 260);
  }

  const CONFETTI_COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--success)', 'var(--warning)'];

  function burstConfetti() {
    const host = el('div', { class: 'confetti-host' });
    document.body.appendChild(host);
    const pieces = 26;
    for (let i = 0; i < pieces; i += 1) {
      const piece = el('span', { class: 'confetti-piece' });
      const left = Math.random() * 100;
      const duration = 1.1 + Math.random() * 0.9;
      const delay = Math.random() * 0.25;
      const rotate = Math.round(Math.random() * 360);
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.left = `${left}%`;
      piece.style.animationDuration = `${duration}s`;
      piece.style.animationDelay = `${delay}s`;
      piece.style.background = color;
      piece.style.setProperty('--rotate-end', `${rotate}deg`);
      host.appendChild(piece);
    }
    setTimeout(() => host.remove(), 2400);
  }

  function announceMilestone(def) {
    toast(`${def.icon} Jalon débloqué : ${def.title}`, 'success');
    AudioFX.playBadge();
    burstConfetti();
  }

  async function runMilestoneChecks({ level, totalPlayed }) {
    try {
      const newly = await Milestones.evaluateCheap({ level, totalPlayed, streak: dailyStreakValue });
      newly.forEach(announceMilestone);
    } catch (err) {
      // Les jalons sont un bonus : une erreur ici ne doit jamais bloquer le jeu.
    }
  }

  async function runMasteryMilestoneCheck() {
    try {
      const newly = await Milestones.evaluateMastery();
      newly.forEach(announceMilestone);
    } catch (err) {
      // idem
    }
  }

  // ---------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------

  const NAV_ITEMS = [
    { key: '', icon: '🏠', label: 'Accueil' },
    { key: 'play', icon: '🎮', label: 'Jouer' },
    { key: 'notes', icon: '📝', label: 'Notes' },
    { key: 'stats', icon: '📊', label: 'Stats' },
    { key: 'settings', icon: '⚙️', label: 'Réglages' }
  ];

  function renderNav(activeKey) {
    clear(navRoot);
    const list = el('div', { class: 'nav__list' },
      NAV_ITEMS.map((item) => el('button', {
        class: `nav__item ${activeKey === item.key ? 'nav__item--active' : ''}`,
        onClick: () => Router.navigate(item.key)
      }, [
        el('span', { class: 'nav__icon', 'aria-hidden': 'true' }, item.icon),
        el('span', { class: 'nav__label' }, item.label)
      ]))
    );
    navRoot.appendChild(list);
  }

  function guardQuizExit(segments) {
    // Si une session infinie est en cours et qu'on quitte "play/...", on l'abandonne proprement.
    if (activeSession && !segments[0]?.startsWith('play')) {
      activeSession = null;
      AudioFX.stopBgm();
    }
  }

  function clearJuiceOverlays() {
    document.querySelectorAll('.xp-float').forEach((n) => n.remove());
  }

  async function handleRoute(segments) {
    // Retour Android / changement de page : on ferme proprement l'explication si elle est ouverte.
    closeExplanation();
    guardQuizExit(segments);
    clearJuiceOverlays();
    const [root, a, b, c] = segments;
    renderNav(root === undefined ? '' : root === 'play' ? 'play' : root);

    try {
      if (!root) return renderHome();
      if (root === 'play') return await routePlay(a, b, c);
      if (root === 'notes') return await renderNotesView();
      if (root === 'stats') return await routeStats(a, b);
      if (root === 'settings') return await renderSettingsView();
      return renderHome();
    } catch (err) {
      console.error('[Learnida] Erreur de rendu', err);
      renderErrorView(err);
    }
  }

  function renderErrorView(err) {
    clear(appRoot);
    appRoot.appendChild(el('div', { class: 'view' }, [
      el('h2', {}, 'Oups, une erreur est survenue'),
      el('p', { class: 'muted' }, err.message || 'Erreur inconnue.'),
      el('button', { class: 'btn btn--primary', onClick: () => Router.navigate('') }, 'Retour à l\'accueil')
    ]));
  }

  // ---------------------------------------------------------------------
  // Accueil
  // ---------------------------------------------------------------------

  async function renderHome() {
    clear(appRoot);
    const profile = await Progression.getProfile();
    const levelInfo = Progression.levelProgress(profile.xp);
    const title = Progression.levelTitle(levelInfo.level);
    const lastPlayed = await Progression.getLastPlayed();

    const heroChildren = [
      el('div', { class: 'hero__top' }, [
        el('div', { class: 'hero__identity' }, [
          el('p', { class: 'hero__eyebrow' }, 'Learnida'),
          el('h1', { class: 'hero__title' }, 'Un jeu de quiz conçu pour maîtriser mes cours.')
        ]),
        levelRing(levelInfo, 84)
      ]),
      el('div', { class: 'hero__meta' }, [
        el('span', { class: 'hero__level-title' }, title),
        streakChip(dailyStreakValue)
      ].filter(Boolean)),
      el('div', { class: 'xpbar xpbar--compact' }, [
        el('div', { class: 'xpbar__track' }, [
          el('div', { class: 'xpbar__fill', style: `width:${Math.round(levelInfo.ratio * 100)}%` })
        ]),
        el('div', { class: 'xpbar__next' }, `${levelInfo.xpIntoLevel} / ${levelInfo.xpNeededForNext} XP vers le niveau ${levelInfo.level + 1}`)
      ])
    ];

    const children = [el('header', { class: 'hero' }, heroChildren)];

    if (lastPlayed) {
      children.push(el('button', { class: 'resume-card', onClick: () => Router.navigate(lastPlayed.path) }, [
        el('span', { class: 'resume-card__icon', 'aria-hidden': 'true' }, '▶'),
        el('span', { class: 'resume-card__body' }, [
          el('span', { class: 'resume-card__title' }, 'Reprendre'),
          el('span', { class: 'resume-card__label' }, lastPlayed.label)
        ])
      ]));
    }

    if (PWA.shouldShowInstallCard()) children.push(buildInstallCard());

    children.push(el('div', { class: 'quick-grid' }, [
      quickCard('🎮', 'Jouer', 'Choisir un mode de quiz', () => Router.navigate('play')),
      quickCard('📝', 'Mes Notes', 'Explications enregistrées', () => Router.navigate('notes')),
      quickCard('📊', 'Stats', 'Progression détaillée', () => Router.navigate('stats')),
      quickCard('⚙️', 'Paramètres', 'Thème, sons, données', () => Router.navigate('settings'))
    ]));

    const heatmap = await buildMasteryStrip();
    if (heatmap) {
      children.push(el('div', { class: 'home-mastery' }, [
        el('div', { class: 'home-mastery__top' }, [
          el('h3', { class: 'section-title' }, 'Vue d\'ensemble de la maîtrise'),
          el('button', { class: 'link-btn', onClick: () => Router.navigate('stats') }, 'Voir le détail ›')
        ]),
        heatmap
      ]));
    }

    appRoot.appendChild(el('div', { class: 'view view--home' }, children));
  }

  /** Carte "Installer Learnida" : bouton natif si disponible, sinon aide pas à pas (iPhone/iPad). */
  function buildInstallCard() {
    const native = PWA.canInstall();
    const description = native
      ? 'Ouvre-la en plein écran depuis ton écran d\'accueil, même sans connexion.'
      : PWA.isIosSafari()
        ? 'Touche Partager (⬆️) en bas de Safari, puis « Sur l\'écran d\'accueil ».'
        : 'Ouvre cette page dans Safari, puis touche Partager (⬆️) › « Sur l\'écran d\'accueil ».';

    return el('div', { class: 'install-card', role: 'region', 'aria-label': 'Installer Learnida' }, [
      el('img', { class: 'install-card__icon', src: 'assets/icons/icon-192.png', alt: '', width: '44', height: '44' }),
      el('div', { class: 'install-card__body' }, [
        el('p', { class: 'install-card__title' }, 'Installer Learnida'),
        el('p', { class: 'install-card__desc' }, description),
        el('div', { class: 'install-card__actions' }, [
          native ? el('button', {
            class: 'btn btn--primary btn--small',
            onClick: async () => { AudioFX.playClick(); await PWA.promptInstall(); }
          }, '📲 Installer') : null,
          el('button', { class: 'btn btn--ghost btn--small', onClick: () => { AudioFX.playClick(); PWA.dismissCard(); } }, 'Plus tard')
        ].filter(Boolean))
      ])
    ]);
  }

  async function buildMasteryStrip() {
    const sequences = Questions.getIndexSync()?.sequences || [];
    if (!sequences.length) return null;
    const entries = [];
    for (const seq of sequences) {
      const data = await Stats.getSequenceStats(seq.subjectId, seq.id);
      entries.push({
        label: `${seq.subjectName} · ${seq.name}`,
        mastery: data.mastery,
        onClick: () => Router.navigate(`stats/${seq.subjectId}/${seq.id}`)
      });
    }
    return masteryStrip(entries);
  }

  function quickCard(icon, title, subtitle, onClick) {
    return el('button', { class: 'quick-card', onClick }, [
      el('span', { class: 'quick-card__icon', 'aria-hidden': 'true' }, icon),
      el('span', { class: 'quick-card__title' }, title),
      el('span', { class: 'quick-card__subtitle' }, subtitle)
    ]);
  }

  // ---------------------------------------------------------------------
  // Jouer : sous-routeur
  // ---------------------------------------------------------------------

  async function routePlay(a, b, c) {
    if (!a) return renderPlayMenu();
    if (a === 'random') return renderTargetPicker({
      title: 'Mode aléatoire',
      backPath: 'play',
      onPick: async (target) => startAndRenderQuiz(await Quiz.startRandom(target), 'play/random')
    });
    if (a === 'classic') return routeClassic(b, c);
    if (a === 'exam') return routeExam(b, c);
    return renderPlayMenu();
  }

  function renderPlayMenu() {
    clear(appRoot);
    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader('Jouer', null),
      el('div', { class: 'mode-list' }, [
        modeCard('I', 'Mode aléatoire', 'Toutes les questions, mélangées, à l\'infini.', () => Router.navigate('play/random')),
        modeCard('II', 'Mode classique', 'Choisissez une matière puis une séquence, ou jouez en global.', () => Router.navigate('play/classic')),
        modeCard('III', 'Mode examen', 'Un nombre défini de questions, correction à la fin, sans XP.', () => Router.navigate('play/exam'))
      ])
    ]));
  }

  function modeCard(roman, title, desc, onClick) {
    return el('button', { class: 'mode-card', onClick }, [
      el('span', { class: 'mode-card__roman' }, roman),
      el('span', { class: 'mode-card__body' }, [
        el('span', { class: 'mode-card__title' }, title),
        el('span', { class: 'mode-card__desc' }, desc)
      ])
    ]);
  }

  function viewHeader(title, backPath) {
    return el('div', { class: 'view-header' }, [
      backPath !== null ? el('button', {
        class: 'back-btn',
        'aria-label': 'Retour',
        onClick: () => Router.navigate(backPath)
      }, '←') : el('span'),
      el('h2', { class: 'view-header__title' }, title)
    ]);
  }

  // ---------- Mode classique ----------

  async function routeClassic(subjectId, seqOrGlobal) {
    if (!subjectId) return renderSubjectPicker('play/classic', 'Mode classique — choisissez une matière');
    if (!seqOrGlobal) return renderSequencePicker(subjectId, 'classic');
    if (seqOrGlobal === 'global') {
      const subject = Questions.getSubjectMeta(subjectId);
      return renderTargetPicker({
        title: subject ? `${subject.name} · Global` : 'Global',
        backPath: `play/classic/${subjectId}`,
        onPick: async (target) => startAndRenderQuiz(await Quiz.startClassicGlobal(subjectId, target), `play/classic/${subjectId}/global`)
      });
    }
    return startAndRenderQuiz(await Quiz.startClassicSequence(subjectId, seqOrGlobal), `play/classic/${subjectId}/${seqOrGlobal}`);
  }

  /** Écran commun aux modes infinis (aléatoire / classique global) pour
   *  choisir une cible de session facultative avant de démarrer. */
  function renderTargetPicker({ title, backPath, onPick }) {
    clear(appRoot);
    const options = [
      { label: 'Sans limite', value: null },
      { label: '10 questions', value: 10 },
      { label: '20 questions', value: 20 },
      { label: '50 questions', value: 50 }
    ];
    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader(title, backPath),
      el('p', { class: 'muted' }, 'Choisissez un objectif de session, ou jouez sans limite (vous pourrez terminer à tout moment).'),
      el('div', { class: 'chip-grid' }, options.map((opt) => el('button', {
        class: 'chip',
        onClick: () => onPick(opt.value)
      }, opt.label)))
    ]));
  }

  function renderSubjectPicker(basePath, title) {
    clear(appRoot);
    const subjects = Questions.getSubjects();
    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader(title, 'play'),
      subjects.length
        ? el('div', { class: 'list' }, subjects.map((s) => el('button', {
            class: 'list-item',
            onClick: () => Router.navigate(`${basePath}/${s.id}`)
          }, [
            el('span', { class: 'list-item__title' }, s.name),
            el('span', { class: 'list-item__chevron' }, '›')
          ])))
        : emptyState('Aucune matière disponible pour le moment.')
    ]));
  }

  async function renderSequencePicker(subjectId, kind) {
    clear(appRoot);
    const subject = Questions.getSubjectMeta(subjectId);
    const sequences = Questions.getSequencesForSubject(subjectId);
    const basePath = kind === 'classic' ? `play/classic/${subjectId}` : `play/exam/${subjectId}`;
    const backPath = kind === 'classic' ? 'play/classic' : 'play/exam';

    const allProgress = await Progression.getAllSequenceProgress();
    const progressById = {};
    for (const p of allProgress) progressById[p.sequenceId] = p;

    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader(subject ? subject.name : 'Séquences', backPath),
      el('div', { class: 'list' }, [
        el('button', { class: 'list-item', onClick: () => Router.navigate(`${basePath}/global`) }, [
          el('span', { class: 'list-item__title' }, 'Global'),
          el('span', { class: 'list-item__sub' }, 'Toutes les séquences de la matière'),
          el('span', { class: 'list-item__chevron' }, '›')
        ]),
        ...sequences.map((seq) => {
          const p = progressById[seq.uid];
          return el('button', { class: 'list-item', onClick: () => Router.navigate(`${basePath}/${seq.id}`) }, [
            el('span', { class: 'list-item__title' }, [
              seq.name,
              p && p.badgeEarned ? el('span', { class: 'badge-chip', title: 'Badge de prestige obtenu' }, ' 🏆') : null
            ]),
            el('span', { class: 'list-item__chevron' }, '›')
          ]);
        })
      ])
    ]));
  }

  function emptyState(message) {
    return el('div', { class: 'empty-state' }, message);
  }

  // ---------- Mode examen ----------

  async function routeExam(subjectId, seqOrGlobal) {
    if (!subjectId) return renderSubjectPicker('play/exam', 'Mode examen — choisissez une matière');
    if (!seqOrGlobal) return renderSequencePicker(subjectId, 'exam');
    return renderExamCountPicker(subjectId, seqOrGlobal);
  }

  function renderExamCountPicker(subjectId, seqOrGlobal) {
    clear(appRoot);
    const isGlobal = seqOrGlobal === 'global';
    const pool = isGlobal
      ? Questions.getQuestionsForSubject(subjectId)
      : Questions.getQuestionsForSequence(subjectId, seqOrGlobal);
    const maxCount = pool.length;
    const options = [5, 10, 15, 20].filter((n) => n <= maxCount);
    if (!options.length || options[options.length - 1] !== maxCount) options.push(maxCount);

    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader('Nombre de questions', `play/exam/${subjectId}`),
      el('p', { class: 'muted' }, `${maxCount} question(s) disponible(s) dans cette sélection.`),
      el('div', { class: 'chip-grid' }, options.map((n) => el('button', {
        class: 'chip',
        onClick: async () => {
          const scope = isGlobal ? { type: 'subject', subjectId } : { type: 'sequence', subjectId, sequenceId: seqOrGlobal };
          startAndRenderQuiz(await Quiz.startExam(scope, n), `play/exam/${subjectId}/${seqOrGlobal}`);
        }
      }, `${n} questions`)))
    ]));
  }

  // ---------------------------------------------------------------------
  // Session de quiz (rendu générique)
  // ---------------------------------------------------------------------

  function startAndRenderQuiz(session, resumePath) {
    activeSession = session;
    AudioFX.playClick();
    AudioFX.startBgm();
    if (resumePath) {
      Progression.setLastPlayed({ label: session.label, path: resumePath });
    }
    renderQuizQuestion();
  }

  function sessionProgressLabel(session) {
    if (session.mode === 'exam') return `Question ${session.pointer + 1} / ${session.order.length}`;
    if (session.mode === 'classic-sequence') return `Question ${session.pointer + 1} / ${session.order.length}`;
    if (session.targetCount) return `Question ${session.answeredCount + 1} / ${session.targetCount}`;
    return `Cycle en cours · question ${session.pointer + 1} / ${session.order.length}`;
  }

  function renderQuizQuestion() {
    const session = activeSession;
    const question = Quiz.currentQuestion(session);
    if (!question) return renderQuizEnd();

    answered = false;
    activeSelection = new Set();
    lastResult = null;

    clear(appRoot);

    const view = el('div', { class: 'view view--quiz' });
    const topbarRight = [];
    if (session.runStreak >= 2) {
      topbarRight.push(el('span', { class: 'quiz-topbar__streak' }, `🔥 ${session.runStreak}`));
    }
    topbarRight.push(el('span', { class: 'quiz-topbar__score' }, `✅ ${session.correctCount}  ❌ ${session.incorrectCount}`));

    view.appendChild(el('div', { class: 'quiz-topbar' }, [
      el('button', { class: 'back-btn', 'aria-label': 'Quitter', onClick: () => { activeSession = null; AudioFX.stopBgm(); Router.navigate('play'); } }, '←'),
      el('div', { class: 'quiz-topbar__info' }, [
        el('span', { class: 'quiz-topbar__mode' }, session.label),
        el('span', { class: 'quiz-topbar__progress' }, sessionProgressLabel(session))
      ]),
      el('div', { class: 'quiz-topbar__right' }, topbarRight)
    ]));

    if (session.infinite) {
      view.appendChild(el('button', {
        class: 'end-session-btn',
        onClick: () => renderFreeSessionEnd()
      }, 'Terminer la session'));
    }

    const card = el('div', { class: 'question-card' });
    card.appendChild(el('p', { class: 'question-card__type' }, questionTypeLabel(question.type)));
    card.appendChild(el('h2', { class: 'question-card__text' }, renderQuestionText(question.question)));

    if (question.image) {
      card.appendChild(el('img', {
        class: 'question-card__image',
        src: `assets/${question.image}`,
        alt: 'Illustration de la question',
        onError: (e) => { e.target.style.display = 'none'; }
      }));
    }

    const isMultiple = question.type === 'multiple';

    const optionsWrap = el('div', { class: 'options', role: isMultiple ? 'group' : 'radiogroup' });
    question.options.forEach((optText, index) => {
      const btn = el('button', {
        class: 'option',
        'aria-pressed': 'false',
        onClick: () => onOptionClick(index, question, optionsWrap, card)
      }, [
        el('span', { class: 'option__marker' }, String.fromCharCode(65 + index)),
        el('span', { class: 'option__text' }, renderQuestionText(optText))
      ]);
      optionsWrap.appendChild(btn);
    });
    card.appendChild(optionsWrap);

    // Validation automatique dès la sélection, sauf pour les questions à
    // choix multiples (plusieurs réponses possibles) où l'utilisateur doit
    // confirmer sa combinaison avec le bouton "Valider".
    if (isMultiple) {
      const actionRow = el('div', { class: 'quiz-actions' }, [
        el('button', { class: 'btn btn--primary', id: 'validate-btn', disabled: true, onClick: () => validateCurrentAnswer(question, card) }, 'Valider')
      ]);
      card.appendChild(actionRow);
    }

    view.appendChild(card);
    appRoot.appendChild(view);

    // Nouvelle question : on repart en haut de l'écran et on place le focus sur
    // l'énoncé (lecteurs d'écran : la question est annoncée automatiquement).
    window.scrollTo(0, 0);
    const heading = card.querySelector('.question-card__text');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  function questionTypeLabel(type) {
    if (type === 'multiple') return 'Choix multiple — plusieurs réponses possibles';
    if (type === 'true_false') return 'Vrai ou faux';
    return 'Choix unique';
  }

  function onOptionClick(index, question, optionsWrap, card) {
    if (answered) return;
    const buttons = optionsWrap.querySelectorAll('.option');
    const multi = question.type === 'multiple';

    if (multi) {
      if (activeSelection.has(index)) activeSelection.delete(index);
      else activeSelection.add(index);
      AudioFX.playClick();
    } else {
      activeSelection = new Set([index]);
    }

    buttons.forEach((btn, i) => {
      const selected = activeSelection.has(i);
      btn.classList.toggle('option--selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });

    if (multi) {
      const validateBtn = document.getElementById('validate-btn');
      if (validateBtn) validateBtn.disabled = activeSelection.size === 0;
    } else {
      // Choix unique / vrai-faux : validation immédiate, pas de bouton à presser.
      validateCurrentAnswer(question, card);
    }
  }

  async function validateCurrentAnswer(question, card) {
    if (answered || activeSelection.size === 0) return;
    answered = true;
    document.getElementById('validate-btn')?.setAttribute('disabled', '');

    const result = await Quiz.submitAnswer(activeSession, question, activeSelection);
    lastResult = result;

    const optionButtons = card.querySelectorAll('.option');
    if (!result.exam) {
      const correctSet = new Set(result.correctAnswer);
      optionButtons.forEach((btn, i) => {
        btn.classList.remove('option--selected');
        if (correctSet.has(i)) btn.classList.add('option--correct');
        else if (activeSelection.has(i)) btn.classList.add('option--wrong');
        btn.disabled = true;
      });

      if (result.correct) AudioFX.playCorrect(); else { AudioFX.playIncorrect(); AudioFX.vibrateWrong(); }
      flashScreen(result.correct ? 'ok' : 'ko');
      if (result.xp) showXpFloat(result.xp.delta);
      await showExplanation(question, result);

      if (result.xp && (result.xp.leveledUp || result.xp.leveledDown)) {
        toast(result.xp.leveledUp ? `Niveau supérieur : niveau ${result.xp.level} !` : `Niveau ${result.xp.level}`, result.xp.leveledUp ? 'success' : 'info');
      }
      if (result.xp) {
        const profileNow = await Progression.getProfile();
        await runMilestoneChecks({ level: result.xp.level, totalPlayed: profileNow.totalPlayed });
      }
    } else {
      // Mode examen : aucune correction avant la fin. On montre brièvement le choix
      // enregistré puis on enchaîne tout seul (un tap de moins = plus fluide).
      optionButtons.forEach((btn, i) => {
        btn.disabled = true;
        if (activeSelection.has(i)) btn.classList.add('option--picked-exam');
      });
      const session = activeSession;
      setTimeout(() => {
        if (activeSession === session) goToNext();
      }, 450);
    }
  }

  // ---------------------------------------------------------------------
  // Explication de la réponse : fenêtre centrée, un tap n'importe où = suite
  // ---------------------------------------------------------------------

  function formatAnswerList(question) {
    const labels = question.answer.map((i) => `${String.fromCharCode(65 + i)}. ${question.options[i]}`);
    return el('span', {}, labels.join(' · '));
  }

  /** Rend le fond inerte (non cliquable, ignoré des lecteurs d'écran) pendant l'explication. */
  function setBackgroundInert(value) {
    [appRoot, navRoot].forEach((node) => {
      if (!node) return;
      if (value) node.setAttribute('inert', ''); else node.removeAttribute('inert');
    });
  }

  /** Ferme l'explication sans passer à la suite (changement de page, etc.). */
  function closeExplanation() {
    if (explainKeyHandler) {
      document.removeEventListener('keydown', explainKeyHandler);
      explainKeyHandler = null;
    }
    if (!explainOverlay) return;
    explainOverlay.remove();
    explainOverlay = null;
    setBackgroundInert(false);
  }

  async function showExplanation(question, result) {
    closeExplanation();
    const alreadySaved = await Notes.isSaved(question.id);
    const ok = result.correct;
    const hasExplanation = !!question.explanation;

    // Bouton "Ajouter aux notes" : aria-disabled (et non disabled) pour que le tap
    // sur ce bouton ne soit jamais pris pour un "tap n'importe où = continuer".
    let noteBtn = null;
    if (hasExplanation) {
      noteBtn = el('button', {
        class: 'btn btn--ghost btn--small explain-card__note',
        'aria-disabled': alreadySaved ? 'true' : 'false',
        onClick: async (e) => {
          e.stopPropagation();
          const btn = e.currentTarget;
          if (btn.getAttribute('aria-disabled') === 'true') return;
          btn.setAttribute('aria-disabled', 'true');
          try {
            await Notes.addNote(question);
            btn.textContent = '✓ Ajouté à mes notes';
            toast('Explication ajoutée à vos notes.', 'success');
          } catch (err) {
            btn.setAttribute('aria-disabled', 'false');
            toast('Impossible d\'enregistrer la note.', 'error');
          }
        }
      }, alreadySaved ? '✓ Déjà dans mes notes' : '➕ Ajouter aux notes');
    }

    const card = el('div', {
      class: `explain-card ${ok ? 'explain-card--ok' : 'explain-card--ko'}`,
      tabindex: '-1'
    }, [
      el('p', { class: 'explain-card__status', id: 'explain-status' }, pickMessage(ok ? CORRECT_MESSAGES : INCORRECT_MESSAGES)),
      !ok ? el('p', { class: 'explain-card__answer' }, [
        el('strong', {}, 'Bonne réponse : '),
        formatAnswerList(question)
      ]) : null,
      hasExplanation ? el('div', { class: 'explain-card__body', id: 'explain-body' }, [
        el('p', { class: 'explain-card__label' }, '💡 Explication'),
        el('p', { class: 'explain-card__text' }, question.explanation)
      ]) : null,
      noteBtn
    ]);

    const overlay = el('div', {
      class: 'explain-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'explain-status',
      'aria-describedby': hasExplanation ? 'explain-body' : null
    }, [
      card,
      el('p', { class: 'explain-overlay__hint' }, 'Touchez l\'écran pour continuer')
    ]);

    // Garde-fou : un double tap involontaire ne doit pas faire sauter l'explication.
    const readyAt = Date.now() + 400;
    const dismiss = () => {
      if (explainOverlay !== overlay || advancing || Date.now() < readyAt) return;
      advancing = true;
      overlay.classList.add('explain-overlay--out');
      document.removeEventListener('keydown', explainKeyHandler);
      explainKeyHandler = null;
      explainOverlay = null;
      setBackgroundInert(false);
      setTimeout(() => overlay.remove(), 160);
      goToNext().finally(() => { advancing = false; });
    };

    overlay.addEventListener('click', dismiss);

    // Clavier : écouté sur le document, car le focus peut quitter la fenêtre
    // après un clic. Le bouton "notes" garde Entrée/Espace pour lui-même.
    explainKeyHandler = (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener('keydown', explainKeyHandler);

    document.body.appendChild(overlay);
    explainOverlay = overlay;
    setBackgroundInert(true);
    card.focus({ preventScroll: true });
  }

  async function goToNext() {
    const session = activeSession;
    if (!session) return; // l'utilisateur a quitté le quiz entre-temps
    AudioFX.playClick();
    if (Quiz.targetReached(session)) {
      return renderFreeSessionEnd();
    }
    const hasNext = await Quiz.advance(session);
    if (activeSession !== session) return;
    if (hasNext) {
      renderQuizQuestion();
    } else {
      await renderQuizEnd();
    }
  }

  /** Écran de fin pour les modes infinis (objectif atteint ou arrêt volontaire). */
  async function renderFreeSessionEnd() {
    const session = activeSession;
    AudioFX.stopBgm();
    const summary = Quiz.freeSummary(session);
    await runMasteryMilestoneCheck();
    clearJuiceOverlays();
    clear(appRoot);

    appRoot.appendChild(el('div', { class: 'view view--result' }, [
      el('h2', {}, 'Session terminée'),
      el('p', { class: 'result-score' }, `${summary.ratio}%`),
      summary.total
        ? el('p', { class: 'muted' }, `${summary.correct} bonne(s) réponse(s) sur ${summary.total}`)
        : el('p', { class: 'muted' }, 'Aucune question répondue.'),
      el('div', { class: 'result-chips' }, [
        el('span', { class: 'result-chip' }, `${summary.xpGained >= 0 ? '+' : ''}${summary.xpGained} XP`),
        summary.bestStreak >= 2 ? el('span', { class: 'result-chip' }, `🔥 série max : ${summary.bestStreak}`) : null
      ].filter(Boolean)),
      el('div', { class: 'result-actions' }, [
        el('button', { class: 'btn btn--primary', onClick: () => { activeSession = null; Router.navigate(session.mode === 'random' ? 'play/random' : `play/classic/${session.pool[0]?.subjectId}/global`); } }, 'Rejouer'),
        el('button', { class: 'btn btn--ghost', onClick: () => { activeSession = null; Router.navigate('play'); } }, 'Retour à Jouer')
      ])
    ]));
  }

  async function renderQuizEnd() {
    const session = activeSession;
    AudioFX.stopBgm();
    clearJuiceOverlays();
    clear(appRoot);

    if (session.mode === 'classic-sequence') {
      const summary = await Quiz.finalizeSequenceSession(session);
      const justEarnedBadge = summary.progress.badgeEarned && summary.progress.prestigeStreak >= 3 && summary.ratio === 100;
      if (justEarnedBadge) { AudioFX.playBadge(); burstConfetti(); }
      await runMasteryMilestoneCheck();

      appRoot.appendChild(el('div', { class: 'view view--result' }, [
        el('h2', {}, 'Séquence terminée'),
        el('p', { class: 'result-score' }, `${summary.ratio}%`),
        el('p', { class: 'muted' }, `${summary.correct} bonne(s) réponse(s) sur ${summary.total}`),
        summary.progress.badgeEarned ? el('p', { class: 'badge-earned' }, '🏆 Badge de prestige obtenu sur cette séquence') : null,
        summary.ratio === 100 && !summary.progress.badgeEarned
          ? el('p', { class: 'muted' }, `Série de sessions parfaites : ${summary.progress.prestigeStreak} / 3`)
          : null,
        el('div', { class: 'result-actions' }, [
          el('button', { class: 'btn btn--primary', onClick: async () => { startAndRenderQuiz(await Quiz.startClassicSequence(session.sequenceMeta.subjectId, session.sequenceMeta.id), `play/classic/${session.sequenceMeta.subjectId}/${session.sequenceMeta.id}`); } }, 'Rejouer cette séquence'),
          el('button', { class: 'btn btn--ghost', onClick: () => { activeSession = null; Router.navigate('play'); } }, 'Retour à Jouer')
        ])
      ]));
      return;
    }

    if (session.mode === 'exam') {
      const summary = Quiz.examSummary(session);
      await runMasteryMilestoneCheck();
      appRoot.appendChild(el('div', { class: 'view view--result' }, [
        el('h2', {}, 'Résultat de l\'examen'),
        el('p', { class: 'result-score' }, `${summary.ratio}%`),
        el('p', { class: 'muted' }, `${summary.correct} bonne(s) réponse(s) · ${summary.incorrect} mauvaise(s) réponse(s) sur ${summary.total}`),
        el('p', { class: 'muted' }, 'Aucun XP n\'est attribué en mode examen.'),
        summary.incorrectAnswers.length ? el('div', { class: 'exam-review' }, [
          el('h3', {}, 'Questions incorrectes'),
          ...summary.incorrectAnswers.map((a) => el('div', { class: 'exam-review__item' }, [
            el('p', { class: 'exam-review__q' }, a.question.question),
            el('p', { class: 'exam-review__a' }, [el('strong', {}, 'Bonne réponse : '), formatAnswerList(a.question)])
          ]))
        ]) : null,
        el('div', { class: 'result-actions' }, [
          el('button', { class: 'btn btn--ghost', onClick: () => { activeSession = null; Router.navigate('play'); } }, 'Retour à Jouer')
        ])
      ]));
      return;
    }

    // Modes infinis : ne devrait pas arriver, sécurité.
    Router.navigate('play');
  }

  // ---------------------------------------------------------------------
  // Mes Notes
  // ---------------------------------------------------------------------

  async function renderNotesView(filter) {
    clear(appRoot);
    const activeFilter = filter || { type: 'all' };
    const notes = await Notes.getFiltered(activeFilter);
    const subjects = Questions.getSubjects();

    const filterBar = el('div', { class: 'chip-grid chip-grid--scroll' }, [
      el('button', { class: `chip ${activeFilter.type === 'all' ? 'chip--active' : ''}`, onClick: () => renderNotesView({ type: 'all' }) }, 'Toutes'),
      ...subjects.map((s) => el('button', {
        class: `chip ${activeFilter.type === 'subject' && activeFilter.value === s.id ? 'chip--active' : ''}`,
        onClick: () => renderNotesView({ type: 'subject', value: s.id })
      }, s.name))
    ]);

    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader('Mes Notes', ''),
      filterBar,
      notes.length ? el('div', { class: 'notes-list' }, notes.map((n) => noteCard(n))) : emptyState('Aucune note enregistrée pour ce filtre.')
    ]));
  }

  function noteCard(note) {
    return el('div', { class: 'note-card' }, [
      el('p', { class: 'note-card__path' }, `${note.ueName} → ${note.subjectName} → ${note.sequenceName}`),
      el('p', { class: 'note-card__question' }, note.questionText),
      el('p', { class: 'note-card__explanation' }, note.explanation),
      el('button', {
        class: 'btn btn--ghost btn--small',
        onClick: async () => {
          await Notes.removeNote(note.id);
          toast('Note supprimée.', 'info');
          renderNotesView();
        }
      }, '🗑️ Supprimer')
    ]);
  }

  // ---------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------

  async function routeStats(subjectId, sequenceId) {
    if (!subjectId) return renderStatsHome();
    if (!sequenceId) return renderSubjectStatsView(subjectId);
    return renderSequenceStatsView(subjectId, sequenceId);
  }

  async function renderStatsHome() {
    clear(appRoot);
    const global = await Stats.getGlobalStats();
    const subjects = Questions.getSubjects();

    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader('Statistiques', null),
      el('div', { class: 'stat-grid' }, [
        statTile('Niveau', global.level),
        statTile('XP', global.xp),
        statTile('Questions jouées', global.totalPlayed),
        statTile('Taux de réussite', `${global.successRate}%`),
        statTile('Meilleur score', `${global.bestSessionScore}%`),
        statTile('Sessions terminées', global.sessionsCompleted)
      ]),
      el('h3', { class: 'section-title' }, 'Par matière'),
      el('div', { class: 'list' }, subjects.map((s) => el('button', {
        class: 'list-item',
        onClick: () => Router.navigate(`stats/${s.id}`)
      }, [
        el('span', { class: 'list-item__title' }, s.name),
        el('span', { class: 'list-item__chevron' }, '›')
      ])))
    ]));
  }

  function statTile(label, value) {
    return el('div', { class: 'stat-tile' }, [
      el('span', { class: 'stat-tile__value' }, String(value)),
      el('span', { class: 'stat-tile__label' }, label)
    ]);
  }

  async function renderSubjectStatsView(subjectId) {
    clear(appRoot);
    const subject = Questions.getSubjectMeta(subjectId);
    const data = await Stats.getSubjectStats(subjectId);
    const sequences = Questions.getSequencesForSubject(subjectId);

    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader(subject ? subject.name : 'Matière', 'stats'),
      data.mastery !== null ? progressBar(data.mastery, 'Maîtrise') : el('p', { class: 'muted' }, 'Pas encore de données de maîtrise.'),
      el('div', { class: 'stat-grid' }, [
        statTile('Questions jouées', data.questionsPlayed),
        statTile('Bonnes réponses', data.correct),
        statTile('Mauvaises réponses', data.incorrect),
        statTile('Taux de réussite', `${data.successRate}%`),
        statTile('Sessions', data.sessionsCompleted)
      ]),
      el('h3', { class: 'section-title' }, 'Par séquence'),
      el('div', { class: 'list' }, sequences.map((seq) => el('button', {
        class: 'list-item',
        onClick: () => Router.navigate(`stats/${subjectId}/${seq.id}`)
      }, [
        el('span', { class: 'list-item__title' }, seq.name),
        el('span', { class: 'list-item__chevron' }, '›')
      ])))
    ]));
  }

  async function renderSequenceStatsView(subjectId, sequenceId) {
    clear(appRoot);
    const meta = Questions.getSequenceMeta(subjectId, sequenceId);
    const data = await Stats.getSequenceStats(subjectId, sequenceId);

    appRoot.appendChild(el('div', { class: 'view' }, [
      viewHeader(meta ? meta.name : 'Séquence', `stats/${subjectId}`),
      data.mastery !== null ? progressBar(data.mastery, 'Maîtrise') : el('p', { class: 'muted' }, 'Pas encore de données de maîtrise.'),
      data.badgeEarned ? el('p', { class: 'badge-earned' }, '🏆 Badge de prestige obtenu') : el('p', { class: 'muted' }, `Série vers le badge : ${data.prestigeStreak} / 3 sessions à 100 %`),
      el('div', { class: 'stat-grid' }, [
        statTile('Questions jouées', data.questionsPlayed),
        statTile('Bonnes réponses', data.correct),
        statTile('Mauvaises réponses', data.incorrect),
        statTile('Taux de réussite', `${data.successRate}%`),
        statTile('Meilleure performance', `${data.bestScore}%`),
        statTile('Sessions', data.sessionsCompleted)
      ])
    ]));
  }

  // ---------------------------------------------------------------------
  // Paramètres
  // ---------------------------------------------------------------------

  async function renderSettingsView() {
    clear(appRoot);
    const settings = await Settings.get();
    const earnedMilestones = await Milestones.getEarned();
    const earnedIds = new Set(earnedMilestones.map((m) => m.id));

    const view = el('div', { class: 'view' }, [
      viewHeader('Paramètres', null),
      settingsSection('Apparence', [
        toggleRow('🌙 Mode sombre / ☀️ Mode clair', settings.theme === 'dark', async (val) => {
          await Settings.update({ theme: val ? 'dark' : 'light' });
          renderSettingsView();
        }, 'Sombre', 'Clair')
      ]),
      settingsSection('Sons et retour tactile', [
        toggleRow('🔊 Sons', settings.sound, async (val) => { await Settings.update({ sound: val }); await AudioFX.refreshBgmForSettings(); renderSettingsView(); }),
        toggleRow('📳 Vibration (mauvaise réponse)', settings.vibration, async (val) => { await Settings.update({ vibration: val }); renderSettingsView(); })
      ]),
      settingsSection('Jalons', [
        el('div', { class: 'milestone-grid' }, Milestones.ALL_DEFS.map((def) => el('div', {
          class: `milestone-badge ${earnedIds.has(def.id) ? 'milestone-badge--earned' : ''}`
        }, [
          el('span', { class: 'milestone-badge__icon' }, def.icon),
          el('span', { class: 'milestone-badge__title' }, def.title)
        ])))
      ]),
      settingsSection('Installation', [installSettingsContent()]),
      settingsSection('Données', [
        el('button', { class: 'btn btn--ghost settings-btn', onClick: exportJSON }, '📤 Exporter (JSON)'),
        el('button', { class: 'btn btn--ghost settings-btn', onClick: exportCSV }, '📤 Exporter (CSV)'),
        el('label', { class: 'btn btn--ghost settings-btn file-btn' }, [
          '📥 Importer (JSON)',
          el('input', { type: 'file', accept: 'application/json', class: 'file-input', onChange: onImportFile })
        ]),
        el('button', { class: 'btn btn--danger settings-btn', onClick: onResetData }, '🗑️ Réinitialiser les données')
      ]),
      el('p', { class: 'app-footer' }, `Learnida © ${new Date().getFullYear()} M.Wone`)
    ]);

    appRoot.appendChild(view);
  }

  function settingsSection(title, children) {
    return el('div', { class: 'settings-section' }, [
      el('h3', { class: 'section-title' }, title),
      ...children
    ]);
  }

  function toggleRow(label, initial, onToggle, onLabel = 'Activé', offLabel = 'Désactivé') {
    let value = initial;
    const btn = el('button', {
      class: `switch ${value ? 'switch--on' : ''}`,
      role: 'switch',
      'aria-checked': String(value)
    }, el('span', { class: 'switch__knob' }));

    const status = el('span', { class: 'settings-row__status' }, value ? onLabel : offLabel);

    btn.addEventListener('click', () => {
      value = !value;
      AudioFX.playClick();
      btn.classList.toggle('switch--on', value);
      btn.setAttribute('aria-checked', String(value));
      status.textContent = value ? onLabel : offLabel;
      onToggle(value);
    });

    return el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-row__label' }, label),
      el('div', { class: 'settings-row__control' }, [status, btn])
    ]);
  }

  function installSettingsContent() {
    if (PWA.isStandalone()) {
      return el('p', { class: 'muted settings-hint' }, '✅ Learnida est installé sur cet appareil : plein écran, accès direct et fonctionnement hors ligne.');
    }
    if (PWA.canInstall()) {
      return el('button', {
        class: 'btn btn--primary settings-btn',
        onClick: async () => { AudioFX.playClick(); await PWA.promptInstall(); }
      }, '📲 Installer Learnida');
    }
    if (PWA.isIos()) {
      return el('p', { class: 'muted settings-hint' }, PWA.isIosSafari()
        ? 'Sur iPhone / iPad : touchez Partager (⬆️) en bas de Safari, puis « Sur l\'écran d\'accueil ».'
        : 'Sur iPhone / iPad : ouvrez cette page dans Safari, puis touchez Partager (⬆️) › « Sur l\'écran d\'accueil ».');
    }
    return el('p', { class: 'muted settings-hint' }, 'Ajoutez Learnida à votre écran d\'accueil depuis le menu de votre navigateur (Chrome : ⋮ → « Installer l\'application »). Une fois installée, elle fonctionne aussi hors ligne.');
  }

  // ---------- Import / Export ----------

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportJSON() {
    try {
      const [profile, questionStats, sequenceProgress, notes, settings, milestones] = await Promise.all([
        Progression.getProfile(),
        Progression.getAllQuestionStats(),
        Progression.getAllSequenceProgress(),
        Notes.getAll(),
        Settings.get(),
        Milestones.getEarned()
      ]);
      const payload = {
        app: 'Learnida',
        exportedAt: new Date().toISOString(),
        version: 2,
        profile,
        questionStats,
        sequenceProgress,
        notes,
        settings,
        milestones
      };
      downloadBlob(JSON.stringify(payload, null, 2), 'learnida-export.json', 'application/json');
      toast('Export JSON généré.', 'success');
    } catch (err) {
      toast('Échec de l\'export JSON.', 'error');
    }
  }

  async function exportCSV() {
    try {
      const stats = await Progression.getAllQuestionStats();
      const header = ['id', 'matiere', 'sequence', 'tentatives', 'bonnes', 'mauvaises', 'maitrise_pct'];
      const rows = stats.map((s) => {
        const q = Questions.getQuestionById(s.id);
        const mastery = s.emaScore !== null ? Math.round(s.emaScore * 100) : '';
        return [
          q ? q.rawId : s.id,
          q ? q.subjectName : '',
          q ? q.sequenceName : '',
          s.attempts,
          s.correct,
          s.incorrect,
          mastery
        ];
      });
      const csv = [header, ...rows]
        .map((r) => r.map(csvEscape).join(','))
        .join('\r\n');
      downloadBlob('\uFEFF' + csv, 'learnida-export.csv', 'text/csv;charset=utf-8');
      toast('Export CSV généré.', 'success');
    } catch (err) {
      toast('Échec de l\'export CSV.', 'error');
    }
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    if (/[",;\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  async function onImportFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (err) {
      toast('Fichier JSON invalide.', 'error');
      return;
    }

    if (!data || data.app !== 'Learnida' || !data.profile) {
      toast('Ce fichier ne correspond pas à un export Learnida valide.', 'error');
      return;
    }

    const ok = await confirmModal({
      title: 'Importer ces données ?',
      message: 'Votre progression actuelle (XP, statistiques, badges, notes) sera remplacée par le contenu du fichier importé.',
      confirmLabel: 'Importer',
      danger: true
    });
    if (!ok) return;

    try {
      await Storage.clearAll();
      await Storage.putRecord('profile', data.profile);
      for (const s of data.questionStats || []) await Storage.putRecord('questionStats', s);
      for (const p of data.sequenceProgress || []) await Storage.putRecord('sequenceProgress', p);
      for (const n of data.notes || []) await Storage.putRecord('notes', n);
      for (const m of data.milestones || []) await Storage.putRecord('milestones', m);
      if (data.settings) await Storage.putRecord('settings', data.settings);
      toast('Import réussi. Rechargement…', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast('Échec de l\'import.', 'error');
    }
  }

  async function onResetData() {
    const ok = await confirmModal({
      title: 'Réinitialiser Learnida ?',
      message: 'Cette action supprimera votre progression, vos XP, vos statistiques, vos badges et vos notes.',
      confirmLabel: 'Réinitialiser',
      danger: true
    });
    if (!ok) return;
    try {
      await Storage.clearAll();
      toast('Données réinitialisées.', 'success');
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast('Échec de la réinitialisation.', 'error');
    }
  }

  // ---------------------------------------------------------------------

  boot();
})();
