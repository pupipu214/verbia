'use strict';

const API_BASE = window.location.protocol === 'file:'
  ? 'http://127.0.0.1:8000'
  : window.location.origin;
const LOCAL_SESSIONS_KEY = 'verbiaPracticeSessions';
const historyList = document.querySelector('#session-list');
const historyCount = document.querySelector('#history-count');
const historyMessage = document.querySelector('#history-message');
const analysisDialog = document.querySelector('#analysis-dialog');
const analysisContent = document.querySelector('#analysis-content');
const dialogClose = document.querySelector('#dialog-close');
let sessions = [];
let currentUserId = null;

function readLocalSessions() {
  const stored = JSON.parse(localStorage.getItem(LOCAL_SESSIONS_KEY) || '[]');
  if (!Array.isArray(stored)) throw new Error('El historial local tiene un formato no válido.');
  return stored.map(function (session, index) {
    return { ...session, id: 'local-' + index, localIndex: index, local: true };
  });
}

function showMessage(message, isError) {
  historyMessage.textContent = message;
  historyMessage.classList.toggle('is-visible', Boolean(message));
  historyMessage.classList.toggle('is-error', Boolean(isError));
}

async function loadSessions() {
  historyList.replaceChildren();
  historyCount.textContent = 'Cargando sesiones…';
  showMessage('', false);

  let remoteSessions = [];
  let remoteAvailable = false;
  try {
    const accountResponse = await fetch(API_BASE + '/auth/me', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const account = await accountResponse.json();
    if (accountResponse.status === 401) {
      const next = window.location.pathname + window.location.search;
      window.location.replace('/login?next=' + encodeURIComponent(next));
      return;
    }
    if (!accountResponse.ok || !account.authenticated || typeof account.id !== 'string') {
      throw new Error('No se pudo verificar la cuenta activa.');
    }
    currentUserId = account.id;
  } catch (error) {
    showMessage(error instanceof Error ? error.message : 'No se pudo verificar la cuenta activa.', true);
  }

  try {
    const response = await fetch(API_BASE + '/sesiones');
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'No se pudieron cargar las sesiones.');
    if (!Array.isArray(result.sesiones)) throw new Error('El servidor devolvió un historial no válido.');
    remoteSessions = result.sesiones;
    remoteAvailable = true;
  } catch (error) {
    showMessage('No fue posible conectar con el historial del servidor. Se muestran las sesiones guardadas en este navegador.', true);
  }

  let localSessions = [];
  try {
    localSessions = currentUserId
      ? readLocalSessions().filter(function (session) {
        return session.user_id === currentUserId;
      })
      : [];
  } catch (error) {
    showMessage(error.message, true);
  }

  const remoteIds = new Set(remoteSessions.map(function (session) { return String(session.id); }));
  sessions = remoteSessions.concat(localSessions.filter(function (session) {
    return !remoteIds.has(String(session.id));
  }));
  sessions.sort(function (first, second) {
    return getDateValue(second.fecha_inicio) - getDateValue(first.fecha_inicio);
  });
  renderSessions();

  if (remoteAvailable && localSessions.length) {
    showMessage('Se muestran las sesiones del servidor y las guardadas localmente en este navegador.', false);
  } else if (remoteAvailable && !sessions.length) {
    showMessage('', false);
  }
}

function getDateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function formatDateTime(value) {
  if (!getDateValue(value)) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 'Duración no disponible';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = String(Math.floor(seconds % 60)).padStart(2, '0');
  return minutes + ':' + remainingSeconds + ' min';
}

