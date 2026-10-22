'use strict';

const API_BASE = window.location.protocol === 'file:'
  ? 'http://127.0.0.1:8000'
  : window.location.origin;
const CHART_LIMIT = 10;

const sessionList = document.querySelector('#session-list');
const sessionTotal = document.querySelector('#session-total');
const dateLabel = document.querySelector('#session-date');
const characterLabel = document.querySelector('#session-character');
const titleLabel = document.querySelector('#session-title');
const scoreLabel = document.querySelector('#session-score');
const durationLabel = document.querySelector('#session-duration');
const summaryLabel = document.querySelector('#session-summary-text');
const insightLabel = document.querySelector('#session-tip');
const detailMetrics = document.querySelector('#detail-metrics');
const chartLine = document.querySelector('#chart-line');
const chartRhythmLine = document.querySelector('#chart-line-rhythm');
const chartArea = document.querySelector('#chart-area');
const chartPoints = document.querySelector('#chart-points');
const chartLabels = document.querySelector('#chart-labels');
const chartDescription = document.querySelector('#chart-description');
const trendBadge = document.querySelector('#trend-badge');
const analysisStatus = document.querySelector('#analysis-status');
const recommendationPanel = document.querySelector('#recommendation-panel');
const recommendationList = document.querySelector('#session-recommendations');
const overviewSessionCount = document.querySelector('#overview-session-count');
const overviewClarity = document.querySelector('#overview-clarity');
const overviewWpm = document.querySelector('#overview-wpm');
const verboMessage = document.querySelector('#verbo-message');
const verboFrame = document.querySelector('#verbo-frame');
const rangeButtons = Array.from(document.querySelectorAll('.session-filter'));
const btnDeleteSession = document.querySelector('#btn-delete-session');
let verboTipIndex = 0;

const metricDefinitions = [
  { key: 'claridad', label: 'Claridad estimada', suffix: '/100', scale: 100 },
  { key: 'ritmo', label: 'Ritmo estimado', suffix: '/100', scale: 100 },
  { key: 'coherencia', label: 'Coherencia con la conversación', suffix: '/100', scale: 100 },
  { key: 'muletillas', label: 'Muletillas detectadas', suffix: '', scale: null },
  { key: 'pausas', label: 'Pausas (no medidas)', suffix: '', scale: null },
  { key: 'palabras_por_minuto', label: 'Palabras/min (estimadas)', suffix: ' ppm', scale: null },
  { key: 'manejo_tema', label: 'Manejo del tema', suffix: '/100', scale: 100 }
];

let sessions = [];
let selectedSessionId = null;
let selectedRange = 'all';
let detailRequest = 0;
const detailCache = new Map();

function getSessionDate(session) {
  if (!session || !session.fecha_inicio) return null;
  const date = new Date(session.fecha_inicio);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date, options) {
  if (!date) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', options || {
    day: 'numeric',
    month: 'short'
  }).format(date);
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 'Duración no disponible';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0') + ' min';
}

function hasMetrics(analysis) {
  return Boolean(analysis && [
    analysis.claridad,
    analysis.ritmo,
    analysis.coherencia,
    analysis.muletillas,
    analysis.palabras_por_minuto
  ].some(function (value) {
    return value !== null && value !== undefined;
  }));
}

function getVisibleSessions() {
  if (selectedRange === 'all') return sessions;
  const cutoff = Date.now() - Number(selectedRange) * 24 * 60 * 60 * 1000;
  return sessions.filter(function (session) {
    const date = getSessionDate(session);
    return date && date.getTime() >= cutoff;
  });
}

function averageMetric(items, key) {
  const values = items
    .map(function (session) { return session.analisis && session.analisis[key]; })
    .filter(function (value) { return Number.isFinite(value); });
  if (!values.length) return null;
  return Math.round(values.reduce(function (total, value) { return total + value; }, 0) / values.length);
}

