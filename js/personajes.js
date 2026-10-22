'use strict';

const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : window.location.origin;

const difficultyFilters = Array.from(document.querySelectorAll('[data-difficulty]'));
const characterCards = Array.from(document.querySelectorAll('.wave-character'));

difficultyFilters.forEach(function (filter) {
  filter.addEventListener('click', function () {
    const selectedDifficulty = filter.dataset.difficulty;

    difficultyFilters.forEach(function (button) {
      const isActive = button === filter;
      button.classList.toggle('chip-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    characterCards.forEach(function (card) {
      const difficulty = card.querySelector('.character-difficulty');
      const matches = selectedDifficulty === 'all' ||
        Boolean(difficulty && difficulty.classList.contains('difficulty-' + selectedDifficulty));
      card.classList.toggle('is-filtered', !matches);
    });
  });
});

/* Mis creaciones: personajes del Constructor con botón Practicar. */
(async function loadCustomCreations() {
  const section = document.querySelector('#mis-creaciones');
  const grid = document.querySelector('#custom-characters-grid');
  if (!section || !grid) return;
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  let customs = [];
  try {
    const r = await fetch(API_BASE + '/api/personajes');
    const d = await r.json();
    if (r.ok && Array.isArray(d.personajes)) customs = d.personajes;
  } catch (e) { customs = []; }
  if (!customs.length) {
    try {
      const raw = localStorage.getItem('verbia-custom-characters');
      const parsed = raw ? JSON.parse(raw) : [];
      customs = (Array.isArray(parsed) ? parsed : []).map(function (c, i) {
        return { id: null, localIndex: i, nombre: c.nombre || c.name, descripcion: c.descripcion || c.description, tema: c.tema || '', imagen_data: c.imagen_data || c.image };
      });
    } catch (e) { customs = []; }
  }
  if (!customs.length) return;
  section.hidden = false;

  async function eliminarPersonaje(c, cardEl) {
    const nombre = c.nombre || 'Sin nombre';
    if (!window.confirm('¿Eliminar a "' + nombre + '"? Esta acción no se puede deshacer.')) return;

    try {
      if (c.id) {
        // Personaje guardado en el servidor
        const r = await fetch(API_BASE + '/api/personajes/' + encodeURIComponent(c.id), {
          method: 'DELETE'
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.detail || 'No se pudo eliminar el personaje.');
        }
      } else {
        // Personaje solo en localStorage
        const raw = localStorage.getItem('verbia-custom-characters');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const index = parsed.findIndex(function (p) {
          return (p.nombre || p.name) === nombre;
        });
        if (index >= 0) {
          parsed.splice(index, 1);
          localStorage.setItem('verbia-custom-characters', JSON.stringify(parsed));
        }
      }
      cardEl.remove();
      if (!grid.children.length) {
        section.hidden = true;
      }
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message);
    }
  }

  customs.forEach(function (c, i) {
    const card = document.createElement('article');
    card.className = 'wave-character';
    const img = c.imagen_data ? '<img src="' + esc(c.imagen_data) + '" alt="Retrato" loading="lazy" />' : '';
    card.innerHTML = '<div class="wave-portrait">' + img + '<span class="wave-index">★</span></div>' +
      '<div class="wave-info"><div class="wave-info-head"><h3>' + esc(c.nombre || 'Sin nombre') + '</h3>' +
      '<span class="character-difficulty difficulty-easy">Personalizado</span></div>' +
      '<p>' + esc((c.descripcion || '').slice(0, 220) || 'Personaje creado en el Constructor.') + '</p>' +
      '<a class="wave-cta" href="#">Practicar</a>' +
      '<button type="button" class="wave-delete" title="Eliminar ' + esc(c.nombre || 'Sin nombre') + '">Eliminar</button>' +
      '</div>';
    card.querySelector('.wave-cta').addEventListener('click', function (ev) {
      ev.preventDefault();
      if (c.id) {
        window.location.href = 'practicar.html?personaje=custom-' + encodeURIComponent(c.id);
      } else {
        try { sessionStorage.setItem('verbia-custom-draft', JSON.stringify({ nombre: c.nombre, descripcion: c.descripcion, tema: c.tema || '', imagen_data: c.imagen_data })); } catch (e) {}
        window.location.href = 'practicar.html?personaje=custom-local';
      }
    });
    card.querySelector('.wave-delete').addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      eliminarPersonaje(c, card);
    });
    grid.append(card);
  });
})();