function createAction(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'history-action ' + className;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function renderSessions() {
  historyList.replaceChildren();
  historyCount.textContent = sessions.length + (sessions.length === 1 ? ' sesión' : ' sesiones');

  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    const title = document.createElement('strong');
    title.textContent = 'Aún no hay sesiones guardadas.';
    const description = document.createElement('p');
    description.textContent = 'Cuando termines una práctica, podrás volver aquí para revisar su fecha, duración y análisis.';
    const link = document.createElement('a');
    link.className = 'btn btn-solid';
    link.href = 'personajes.html';
    link.textContent = 'Elegir un personaje';
    empty.append(title, description, link);
    historyList.append(empty);
    return;
  }

  sessions.forEach(function (session) {
    const card = document.createElement('article');
    card.className = 'history-card';
    const info = document.createElement('div');
    info.className = 'history-session-info';
    const icon = document.createElement('span');
    icon.className = 'history-session-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✳';
    const copy = document.createElement('div');
    copy.className = 'history-session-copy';
    const title = document.createElement('h3');
    title.textContent = session.personaje_nombre || 'Sesión de práctica';
    const metadata = document.createElement('p');
    const date = document.createElement('span');
    date.textContent = formatDateTime(session.fecha_inicio);
    const duration = document.createElement('span');
    duration.textContent = formatDuration(session.duracion_segundos);
    metadata.append(date, duration);
    copy.append(title, metadata);
    info.append(icon, copy);

    const actions = document.createElement('div');
    actions.className = 'history-actions';
    actions.append(
      createAction('Ver análisis', 'history-action--analysis', function () {
        openAnalysis(session);
      }),
      createAction('Eliminar sesión', 'history-action--delete', function (event) {
        deleteSession(session, event.currentTarget);
      })
    );
    card.append(info, actions);
    historyList.append(card);
  });
}

function addMetric(container, label, value, suffix) {
  const card = document.createElement('div');
  card.className = 'analysis-metric';
  const caption = document.createElement('span');
  caption.textContent = label;
  const result = document.createElement('strong');
  result.textContent = value === null || value === undefined || value === ''
    ? '—'
    : String(value) + (suffix || '');
  card.append(caption, result);
  container.append(card);
}

function renderTranscript(container, messages, fallbackText) {
  const section = document.createElement('section');
  section.className = 'analysis-section';
  const heading = document.createElement('h3');
  heading.textContent = 'Conversación';
  const transcript = document.createElement('div');
  transcript.className = 'analysis-transcript';

  if (Array.isArray(messages) && messages.length) {
    messages.forEach(function (message) {
      const entry = document.createElement('p');
      const speaker = document.createElement('strong');
      speaker.textContent = message.role === 'assistant' ? 'Personaje' : 'Tú';
      const text = document.createElement('span');
      text.textContent = message.content || '';
      entry.append(speaker, text);
      transcript.append(entry);
    });
  } else if (fallbackText) {
    const entry = document.createElement('p');
    entry.className = 'transcript-empty';
    entry.textContent = fallbackText;
    transcript.append(entry);
  } else {
    const entry = document.createElement('p');
    entry.className = 'transcript-empty';
    entry.textContent = 'Esta sesión no tiene mensajes guardados.';
    transcript.append(entry);
  }

  section.append(heading, transcript);
  container.append(section);
}

async function openAnalysis(session) {
  analysisContent.replaceChildren();
  const loading = document.createElement('p');
  loading.textContent = 'Cargando análisis de la sesión…';
  analysisContent.append(loading);
  analysisDialog.showModal();

  try {
    let detail;
    if (session.local) {
      detail = { sesion: session, analisis: null };
    } else {
      const response = await fetch(API_BASE + '/sesiones/' + encodeURIComponent(session.id));
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'No se pudo cargar el análisis.');
      detail = result;
    }
    renderAnalysis(detail);
  } catch (error) {
    analysisContent.replaceChildren();
    const message = document.createElement('p');
    message.className = 'history-message is-visible is-error';
    message.textContent = error.message;
    analysisContent.append(message);
  }
}