function renderOverview() {
  const analyzed = sessions.filter(function (session) { return hasMetrics(session.analisis); });
  const clarity = averageMetric(analyzed, 'claridad');
  const wpm = averageMetric(analyzed, 'palabras_por_minuto');
  overviewSessionCount.textContent = String(analyzed.length);
  overviewClarity.textContent = clarity === null ? '—' : clarity + '/100';
  overviewWpm.textContent = wpm === null ? '—' : wpm + ' ppm';
}

function showStatus(message, isError) {
  analysisStatus.textContent = message;
  analysisStatus.classList.toggle('is-error', Boolean(isError));
  analysisStatus.classList.toggle('is-visible', Boolean(message));
}

function redirectToLogin() {
  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.replace('/login?next=' + encodeURIComponent(next));
}

function renderMetricCard(metric, value) {
  if (metric.key === 'pausas') value = null;
  const card = document.createElement('div');
  card.className = 'detail-metric';
  const label = document.createElement('div');
  label.className = 'detail-metric-label';
  const name = document.createElement('span');
  name.textContent = metric.label;
  const result = document.createElement('strong');
  result.textContent = value === null || value === undefined ? '—' : String(value) + metric.suffix;
  label.append(name, result);
  card.append(label);

  if (metric.scale && Number.isFinite(value)) {
    const track = document.createElement('div');
    track.className = 'detail-metric-track';
    const fill = document.createElement('span');
    fill.style.width = Math.max(0, Math.min(100, Number(value))) + '%';
    track.append(fill);
    card.append(track);
  }
  detailMetrics.append(card);
}

