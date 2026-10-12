# Learnida

Un jeu de quiz pour maîtriser tes cours : QCM, rappel actif, répétition intelligente, progression par niveaux, badges de prestige. 100 % HTML/CSS/JS vanilla, aucun backend, fonctionne hors ligne une fois installée.

## Nouveautés « addictif, fun, pro »

Une passe complète d'amélioration a été faite sur le ressenti de jeu, en gardant l'architecture 100 % locale (aucun backend, aucune donnée envoyée nulle part) :

- **Anneau de niveau + titre** sur l'accueil (Novice → Apprenti → Initié → Analyste → Expert → Virtuose → Maître Learnida), calculé automatiquement à partir du niveau.
- **Série de jours d'affilée** (🔥), calculée localement à chaque ouverture de l'app (comparaison de dates dans IndexedDB). Aucune notification requise.
- **Jalons permanents** (streak 3/7/30 jours, niveau 10/20, 100/500 questions jouées, une matière maîtrisée à 90 %) visibles dans Paramètres, avec confettis + son à l'obtention. Distincts du badge de prestige par séquence, qui reste inchangé.
- **Carte "Reprendre"** sur l'accueil : relance en un tap le dernier mode joué.
- **Heatmap de maîtrise** sur l'accueil et vue détaillée dans Stats : un coup d'œil sur l'état de chaque séquence.
- **Objectif de session facultatif** (10/20/50 questions ou sans limite) pour les modes aléatoire et classique-global, avec un bouton "Terminer la session" à tout moment et un écran de récap (XP gagné, meilleure série).
- **Série en direct** affichée pendant une session (🔥 dès 2 bonnes réponses consécutives).
- **Feedback plus vivant** : XP flottant animé, flash de couleur à l'écran, messages de correction variés.
- **Toggle "Notifications" retiré** des paramètres : sans backend, une vraie notification push (app fermée) est techniquement impossible (il faudrait un serveur + Web Push API). Le garder aurait été trompeur ; la série quotidienne + les jalons remplissent ce rôle de rétention sans fausse promesse.

Ces ajouts utilisent une nouvelle table IndexedDB (`milestones`) et de nouveaux champs sur le profil (`dailyStreak`, `longestDailyStreak`, `lastActiveDate`, `lastPlayed`) — la base de données passe en version 2, avec migration automatique et transparente pour les données existantes.

## Identité visuelle & sons (v3)

Refonte complète du design et du son, en gardant toute la logique de jeu (XP, badges, jalons, répétition intelligente) strictement inchangée :

- **Couleurs dynamiques** : une seule teinte de base (`--hue`) dérive lentement et délicatement dans le temps (indigo → violet → magenta → bleu, sur 70 secondes), via `@property` CSS. Tous les accents de l'app (boutons, anneau de niveau, dégradés) sont calculés à partir de cette teinte : la palette évolue en douceur, jamais de façon criarde. Un fond "aurore" (3 halos flous en mouvement lent) habille l'arrière-plan. Si le navigateur ne supporte pas `@property` (repli gracieux), la couleur reste simplement fixe — rien ne casse. `prefers-reduced-motion` coupe toutes les animations, y compris celle-ci.
- **Typographie** : abandon du style "terminal/monospace" au profit d'une typographie arrondie et confiante pour les titres, plus lisible et chaleureuse.
- **Disposition** : cartes "verre dépoli" (glassmorphism), coins très arrondis, navigation flottante en pilule (basse sur mobile, haute sur desktop), boutons pleinement arrondis avec dégradé animé.
- **Animations** : entrée en fondu/glissement à chaque écran, apparition échelonnée des cartes, retour tactile (`scale`) sur chaque bouton, tout en respectant `prefers-reduced-motion`.
- **Sons (.mp3)** dans `assets/sounds/` :

| Fichier | Utilisation |
|---|---|
| `click.mp3` | clic / navigation générale (change de vue, sélection multiple, interrupteurs) |
| `correct.mp3` | bonne réponse |
| `incorrect.mp3` | mauvaise réponse |
| `badge.mp3` | badge de prestige ou jalon obtenu |
| `bgm.mp3` | musique de fond, **en boucle pendant qu'une session de jeu est active**, coupée automatiquement en quittant le quiz ou si l'onglet passe en arrière-plan |

Comme pour les sons précédents : remplace ces 5 fichiers par les tiens en gardant exactement ces noms, aucune modification de code nécessaire. Le volume du BGM est volontairement discret (32%) pour ne pas couvrir les autres sons ; ajuste `BGM_VOLUME` dans `js/audio.js` si besoin.

## Splash screen & explication centrée (v4)