function renderAnalysis(detail) {
  analysisContent.replaceChildren();
  const session = detail.sesion || {};
  const analysis = detail.analisis || {};
  const meta = document.createElement('p');
  meta.className = 'analysis-session-meta';
  meta.textContent = (session.personaje_nombre || 'Sesión de práctica') + ' · ' +
    formatDateTime(session.fecha_inicio) + ' · ' +
    formatDuration(session.duracion_segundos);
  analysisContent.append(meta);

  const metrics = document.createElement('div');
  metrics.className = 'analysis-metrics';
  addMetric(metrics, 'Claridad', analysis.claridad, '%');
  addMetric(metrics, 'Ritmo', analysis.ritmo, '%');
  addMetric(metrics, 'Muletillas', analysis.muletillas);
  addMetric(metrics, 'Pausas', analysis.pausas);
  addMetric(metrics, 'Palabras por minuto', analysis.palabras_por_minuto);
  if (analysis.manejo_tema !== null && analysis.manejo_tema !== undefined) {
    addMetric(metrics, 'Manejo del tema', analysis.manejo_tema, '/100');
  }
  analysisContent.append(metrics);

  if (!session.local && !detail.analisis) {
    const notice = document.createElement('p');
    notice.className = 'history-message is-visible';
    notice.textContent = 'Esta sesión todavía no tiene métricas de análisis.';
    analysisContent.append(notice);
  } else if (session.local) {
    const notice = document.createElement('p');
    notice.className = 'history-message is-visible';
    notice.textContent = 'Esta sesión se guardó en este navegador; sus métricas detalladas no están disponibles.';
    analysisContent.append(notice);
  }

  if (analysis.retroalimentacion) {
    const retroSection = document.createElement('section');
    retroSection.className = 'analysis-section';
    const retroTitle = document.createElement('h3');
    retroTitle.textContent = 'Retroalimentación';
    const retroText = document.createElement('p');
    retroText.className = 'analysis-retroalimentacion';
    retroText.textContent = analysis.retroalimentacion;
    retroSection.append(retroTitle, retroText);
    analysisContent.append(retroSection);
  }

  const retroDetalle = Array.isArray(analysis.retroalimentacion_detalle)
    ? analysis.retroalimentacion_detalle
    : [];
  if (retroDetalle.length) {
    const detailSection = document.createElement('section');
    detailSection.className = 'analysis-section';
    const detailTitle = document.createElement('h3');
    detailTitle.textContent = '¿Por qué estos porcentajes?';
    const detailList = document.createElement('ul');
    detailList.className = 'analysis-recommendations';
    retroDetalle.forEach(function (item) {
      const entry = document.createElement('li');
      const head = document.createElement('strong');
      head.textContent = (item.etiqueta || 'Métrica') + ': ' + (item.valor_texto || '—');
      entry.append(head);
      if (item.motivo) {
        const motivo = document.createElement('span');
        motivo.textContent = ' ' + item.motivo;
        entry.append(motivo);
      }
      detailList.append(entry);
    });
    detailSection.append(detailTitle, detailList);
    analysisContent.append(detailSection);
  }

  const recommendations = analysis.recomendaciones;
  if (Array.isArray(recommendations) && recommendations.length) {
    const section = document.createElement('section');
    section.className = 'analysis-section';
    const heading = document.createElement('h3');
    heading.textContent = 'Recomendaciones';
    const list = document.createElement('ul');
    list.className = 'analysis-recommendations';
    recommendations.forEach(function (recommendation) {
      const item = document.createElement('li');
      item.textContent = typeof recommendation === 'string'
        ? recommendation
        : recommendation.texto || recommendation.mensaje || JSON.stringify(recommendation);
      list.append(item);
    });
    section.append(heading, list);
    analysisContent.append(section);
  }
  renderTranscript(analysisContent, session.mensajes, analysis.transcripcion_completa);
}

async function deleteSession(session, button) {
  if (!window.confirm('¿Eliminar esta sesión y su análisis? Esta acción no se puede deshacer.')) return;
  button.disabled = true;

  try {
    if (session.local) {
      const stored = JSON.parse(localStorage.getItem(LOCAL_SESSIONS_KEY) || '[]');
      if (!Array.isArray(stored)) throw new Error('El historial local tiene un formato no válido.');
      stored.splice(session.localIndex, 1);
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(stored));
    } else {
      const response = await fetch(API_BASE + '/sesiones/' + encodeURIComponent(session.id), {
        method: 'DELETE'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'No se pudo eliminar la sesión.');
    }
    await loadSessions();
    if (button) button.disabled = false;
    if (!historyMessage.classList.contains('is-error')) {
      showMessage('La sesión se eliminó correctamente.', false);
    }
  } catch (error) {
    if (button) button.disabled = false;
    showMessage(error.message, true);
  }
}

dialogClose.addEventListener('click', function () { analysisDialog.close(); });
analysisDialog.addEventListener('click', function (event) {
  if (event.target === analysisDialog) analysisDialog.close();
});

// El comportamiento del menú móvil (aria-expanded, cerrar al tocar
// fuera, Escape) lo gestiona js/navigation.js en toda la web.

loadSessions();