async function showSession(session) {
  if (!session) {
    selectedSessionId = null;
    clearSessionDetail('Selecciona una sesión con análisis para consultar sus métricas.');
    renderChart();
    return;
  }

  selectedSessionId = String(session.id);
  const requestId = ++detailRequest;

  if (btnDeleteSession) {
    btnDeleteSession.hidden = false;
    btnDeleteSession.disabled = false;
    btnDeleteSession.onclick = function () { deleteSession(session.id, btnDeleteSession); };
  }
  dateLabel.textContent = formatDate(getSessionDate(session), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  characterLabel.textContent = session.personaje_nombre || 'Sesión de práctica';
  titleLabel.textContent = 'Análisis de la sesión';
  durationLabel.textContent = formatDuration(session.duracion_segundos);
  scoreLabel.textContent = Number.isFinite(session.analisis && session.analisis.claridad)
    ? session.analisis.claridad + '%'
    : '—';
  summaryLabel.textContent = hasMetrics(session.analisis)
    ? 'Medidas calculadas desde la transcripción guardada.'
    : 'Esta sesión todavía no tiene métricas calculables.';
  detailMetrics.replaceChildren();
  metricDefinitions.forEach(function (metric) {
    renderMetricCard(metric, session.analisis && session.analisis[metric.key]);
  });
  renderRecommendations([]);
  renderCoherence(session.analisis);
  insightLabel.textContent = getInsight(session.analisis);

  document.querySelectorAll('.session-option').forEach(function (button) {
    button.setAttribute('aria-pressed', String(button.dataset.sessionId === selectedSessionId));
  });
  renderChart();

  try {
    const result = await getSessionDetail(session);
    if (requestId !== detailRequest || String(result.sesion.id) !== selectedSessionId) return;
    if (result.analisis && hasMetrics(result.analisis)) {
      detailMetrics.replaceChildren();
      metricDefinitions.forEach(function (metric) {
        renderMetricCard(metric, result.analisis[metric.key]);
      });
      insightLabel.textContent = getInsight(result.analisis);
      summaryLabel.textContent = 'Medidas calculadas desde la transcripción guardada.';
    }
    renderCoherence(result.analisis);
    renderTranscript(result.sesion, result.analisis);
    renderRecommendations(result.analisis && result.analisis.recomendaciones);
    renderRetroalimentacion(result.analisis);
  } catch (error) {
    if (requestId === detailRequest) {
      renderTranscript(null, null);
      showStatus(error.message, true);
    }
  }
}

function getSessionDetail(session) {
  const id = String(session.id);
  if (!detailCache.has(id)) {
    const request = fetch(API_BASE + '/sesiones/' + encodeURIComponent(id))
      .then(async function (response) {
        const result = await response.json();
        if (response.status === 401) {
          redirectToLogin();
          throw new Error('Tu sesión expiró. Vuelve a iniciar sesión para consultar tus análisis.');
        }
        if (!response.ok) throw new Error(result.detail || 'No se pudo cargar el análisis de esta sesión.');
        return result;
      })
      .catch(function (error) {
        detailCache.delete(id);
        throw error;
      });
    detailCache.set(id, request);
  }
  return detailCache.get(id);
}

function clearSessionDetail(message) {
  if (btnDeleteSession) btnDeleteSession.hidden = true;
  dateLabel.textContent = '';
  characterLabel.textContent = '';
  titleLabel.textContent = 'Sin sesiones disponibles';
  scoreLabel.textContent = '—';
  durationLabel.textContent = '';
  summaryLabel.textContent = message;
  insightLabel.textContent = 'Cuando termines una práctica con transcripción, sus métricas aparecerán aquí.';
  detailMetrics.replaceChildren();
  document.querySelector('#session-transcript').replaceChildren();
  renderRecommendations([]);
  renderCoherence(null);
  renderRetroalimentacion(null);
}

function renderRecommendations(recommendations) {
  recommendationList.replaceChildren();
  const items = Array.isArray(recommendations)
    ? recommendations.filter(function (recommendation) {
      return typeof recommendation === 'string' && recommendation.trim();
    })
    : [];
  recommendationPanel.hidden = !items.length;
  items.forEach(function (recommendation) {
    const item = document.createElement('li');
    item.textContent = recommendation;
    recommendationList.append(item);
  });
}

function renderRetroalimentacion(analysis) {
  const panel = document.querySelector('#retroalimentacion-panel');
  const resumen = document.querySelector('#retroalimentacion-resumen');
  const lista = document.querySelector('#retroalimentacion-detalle');
  if (!panel || !resumen || !lista) return;
  lista.replaceChildren();
  const detalle = analysis && Array.isArray(analysis.retroalimentacion_detalle)
    ? analysis.retroalimentacion_detalle
    : [];
  const texto = analysis && analysis.retroalimentacion;
  if (!detalle.length && !texto) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  resumen.textContent = texto || '';
  resumen.hidden = !texto;
  detalle.forEach(function (item) {
    const row = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'retroalimentacion-detalle-head';
    const label = document.createElement('strong');
    label.textContent = item.etiqueta || 'Métrica';
    const value = document.createElement('span');
    value.textContent = item.valor_texto || (item.valor !== null && item.valor !== undefined ? String(item.valor) : '—');
    head.append(label, value);
    row.append(head);
    if (item.motivo) {
      const motivo = document.createElement('p');
      motivo.textContent = item.motivo;
      row.append(motivo);
    }
    lista.append(row);
  });
}

function deleteSession(sessionId, button) {
  if (!window.confirm('¿Eliminar esta sesión y su análisis? Esta acción no se puede deshacer.')) return;
  if (button) button.disabled = true;

  fetch(API_BASE + '/sesiones/' + encodeURIComponent(sessionId), {
    method: 'DELETE'
  })
    .then(async function (response) {
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'No se pudo eliminar la sesión.');
      return result;
    })
    .then(function () {
      // Recargar la lista de sesiones
      loadSessions();
      clearSessionDetail('Sesión eliminada.');
      // El botón es único en el DOM: hay que rehabilitarlo y limpiar la
      // caché para poder borrar o volver a consultar otra sesión después.
      detailCache.delete(String(sessionId));
      if (button) button.disabled = false;
    })
    .catch(function (error) {
      if (button) button.disabled = false;
      showStatus(error.message, true);
    });
}