- **Splash screen** (`js/splash.js`, `css/splash.css`, bloc `#splash` dans `index.html`) : affiché au lancement pendant **3 secondes minimum** (`MIN_MS` en haut de `splash.js`), le temps de charger les réglages et toutes les questions. La barre de progression est honnête : elle n'atteint 100 % que lorsque le temps minimum ET le chargement réel sont terminés. Au-delà de 5 s (`SLOW_MS`), le message devient « Encore un instant… ». Les astuces affichées se modifient dans la liste `TIPS`.
- **Chargement plus rapide** : `Questions.load()` télécharge désormais tous les fichiers de questions **en parallèle** (au lieu d'un par un).
- **Explication centrée** : après chaque réponse (hors examen), l'explication s'ouvre au centre de l'écran ; **un tap n'importe où** (ou Entrée / Espace / →) passe à la question suivante. Un garde-fou de 0,4 s évite de la sauter par un double tap. Le bouton « Ajouter aux notes » reste disponible dans la fenêtre. Accessibilité : fenêtre `role="dialog"`, fond rendu inerte, focus géré, animations coupées avec `prefers-reduced-motion`.
- **Mode examen** : sans correction avant la fin, la question suivante s'affiche automatiquement juste après la réponse.
- **Service worker** : version passée à `v4` et nouveaux fichiers ajoutés à `SHELL_FILES`. Pense à incrémenter `VERSION` dans `sw.js` à chaque modification du code, sinon les appareils déjà installés gardent l'ancienne version en cache.

## PWA : installer Learnida comme une application (v5)

Learnida est une vraie PWA : installable, plein écran, avec icône sur l'écran d'accueil, et **100 % utilisable hors ligne**.

**Comment l'installer**

| Appareil | Marche à suivre |
|---|---|
| Android (Chrome, Edge, Samsung Internet) | Une carte « Installer Learnida » apparaît sur l'accueil → bouton **Installer**. Sinon : Paramètres → Installation, ou menu ⋮ → « Installer l'application ». |
| iPhone / iPad | Ouvrir dans **Safari** → Partager (⬆️) → « Sur l'écran d'accueil ». (Apple ne permet pas d'installer en un tap : la carte affiche ces étapes.) |
| Ordinateur (Chrome, Edge) | Icône d'installation dans la barre d'adresse, ou la carte « Installer Learnida » de l'accueil. |

Une fois installée, un appui long sur l'icône (Android) propose des **raccourcis** : Jouer, Mode aléatoire, Statistiques.

**Ce qui est fourni**
- `manifest.json` : identité, icônes (dont maskable), raccourcis, captures d'écran (fenêtre d'installation enrichie sur Android/desktop, dans `assets/screenshots/`).
- `sw.js` : à l'installation, il précharge **tout** le contenu (code, questions de toutes les matières, images, sons). Navigation hors ligne garantie. Réseau lent : après 3,5 s on sert la copie locale au lieu de faire attendre.
- `js/pwa.js` : enregistrement du service worker, invite d'installation, aide iPhone, détection « déjà installée », message « Nouvelle version prête », message hors ligne / retour en ligne.

**Pour que l'installation soit proposée, l'app doit être servie en HTTPS** (ou sur `localhost` pour tester). Hébergement gratuit simple : GitHub Pages, Netlify ou Cloudflare Pages (glisser-déposer le dossier). Ouvrir `index.html` directement depuis le disque (`file://`) ne permet ni l'installation ni le hors ligne.

**Publier une mise à jour** : après toute modification du code (`js/`, `css/`, `index.html`), incrémente `VERSION` dans `sw.js` (`v5` → `v6`…). Les appareils récupèrent la nouvelle version en arrière-plan et l'appliquent à la prochaine ouverture. Pour ajouter du contenu (nouvelles questions / matières dans `data/`), rien à changer dans `sw.js` : il est préchargé tout seul.

**Tester** : Chrome → DevTools → onglet *Application* → *Manifest* (section « Installability ») et *Service Workers*. Pour tester le hors ligne : cocher « Offline » puis recharger.

## Lancer l'application

Les fichiers JSON sont chargés via `fetch`, donc un navigateur bloque leur lecture en ouvrant `index.html` directement (`file://`). Il faut servir le dossier par un petit serveur local, par exemple :

```bash
cd learnida
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

N'importe quel serveur statique fonctionne (`npx serve`, extension "Live Server" de VS Code, etc.).

## Ajouter une matière ou une séquence — SANS toucher au code

Toute la hiérarchie UE → Matière → Séquence est pilotée par `data/config/subjects.json`. Le code JavaScript ne connaît aucun nom de matière ou de séquence en dur : il lit uniquement ce fichier. Ajouter du contenu se fait donc en 2 étapes, jamais en modifiant `js/*.js`.

### Structure attendue

```
data/
├── config/
│   └── subjects.json
└── questions/
    ├── matiere-1/
    │   ├── sequence1.json
    │   └── sequence2.json
    ├── matiere-2/
    │   └── sequence1.json
    └── matiere-3/
        └── sequence1.json
```

Le nom du dossier sous `data/questions/` doit correspondre à l'**id** de la matière déclaré dans `subjects.json`. Le nom du fichier JSON à l'intérieur est libre (`sequence1.json`, `intro.json`, peu importe) : c'est le champ `"file"` de `subjects.json` qui fait le lien.

### Étape 1 — déclarer la matière/séquence dans `subjects.json`

```json
{
  "ues": [
    {
      "id": "informatique",
      "name": "Informatique",
      "subjects": [
        {
          "id": "matiere-2",
          "name": "Ma nouvelle matière",
          "sequences": [
            { "id": "sequence1", "name": "Ma première séquence", "file": "sequence1.json" }
          ]
        }
      ]
    }
  ]
}
```

- `id` (matière et séquence) : identifiant technique, sans espace ni accent (ex. `matiere-2`), utilisé aussi comme nom de dossier pour la matière.
- `name` : nom affiché dans l'application.
- `file` : nom du fichier JSON de questions, relatif au dossier de la matière.

Tu peux aussi ajouter une UE entière en dupliquant un bloc `{ "id", "name", "subjects": [...] }`.

### Étape 2 — créer le fichier de questions

Crée `data/questions/matiere-2/sequence1.json` avec un tableau de questions au format suivant :

```json
[
  {
    "id": "m2-s1-q001",
    "question": "Une question ?",
    "type": "single",
    "options": ["Réponse A", "Réponse B", "Réponse C"],
    "answer": [0],
    "explanation": "Pourquoi c'est la bonne réponse.",
    "image": null
  }
]
```

- `type` : `"single"` (une bonne réponse), `"multiple"` (plusieurs bonnes réponses) ou `"true_false"` (options `["Vrai", "Faux"]`).
- `answer` : tableau des index (0 = première option) des bonnes réponses.
- `image` : `null`, ou un chemin **relatif au dossier `assets/`** (ex. `"images/mon-schema.png"` désigne le fichier `assets/images/mon-schema.png`).
- `id` : identifiant unique de la question dans toute l'application (sert à la répétition intelligente et aux notes) — préfixe-le par matière/séquence pour éviter les collisions.

Une fois ces deux fichiers en place, recharge l'application (ou vide le cache du navigateur si le mode hors-ligne est actif) : la nouvelle matière apparaît automatiquement dans tous les modes de jeu, les statistiques et l'examen. **Aucune ligne de JavaScript à modifier.**

Si une question est mal formée (champ manquant, `answer` invalide…), elle est simplement ignorée avec un avertissement dans la console — le reste de l'application continue de fonctionner normalement.

## Service worker et cache

Voir la section « PWA » plus haut. ⚠️ Le service worker exige HTTPS ou `localhost` (limitation standard des navigateurs, pas de Learnida).

## Structure du projet

```
index.html
manifest.json          # métadonnées PWA
sw.js                   # service worker (cache app shell + données)
css/
  themes.css            # jetons de couleur (clair/sombre)
  style.css             # composants
  responsive.css        # adaptation desktop
  splash.css            # écran de démarrage
js/
  storage.js            # accès IndexedDB
  settings.js            # préférences (thème, sons, vibration...)
  audio.js               # lecture des sons .mp3 (SFX + BGM en boucle) + vibration
  questions.js            # chargement de subjects.json + questions
  progression.js          # XP, niveaux, répétition intelligente, maîtrise
  notes.js                # "Mes Notes"
  quiz.js                 # moteur des 4 modes de jeu
  stats.js                # agrégation des statistiques
  splash.js                # écran de démarrage (≥ 3 s) pendant le chargement
  pwa.js                    # installation, mises à jour, hors ligne
  ui.js                    # composants d'interface réutilisables
  router.js                # routeur SPA (hash)
  app.js                    # vues + orchestration
data/
  config/subjects.json      # UE / matières / séquences
  questions/…                # questions par matière/séquence
assets/
  images/                    # illustrations de questions
  sounds/                    # effets sonores + musique de fond (.mp3)
  icons/                     # icônes PWA
  screenshots/               # captures d'écran du manifest (fenêtre d'installation)
```
