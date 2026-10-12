/**
 * ui.js
 * Petites briques d'interface réutilisables par app.js : création d'éléments
 * DOM, notifications ("toast"), boîte de confirmation modale, barre de
 * progression, mise en forme de code inline.
 */

const UI = (() => {
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value !== null && value !== undefined && value !== false) {
        node.setAttribute(key, value === true ? '' : value);
      }
    }
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  let toastTimer = null;
  function toast(message, kind = 'info') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = el('div', { id: 'toast-host', class: 'toast-host', 'aria-live': 'polite' });
      document.body.appendChild(host);
    }
    host.innerHTML = '';
    const node = el('div', { class: `toast toast--${kind}` }, message);
    host.appendChild(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.add('toast--out');
      setTimeout(() => node.remove(), 200);
    }, 2600);
  }

  function confirmModal({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
    return new Promise((resolve) => {
      const overlay = el('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' });
      const close = (result) => {
        overlay.classList.add('modal-overlay--out');
        setTimeout(() => overlay.remove(), 150);
        resolve(result);
      };
      const box = el('div', { class: 'modal-box' }, [
        el('h3', { class: 'modal-title' }, title),
        el('p', { class: 'modal-message' }, message),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn--ghost', onClick: () => close(false) }, cancelLabel),
          el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, onClick: () => close(true) }, confirmLabel)
        ])
      ]);
      overlay.appendChild(box);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.body.appendChild(overlay);
    });
  }

  function progressBar(ratioPercent, label) {
    const pct = Math.max(0, Math.min(100, Math.round(ratioPercent)));
    return el('div', { class: 'mastery' }, [
      el('div', { class: 'mastery__row' }, [
        el('span', { class: 'mastery__label' }, label),
        el('span', { class: 'mastery__value' }, `${pct}%`)
      ]),
      el('div', { class: 'mastery__track' }, [
        el('div', { class: 'mastery__fill', style: `width:${pct}%` })
      ])
    ]);
  }

  function xpBar(levelInfo) {
    const pct = Math.round(levelInfo.ratio * 100);
    const title = window.Progression ? window.Progression.levelTitle(levelInfo.level) : '';
    return el('div', { class: 'xpbar' }, [
      el('div', { class: 'xpbar__top' }, [
        el('span', { class: 'xpbar__level' }, `Niveau ${levelInfo.level}${title ? ' · ' + title : ''}`),
        el('span', { class: 'xpbar__xp' }, `${levelInfo.xp} XP`)
      ]),
      el('div', { class: 'xpbar__track' }, [
        el('div', { class: 'xpbar__fill', style: `width:${pct}%` })
      ]),
      el('div', { class: 'xpbar__next' }, `${levelInfo.xpIntoLevel} / ${levelInfo.xpNeededForNext} XP vers le niveau ${levelInfo.level + 1}`)
    ]);
  }

  /** Anneau de progression circulaire (SVG pur) affichant le niveau au centre. */
  function levelRing(levelInfo, size = 92) {
    const radius = (size - 10) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - levelInfo.ratio);
    const center = size / 2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('class', 'level-ring__svg');

    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', center); track.setAttribute('cy', center); track.setAttribute('r', radius);
    track.setAttribute('class', 'level-ring__track');
    svg.appendChild(track);

    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fill.setAttribute('cx', center); fill.setAttribute('cy', center); fill.setAttribute('r', radius);
    fill.setAttribute('class', 'level-ring__fill');
    fill.setAttribute('stroke-dasharray', String(circumference));
    fill.setAttribute('stroke-dashoffset', String(offset));
    fill.setAttribute('transform', `rotate(-90 ${center} ${center})`);
    svg.appendChild(fill);

    return el('div', { class: 'level-ring' }, [
      svg,
      el('div', { class: 'level-ring__label' }, [
        el('span', { class: 'level-ring__number' }, String(levelInfo.level)),
        el('span', { class: 'level-ring__caption' }, 'niveau')
      ])
    ]);
  }

  /** Puce "série de jours" (flamme), affichée seulement si streak >= 1. */
  function streakChip(streak) {
    if (!streak || streak < 1) return null;
    return el('div', { class: 'streak-chip' }, [
      el('span', { 'aria-hidden': 'true' }, '🔥'),
      el('span', {}, `${streak} jour${streak > 1 ? 's' : ''} d'affilée`)
    ]);
  }

  /** Mini grille de maîtrise (une cellule par séquence), colorée par niveau de maîtrise. */
  function masteryStrip(entries) {
    if (!entries.length) return null;
    return el('div', { class: 'mastery-strip' }, entries.map((entry) => el('button', {
      class: 'mastery-cell',
      style: `--m: ${entry.mastery === null ? 0 : entry.mastery}`,
      title: `${entry.label} — ${entry.mastery === null ? 'non commencé' : entry.mastery + '% de maîtrise'}`,
      onClick: entry.onClick
    })));
  }

  /** Rendu très léger du texte de question : détecte les blocs de code entre backticks ou après un saut de ligne technique. */
  function renderQuestionText(text) {
    const frag = document.createDocumentFragment();
    const parts = String(text).split(/(`[^`]+`)/g);
    for (const part of parts) {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        frag.appendChild(el('code', { class: 'inline-code' }, part.slice(1, -1)));
      } else if (part.includes('\n')) {
        const lines = part.split('\n');
        lines.forEach((line, i) => {
          if (i > 0) frag.appendChild(el('br'));
          if (line) frag.appendChild(document.createTextNode(line));
        });
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    }
    return frag;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  return { el, toast, confirmModal, progressBar, xpBar, levelRing, streakChip, masteryStrip, renderQuestionText, clear };
})();

window.UI = UI;