function getInsight(analysis) {
  if (!hasMetrics(analysis)) {
    return 'No se generaron métricas porque esta sesión no tiene una transcripción guardada.';
  }
  const tips = [];
  if (Number.isFinite(analysis.muletillas) && analysis.muletillas > 0) {
    tips.push('Se detectaron ' + analysis.muletillas + ' posibles muletillas en la transcripción.');
  }
  if (Number.isFinite(analysis.palabras_por_minuto)) {
    tips.push('El ritmo estimado fue de ' + analysis.palabras_por_minuto + ' palabras por minuto, calculado con la duración total de la práctica.');
  }
  if (Number.isFinite(analysis.coherencia)) {
    const nDesvios = Array.isArray(analysis.desvios) ? analysis.desvios.length : 0;
    if (nDesvios > 0) {
      tips.push('Coherencia de ' + analysis.coherencia + '/100: se señalaron ' + nDesvios + (nDesvios === 1 ? ' desvío' : ' desvíos') + ' del hilo. Revísalos en el panel de coherencia.');
    } else {
      tips.push('Coherencia de ' + analysis.coherencia + '/100: tus respuestas siguieron el hilo de la conversación.');
    }
  }
  if (!tips.length) {
    tips.push('La transcripción no contiene suficientes datos para generar una recomendación adicional.');
  }
  return tips.join(' ');
}

function renderCoherence(analysis) {
  const panel = document.querySelector('#coherence-panel');
  const summary = document.querySelector('#coherence-summary');
  const list = document.querySelector('#coherence-deviations');
  if (!panel || !summary || !list) return;
  list.replaceChildren();
  const coherence = analysis && analysis.coherencia;
  const deviations = analysis && Array.isArray(analysis.desvios) ? analysis.desvios : [];
  if (!Number.isFinite(coherence)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const resume = analysis.resumen_coherencia || 'Coherencia estimada a partir de tus respuestas.';
  summary.textContent = 'Puntuación: ' + coherence + '/100. ' + resume;
  if (!deviations.length) {
    const ok = document.createElement('li');
    ok.textContent = 'Sin desvíos: respondiste al hilo en cada turno.';
    list.append(ok);
    return;
  }
  deviations.forEach(function (deviation) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = 'Turno ' + (deviation.turno || '?') + ': ' + (deviation.motivo || 'desvío del hilo');
    item.append(title);
    if (deviation.dijo) {
      const said = document.createElement('p');
      said.textContent = 'Dijiste: «' + deviation.dijo + '»';
      item.append(said);
    }
    if (deviation.venia_de) {
      const context = document.createElement('p');
      context.textContent = 'Venía de: «' + deviation.venia_de + '»';
      item.append(context);
    }
    list.append(item);
  });
}

function renderTranscript(session, analysis) {
  const container = document.querySelector('#session-transcript');
  container.replaceChildren();
  // 1) Transcripción completa guardada en tabla `analisis.transcripcion_completa`
  //    ya viene en formato diálogo "Tú: ... / Personaje: ..." si la sesión es nueva.
  //    Las sesiones viejas solo tienen texto del usuario: se muestran igual.
  const transcript = analysis && analysis.transcripcion_completa;
  if (transcript) {
    transcript.split('\n').forEach(function (line) {
      const text = line.trim();
      if (!text) return;
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      container.append(paragraph);
    });
    return;
  }

  // 2) Respaldo: historial de tabla `sesiones.mensajes` mostrado como diálogo.
  const messages = session && Array.isArray(session.mensajes) ? session.mensajes : [];
  const userMessages = [];
  const botMessages = [];
  messages.forEach(function (message) {
    if (!message.content) return;
    if (message.role === 'user') userMessages.push(message);
    else if (message.role === 'assistant') botMessages.push(message);
  });
  // Diálogo: intercalar si hay respuestas del bot; si no, mostrar solo al usuario.
  const dialog = [];
  const total = Math.max(userMessages.length, botMessages.length);
  for (let i = 0; i < total; i += 1) {
    if (userMessages[i]) dialog.push({ who: 'Tú', content: userMessages[i].content });
    if (botMessages[i]) dialog.push({ who: 'Bot', content: botMessages[i].content });
  }
  if (dialog.length) {
    dialog.forEach(function (turn) {
      const paragraph = document.createElement('p');
      paragraph.innerHTML = '';
      const speaker = document.createElement('strong');
      speaker.textContent = turn.who + ': ';
      paragraph.append(speaker, document.createTextNode(turn.content));
      container.append(paragraph);
    });
    return;
  }

  const empty = document.createElement('p');
  empty.className = 'transcript-empty';
  empty.textContent = 'No hay transcripción disponible para esta sesión.';
  container.append(empty);
}

function renderSessionList() {
  const visibleSessions = getVisibleSessions();
  sessionList.replaceChildren();
  sessionTotal.textContent = visibleSessions.length + (visibleSessions.length === 1 ? ' sesión' : ' sesiones');

  if (!visibleSessions.length) {
    const empty = document.createElement('p');
    empty.className = 'session-empty';
    empty.textContent = sessions.length
      ? 'No hay sesiones en este periodo.'
      : 'Todavía no hay sesiones guardadas para analizar.';
    sessionList.append(empty);
    if (!sessions.length) {
      const startPractice = document.createElement('a');
      startPractice.className = 'btn btn-solid session-empty-link';
      startPractice.href = 'personajes.html';
      startPractice.textContent = 'Empezar una práctica';
      sessionList.append(startPractice);
    }
    return;
  }

  visibleSessions.forEach(function (session) {
    const button = document.createElement('button');
    button.className = 'session-option';
    button.type = 'button';
    button.dataset.sessionId = String(session.id);
    button.setAttribute('aria-pressed', String(String(session.id) === selectedSessionId));

    const icon = document.createElement('span');
    icon.className = 'session-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✳';
    const copy = document.createElement('span');
    copy.className = 'session-option-copy';
    const name = document.createElement('strong');
    name.textContent = session.personaje_nombre || 'Sesión de práctica';
    const metadata = document.createElement('small');
    metadata.textContent = formatDate(getSessionDate(session)) + ' · ' + formatDuration(session.duracion_segundos);
    copy.append(name, metadata);

    const score = document.createElement('span');
    score.className = 'session-option-score';
    const clarity = session.analisis && session.analisis.claridad;
    score.textContent = Number.isFinite(clarity) ? String(clarity) : '—';
    const label = document.createElement('small');
    label.textContent = Number.isFinite(clarity) ? 'CLARIDAD' : 'SIN DATOS';
    score.append(label);
    button.append(icon, copy, score);
    button.addEventListener('click', function () { showSession(session); });
    sessionList.append(button);
  });
}

function makeChartPoint(namespace, x, y, session, metric, value, offset) {
  const circle = document.createElementNS(namespace, 'circle');
  circle.setAttribute('cx', x + offset);
  circle.setAttribute('cy', y);
  circle.setAttribute('r', String(session.id) === selectedSessionId ? '7' : '5');
  circle.classList.add('chart-point', metric === 'ritmo' ? 'chart-point-rhythm' : 'chart-point-clarity');
  if (String(session.id) === selectedSessionId) circle.classList.add('is-selected');
  circle.setAttribute('tabindex', '0');
  circle.setAttribute('role', 'button');
  circle.setAttribute('aria-label', session.personaje_nombre + ', ' + metric + ' estimado: ' + value + ' de 100');
  circle.addEventListener('click', function () { showSession(session); });
  circle.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showSession(session);
    }
  });
  return circle;
}

function renderChart() {
  const available = getVisibleSessions()
    .filter(function (session) {
      return session.analisis && (
        Number.isFinite(session.analisis.claridad) ||
        Number.isFinite(session.analisis.ritmo)
      );
    })
    .slice(0, CHART_LIMIT)
    .reverse();

  chartLine.setAttribute('points', '');
  chartRhythmLine.setAttribute('points', '');
  chartArea.setAttribute('d', '');
  chartPoints.replaceChildren();
  chartLabels.replaceChildren();
  chartLabels.style.gridTemplateColumns = 'repeat(' + Math.max(available.length, 1) + ', minmax(0, 1fr))';

  if (!available.length) {
    trendBadge.textContent = 'Sin datos';
    chartDescription.textContent = 'No hay métricas de claridad o ritmo disponibles para las sesiones de este periodo.';
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'La gráfica aparecerá cuando haya sesiones finalizadas con transcripción.';
    chartLabels.append(empty);
    return;
  }

  const chartWidth = 520;
  const chartTop = 15;
  const chartBottom = 180;
  const chartHeight = chartBottom - chartTop;
  const padding = 12;
  const coords = available.map(function (session, index) {
    const x = available.length === 1
      ? chartWidth / 2
      : padding + index * (chartWidth - padding * 2) / (available.length - 1);
    const analysis = session.analisis || {};
    return {
      session: session,
      x: x,
      clarity: Number.isFinite(analysis.claridad) ? chartBottom - analysis.claridad / 100 * chartHeight : null,
      rhythm: Number.isFinite(analysis.ritmo) ? chartBottom - analysis.ritmo / 100 * chartHeight : null
    };
  });
  const clarityPoints = coords.filter(function (point) { return point.clarity !== null; });
  const rhythmPoints = coords.filter(function (point) { return point.rhythm !== null; });
  const toPolyline = function (points, key) {
    return points.map(function (point) { return point.x + ',' + point[key]; }).join(' ');
  };

  chartLine.setAttribute('points', toPolyline(clarityPoints, 'clarity'));
  chartRhythmLine.setAttribute('points', toPolyline(rhythmPoints, 'rhythm'));
  if (clarityPoints.length) {
    chartArea.setAttribute('d', 'M ' + clarityPoints[0].x + ' ' + chartBottom + ' L ' +
      clarityPoints.map(function (point) { return point.x + ' ' + point.clarity; }).join(' L ') +
      ' L ' + clarityPoints[clarityPoints.length - 1].x + ' ' + chartBottom + ' Z');
  }

  const namespace = 'http://www.w3.org/2000/svg';
  coords.forEach(function (point) {
    if (point.clarity !== null) {
      chartPoints.append(makeChartPoint(namespace, point.x, point.clarity, point.session, 'claridad', point.session.analisis.claridad, -3));
    }
    if (point.rhythm !== null) {
      chartPoints.append(makeChartPoint(namespace, point.x, point.rhythm, point.session, 'ritmo', point.session.analisis.ritmo, 3));
    }
    const label = document.createElement('span');
    label.textContent = formatDate(getSessionDate(point.session));
    chartLabels.append(label);
  });

  const first = available[0].analisis || {};
  const last = available[available.length - 1].analisis || {};
  if (Number.isFinite(first.claridad) && Number.isFinite(last.claridad)) {
    const change = last.claridad - first.claridad;
    trendBadge.textContent = 'Claridad ' + (change > 0 ? '+' : '') + change + ' pts';
  } else {
    trendBadge.textContent = available.length + (available.length === 1 ? ' sesión' : ' sesiones');
  }
  chartDescription.textContent = 'Métricas reales estimadas de ' + available.length + ' sesiones. ' +
    coords.map(function (point) {
      const values = [];
      if (Number.isFinite(point.session.analisis.claridad)) values.push('claridad ' + point.session.analisis.claridad);
      if (Number.isFinite(point.session.analisis.ritmo)) values.push('ritmo ' + point.session.analisis.ritmo);
      return formatDate(getSessionDate(point.session)) + ': ' + values.join(', ');
    }).join('; ') + '.';
}

async function loadSessions() {
  showStatus('Cargando sesiones y métricas reales…', false);
  try {
    const response = await fetch(API_BASE + '/sesiones');
    const result = await response.json();
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    if (!response.ok) throw new Error(result.detail || 'No se pudieron cargar las sesiones.');
    if (!Array.isArray(result.sesiones)) throw new Error('El servidor devolvió un historial no válido.');

    sessions = result.sesiones;
    sessions.sort(function (first, second) {
      return (getSessionDate(second)?.getTime() || 0) - (getSessionDate(first)?.getTime() || 0);
    });
    const visibleSessions = getVisibleSessions();
    const requestedSessionId = new URLSearchParams(window.location.search).get('sesion');
    const requestedSession = requestedSessionId
      ? visibleSessions.find(function (session) { return String(session.id) === requestedSessionId; })
      : null;
    renderOverview();
    renderSessionList();
    renderChart();
    const selected = requestedSession || visibleSessions[0];
    showStatus(
      sessions.length
        ? 'Datos reales del historial. Las puntuaciones de claridad y ritmo son estimaciones basadas en transcripción y duración.'
        : 'Aún no hay sesiones guardadas para analizar. Completa una práctica y vuelve a esta página.',
      false
    );
    if (sessions.some(function (session) {
      return !Object.prototype.hasOwnProperty.call(session, 'analisis');
    })) {
      showStatus('Sesiones cargadas. Consultando las métricas guardadas…', false);
    }
    await showSession(selected);
    hydrateSessionSummaries();
  } catch (error) {
    sessions = [];
    renderOverview();
    renderSessionList();
    clearSessionDetail('No se pudo cargar el análisis real.');
    renderChart();
    showStatus(error.message + ' Inicia el servidor y verifica DATABASE_URL.', true);
  }
}

async function hydrateSessionSummaries() {
  const pending = sessions.filter(function (session) {
    return !Object.prototype.hasOwnProperty.call(session, 'analisis');
  });
  let nextIndex = 0;
  let failedCount = 0;

  async function loadNext() {
    while (nextIndex < pending.length) {
      const session = pending[nextIndex];
      nextIndex += 1;
      try {
        const detail = await getSessionDetail(session);
        session.analisis = detail.analisis;
      } catch (error) {
        session.analisis = null;
        failedCount += 1;
      }
      renderOverview();
      renderSessionList();
      renderChart();
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, loadNext));
  if (failedCount) {
    showStatus('No se pudieron cargar las métricas de ' + failedCount + ' sesión' +
      (failedCount === 1 ? '' : 'es') + '. Puedes volver a intentarlo actualizando la página.', true);
  } else if (pending.length) {
    showStatus('Datos reales del historial. Las puntuaciones de claridad y ritmo son estimaciones basadas en transcripción y duración.', false);
  }
}

function setVerboExpression(expression, message) {
  if (verboMessage && message) verboMessage.textContent = message;
  if (verboFrame.contentWindow) {
    verboFrame.contentWindow.postMessage({ type: 'verbo-expression', expression }, '*');
  }
}

const verboTips = [
  'Aqui puedes revisar como evoluciona tu claridad y tu ritmo sesion a sesion.',
  'La claridad estimada resume que tan facil resulta seguir tus ideas segun la transcripcion.',
  'El ritmo estimado usa tus palabras y la duracion de la practica; no mide pausas exactas.',
  'Elige una sesion para ver sus metricas, la transcripcion y recomendaciones personalizadas.'
];

function showNextVerboTip() {
  setVerboExpression('explain', verboTips[verboTipIndex]);
  verboTipIndex = (verboTipIndex + 1) % verboTips.length;
}


rangeButtons.forEach(function (button) {
  button.addEventListener('click', function () {
    selectedRange = button.dataset.range;
    rangeButtons.forEach(function (filter) {
      const active = filter === button;
      filter.classList.toggle('is-active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    renderSessionList();
    const visible = getVisibleSessions();
    const selectedStillVisible = visible.some(function (session) {
      return String(session.id) === selectedSessionId;
    });
    showSession(selectedStillVisible
      ? visible.find(function (session) { return String(session.id) === selectedSessionId; })
      : visible[0]);
    renderChart();
  });
});

setVerboExpression('curious', verboTips[0]);
window.setInterval(showNextVerboTip, 5000);
loadSessions();
