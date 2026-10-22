'use strict';

// ============================================================
// Simulación de aula: el usuario es el profesor y dos alumnos
// (Leonardo y Luis) reaccionan por turnos, cada uno con su voz
// Fish Audio configurada en el backend.
// ============================================================

const API_BASE = window.location.protocol === 'file:'
  ? 'http://127.0.0.1:8000'
  : window.location.origin;

const LOCAL_SESSIONS_KEY = 'verbiaPracticeSessions';

const ALUMNOS = {
  leonardo: {
    backendId: 'leonardo',
    name: 'Leonardo Ríos',
    role: 'Alumno de matemáticas',
    image: 'Imagenes/Leonardo.jpg'
  },
  luis: {
    backendId: 'luis',
    name: 'Luis',
    role: 'Alumno de informática',
    image: 'Imagenes/Luis.jpg'
  }
};

// Saludo inicial: los dos alumnos se presentan por su propia voz Fish.
const TURNO_INICIAL = [
  { personaje: 'leonardo', nombre: 'Leonardo Ríos', texto: 'Hola, profe. Soy Leonardo. ¿Qué tema veremos hoy? Cuéntamelo un poco y ya te pregunto lo que no entienda.' },
  { personaje: 'luis', nombre: 'Luis', texto: 'Hola, profe. Yo soy Luis. ¿De qué será la clase de hoy? Explícanos qué vamos a ver y arrancamos.' }
];

const RUBRICA = [
  ['Explica una idea por turno', 'Da tiempo a que cada alumno la procese antes de seguir.'],
  ['Comprueba la comprensión', 'Pídeles que te expliquen con sus palabras lo que entendieron.'],
  ['Corrige sin desanimar', 'Si se equivocan, reconoce lo correcto y guíalos con una pregunta.']
];

const TIPS_SIMULACION = [
  'Explica una idea por turno: deja que cada alumno la procese.',
  'Comprueba la comprensi?n: p?deles que te expliquen lo entendido.',
  'Corrige sin desanimar: reconoce lo correcto y gu?a con una pregunta.',
  'Leonardo necesita el tema claro; Luis se atasca en la parte t?cnica: dales a cada uno su ritmo.'
];

const IDEAS_PARA_EMPEZAR = [
  'Hoy repasamos las funciones: una función recibe un valor, le hace algo y devuelve otro. ¿Os suena?',
  'Vamos con una pregunta: si tengo trescientos cincuenta euros y los reparto entre siete personas, ¿cuánto le toca a cada una?',
  'La clase de hoy trata de listas en programación: una lista guarda varios valores en orden. ¿Se os ocurre un ejemplo de la vida real?',
  'Empecemos con una duda: ¿en qué punto exacto se os complica el tema que trae hoy cada uno?',
  'Planteo un reto rápido: voy a explicar algo y vosotros me decís si lo he explicado bien o si falta algo.'
];

const scene = document.querySelector('#practice-scene');
const scenePrompt = document.querySelector('#scene-prompt');
const sceneHint = document.querySelector('#scene-hint');
const statusText = document.querySelector('#scene-status');
const conversationLog = document.querySelector('#conversation-log');
const timer = document.querySelector('#practice-timer');
const feedback = document.querySelector('#practice-feedback');
const startButton = document.querySelector('#start-button');
const pauseButton = document.querySelector('#pause-button');
const finishButton = document.querySelector('#finish-button');
const microphoneButton = document.querySelector('#microphone-button');
const microphoneStatus = document.querySelector('#mic-status');
const tipsButton = document.querySelector('#tips-button');
const toastStack = document.querySelector('#toast-stack');
const shareButton = document.querySelector('#share-button');
const rubricList = document.querySelector('#rubric-list');
const duoLeonardo = document.querySelector('#duo-leonardo');
const duoLuis = document.querySelector('#duo-luis');

let sessionId = null;
let messages = [];
let elapsedSeconds = 0;
let timerInterval = null;
let sessionActive = false;
let sessionPaused = false;
let isStartingSession = false;
let isProcessingAudio = false;
let tipIndex = 0;
let mediaRecorder = null;
let recordingStream = null;
let audioChunks = [];
let isRecording = false;
let recordingPromise = null;

// Recordatorio por silencio: si el profe se queda callado, UNO de los
// alumnos retoma la clase con una frase corta pedida a la IA (/chat/nudge).
const SILENCE_DELAY_MS = 30000;
const MAX_SILENCE_NUDGES = 2;
let silenceTimerId = null;
let consecutiveNudges = 0;
let isRequestingNudge = false;
let silenceNudgeAlumno = 0;

// ============================================================
// Utilidades
// ============================================================
async function requestJson(path, options) {
  let response;
  try {
    response = await fetch(API_BASE + path, options);
  } catch (error) {
    throw new Error('No se pudo conectar con VerbIA. Inicia el servidor con `python server.py` e inténtalo de nuevo.');
  }
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json')
    ? await response.json()
    : { detail: await response.text() };
  if (!response.ok) {
    throw new Error(result.detail || 'El servidor respondió con el error ' + response.status + '.');
  }
  return result;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return minutes + ':' + remainingSeconds;
}

function setFeedback(message, isError) {
  feedback.textContent = message;
  feedback.classList.toggle('is-error', Boolean(isError));
}

function renderRubric(items) {
  if (!rubricList) return;
  rubricList.replaceChildren();
  items.forEach(function (item) {
    const row = document.createElement('li');
    const check = document.createElement('span');
    check.className = 'rubric-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    const copy = document.createElement('span');
    copy.className = 'rubric-copy';
    const title = document.createElement('strong');
    title.textContent = item[0];
    const text = document.createElement('small');
    text.textContent = item[1];
    copy.append(title, text);
    row.append(check, copy);
    rubricList.append(row);
  });
}

function startTimer() {
  window.clearInterval(timerInterval);
  timerInterval = window.setInterval(function () {
    elapsedSeconds += 1;
    timer.textContent = formatTime(elapsedSeconds);
  }, 1000);
}

// ============================================================
// Texto legible (hermano del de practicar.js): el backend puede
// devolver LaTeX/markdown; aquí se convierte a texto para hablar.
// ============================================================
const LATEX_SYMBOLS = {
  cdot: '·', times: '×', div: '÷', pm: '±',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠',
  approx: '≈', equiv: '≡', infty: '∞',
  pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', phi: 'φ', omega: 'ω',
  circ: '°', degree: '°', ldots: '…', dots: '…',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  sum: 'suma', prod: 'producto', int: 'integral'
};

const LATEX_SUPERSCRIPTS = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ', x: 'ˣ', a: 'ᵃ', k: 'ᵏ', m: 'ᵐ'
};

const LATEX_SUBSCRIPTS = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  n: 'ₙ', i: 'ᵢ', x: 'ₓ', a: 'ₐ', k: 'ₖ', m: 'ₘ'
};

function mapScript(value, table, fallbackPrefix) {
  const mapped = value.split('').map(function (char) { return table[char]; });
  return mapped.every(Boolean) ? mapped.join('') : fallbackPrefix + value;
}

function toReadableText(raw) {
  if (raw === null || raw === undefined) return '';
  let text = String(raw);

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p\s*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/\\[\[\]()]/g, '');
  text = text.replace(/\$\$([^$]*)\$\$/g, ' $1 ');
  text = text.replace(/\$([^$]*)\$/g, ' $1 ');

  text = text.replace(/\\(?:frac|dfrac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, function (m, num, den) {
    const simple = /^[\w^{}]+$/.test(num) && /^[\w^{}]+$/.test(den);
    return simple ? num + '/' + den : '(' + num + ')/(' + den + ')';
  });
  text = text.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  text = text.replace(/\\(?:text|textrm|textbf|textit|mathrm|mathbf|operatorname|boxed|mbox)\s*\{([^{}]*)\}/g, '$1');
  text = text.replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, '');
  text = text.replace(/\\(?:left|right|displaystyle|limits|big|Big)/g, '');
  text = text.replace(/\\(?:quad|qquad)/g, ' ');
  text = text.replace(/\\(?:;|,|!|\|)/g, ' ');
  text = text.replace(/~/g, ' ');
  text = text.replace(/\\\\/g, '\n');

  text = text.replace(/\\([A-Za-z]+)/g, function (match, name) {
    return Object.prototype.hasOwnProperty.call(LATEX_SYMBOLS, name) ? LATEX_SYMBOLS[name] : name;
  });
  text = text.replace(/\\([{}&%_$#<>])/g, '$1');
  text = text.replace(/\\ /g, ' ');

  text = text.replace(/\^\{([^{}]*)\}/g, function (m, group) { return mapScript(group, LATEX_SUPERSCRIPTS, '^'); });
  text = text.replace(/\^([0-9A-Za-z+\-=()])/g, function (m, group) { return mapScript(group, LATEX_SUPERSCRIPTS, '^'); });
  text = text.replace(/_\{([^{}]*)\}/g, function (m, group) { return mapScript(group, LATEX_SUBSCRIPTS, '_'); });
  text = text.replace(/_([0-9A-Za-z+\-=()])/g, function (m, group) { return mapScript(group, LATEX_SUBSCRIPTS, '_'); });

  text = text.replace(/```[a-zA-Z]*\n?/g, '');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+)__/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^(\s*)[-+]\s+/gm, '$1• ');
  text = text.replace(/`([^`\n]+)`/g, '$1');
  text = text.replace(/\*/g, '×');

  text = text.replace(/[ \t\u00A0]{2,}/g, ' ');
  text = text.replace(/\s+([.,;:!?])/g, '$1');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ============================================================
// Conversación en pantalla
// ============================================================
function appendConversationMessage(speaker, text, personajeId) {
  const message = document.createElement('article');
  message.className = 'conversation-message';
  if (personajeId) message.dataset.speaker = personajeId;
  const label = document.createElement('strong');
  label.textContent = speaker;
  const content = document.createElement('p');
  content.textContent = toReadableText(text);
  message.append(label, content);
  conversationLog.append(message);
  conversationLog.scrollTop = conversationLog.scrollHeight;
}

function markSpeaker(personajeId) {
  [duoLeonardo, duoLuis].forEach(function (block) {
    if (!block) return;
    block.classList.toggle('is-speaking', Boolean(personajeId) && block.dataset.student === personajeId);
  });
}

// ============================================================
// Voces: cada turno se sintetiza con la voz Fish de SU alumno
// (leonardo / luis) a través de /tts, que ya resuelve el
// reference_id correcto en el backend.
// ============================================================
async function fetchSpeech(text, personajeId) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(function () { controller.abort(); }, 15000);
  try {
    const response = await fetch(API_BASE + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, personaje: personajeId }),
      signal: controller.signal
    });
    if (!response.ok) {
      const result = await response.json().catch(function () { return {}; });
      throw new Error(result.detail || 'La voz del servidor no está disponible.');
    }
    return await response.blob();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function playBlob(blob) {
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  try {
    await new Promise(function (resolve, reject) {
      audio.addEventListener('ended', resolve, { once: true });
      audio.addEventListener('error', reject, { once: true });
      audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}

async function speakWithBrowserVoice(text) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    throw new Error('Este navegador no ofrece voz de lectura de respaldo.');
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-MX';
  const spanishVoice = window.speechSynthesis.getVoices().find(function (voice) {
    return voice.lang.toLowerCase().startsWith('es');
  });
  if (spanishVoice) utterance.voice = spanishVoice;
  await new Promise(function (resolve, reject) {
    utterance.onend = resolve;
    utterance.onerror = reject;
    window.speechSynthesis.speak(utterance);
  });
}

function b64ToBlob(b64, mime) {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'audio/mpeg' });
}

// Descarga los audios de TODOS los turnos en paralelo (una sola
// espera) y luego los reproduce en orden, iluminando al alumno
// que está hablando. Cada texto se muestra justo cuando empieza su audio.
async function speakTurns(turnos) {
  if (!turnos || !turnos.length) return;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();

  const clips = await Promise.all(turnos.map(async function (turno) {
    const texto = toReadableText(turno.texto);
    if (!texto) return null;
    // Si el backend ya incluyó el audio (/aulavoz), usarlo directo.
    if (turno.audio_b64) {
      try {
        return { turno: turno, texto: texto, blob: b64ToBlob(turno.audio_b64, 'audio/mpeg') };
      } catch (error) {
        console.warn('Audio incluido inválido para ' + turno.personaje + ':', error);
      }
    }
    try {
      return { turno: turno, texto: texto, blob: await fetchSpeech(texto, turno.personaje) };
    } catch (error) {
      console.warn('Sin voz Fish para ' + turno.personaje + ', se usará la voz del navegador:', error);
      return { turno: turno, texto: texto, blob: null };
    }
  }));

  for (const clip of clips) {
    if (!clip) continue;
    markSpeaker(clip.turno.personaje);
    appendConversationMessage(clip.turno.nombre, clip.texto, clip.turno.personaje);
    messages.push({ role: 'assistant', content: clip.turno.nombre + ': ' + clip.texto });
    if (clip.blob) {
      try {
        await playBlob(clip.blob);
        continue;
      } catch (error) {
        console.warn('No se pudo reproducir el audio de ' + clip.turno.nombre + ':', error);
      }
    }
    try {
      await speakWithBrowserVoice(clip.texto);
    } catch (error) {
      console.warn('No se pudo leer el turno de ' + clip.turno.nombre + ':', error);
    }
  }
  markSpeaker(null);
}

// ============================================================
// Silencio del profe: un alumno retoma la conversación
// ============================================================
function stopSilenceTimer() {
  window.clearTimeout(silenceTimerId);
  silenceTimerId = null;
}

// Tras SILENCE_DELAY_MS sin respuesta, la IA manda una frase corta de UNO de
// los alumnos (/chat/nudge). Máximo MAX_SILENCE_NUDGES avisos seguidos; en
// cuanto el profe habla, el contador se reinicia.
function resetSilenceTimer() {
  stopSilenceTimer();
  if (!sessionActive || sessionPaused || consecutiveNudges >= MAX_SILENCE_NUDGES) return;
  silenceTimerId = window.setTimeout(handleSilence, SILENCE_DELAY_MS);
}

async function requestSilenceNudge() {
  // Alternamos el alumno que retoma para que no suene siempre la misma voz.
  const alumnos = ['leonardo', 'luis'];
  const alumnoId = alumnos[silenceNudgeAlumno % alumnos.length];
  silenceNudgeAlumno += 1;
  const alumno = ALUMNOS[alumnoId];
  const result = await requestJson('/chat/nudge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personaje: alumno.backendId,
      historial: messages,
      personaje_nombre: alumno.name,
      tema: 'Simulacion de aula con dos alumnos'
    })
  });
  const line = toReadableText((result.respuesta || '').trim());
  if (!line) throw new Error('El alumno no mandó ningún recordatorio.');
  consecutiveNudges += 1;
  setFeedback(alumno.name + ' retoma la clase mientras piensas.', false);
  await speakTurns([{ personaje: alumnoId, nombre: alumno.name, texto: line }]);
}

function handleSilence() {
  silenceTimerId = null;
  if (!sessionActive || sessionPaused) return;
  if (isRecording || isProcessingAudio || isStartingSession || isRequestingNudge) {
    resetSilenceTimer();
    return;
  }
  isRequestingNudge = true;
  requestSilenceNudge()
    .catch(function (error) {
      console.warn('No se pudo pedir el recordatorio de silencio:', error);
    })
    .finally(function () {
      isRequestingNudge = false;
      resetSilenceTimer();
    });
}

// ============================================================
// Sesión de simulación
// ============================================================
async function beginPractice() {
  if (sessionActive || isStartingSession) return;
  isStartingSession = true;
  startButton.disabled = true;
  sessionId = null;
  messages = [];
  elapsedSeconds = 0;
  timer.textContent = '00:00';
  conversationLog.replaceChildren();
  markSpeaker(null);

  try {
    const result = await requestJson('/sesiones/iniciar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personaje_id: 'aula',
        personaje_nombre: 'Leonardo & Luis'
      })
    });
    if (!result.sesion_id) throw new Error('El servidor no devolvió un identificador para esta sesión.');
    sessionId = result.sesion_id;
  } catch (error) {
    setFeedback(error.message + ' La simulación continuará y se guardará en este navegador.', true);
  }

  sessionActive = true;
  sessionPaused = false;
  scene.dataset.state = 'active';
  statusText.textContent = 'Simulación en curso';
  scenePrompt.textContent = 'Los alumnos quieren saber qué tema verán hoy. Dilo y explícales un poco.';
  sceneHint.textContent = 'Primero di el tema y explícalo; después resuelve sus dudas y pasad al ejercicio.';
  startButton.classList.add('is-hidden');
  startButton.disabled = false;
  pauseButton.disabled = false;
  finishButton.disabled = false;
  microphoneButton.disabled = false;
  startTimer();
  isStartingSession = false;
  consecutiveNudges = 0;
  if (sessionId) setFeedback('Simulación iniciada con Leonardo y Luis.', false);

  // Saludo inicial: cada alumno habla con su propia voz Fish.
  try {
    setFeedback('Leonardo y Luis saludan…', false);
    await speakTurns(TURNO_INICIAL);
    setFeedback('Los alumnos ya saben el tema de hoy. Escucha sus dudas y luego dad al ejercicio.', false);
  } catch (error) {
    setFeedback(error.message, true);
  }
  resetSilenceTimer();
}

function restoreControlsAfterProcessing() {
  isProcessingAudio = false;
  microphoneButton.disabled = !sessionActive || sessionPaused;
  microphoneStatus.textContent = 'Micrófono apagado';
  pauseButton.disabled = !sessionActive;
  finishButton.disabled = !sessionActive;
  scene.dataset.state = sessionPaused ? 'paused' : (sessionActive ? 'active' : 'ready');
  statusText.textContent = sessionPaused
    ? 'Simulación en pausa'
    : (sessionActive ? 'Simulación en curso' : 'Aula lista');
  if (sessionActive) {
    consecutiveNudges = 0;
    resetSilenceTimer();
  }
}

async function processRecordedAudio(blob) {
  if (blob.size < 1024) {
    setFeedback('La grabación fue muy corta. Habla un poco más antes de enviarla.', true);
    restoreControlsAfterProcessing();
    return;
  }

  isProcessingAudio = true;
  microphoneButton.disabled = true;
  pauseButton.disabled = true;
  finishButton.disabled = true;
  scene.dataset.state = 'processing';
  statusText.textContent = 'Procesando voz';
  setFeedback('Enviando la grabación al servicio de transcripción…', false);

  const formData = new FormData();
  formData.append('audio', blob, 'simulacion.webm');
  // /stt valida el personaje: usamos "leonardo" (solo cambia el idioma del Whisper).
  formData.append('personaje', 'leonardo');

  try {
    const transcription = await requestJson('/stt', { method: 'POST', body: formData });
    const userText = (transcription.texto || '').trim();
    if (!userText) {
      throw new Error('No se reconocieron palabras. Intenta hablar más cerca del micrófono.');
    }
    appendConversationMessage('Tú (profesor)', userText);
    messages.push({ role: 'user', content: userText });

    setFeedback('Leonardo y Luis están pensando…', false);
    let result = null;
    try {
      result = await requestJson('/aulavoz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaje_a: 'leonardo',
          personaje_b: 'luis',
          mensaje: userText,
          historial: messages.slice(0, -1),
          sesion_id: sessionId,
          tema: 'Simulacion de aula con dos alumnos'
        })
      });
    } catch (e1) {
      result = await requestJson('/chat/aula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaje_a: 'leonardo',
          personaje_b: 'luis',
          mensaje: userText,
          historial: messages.slice(0, -1),
          sesion_id: sessionId,
          tema: 'Simulacion de aula con dos alumnos'
        })
      });
    }
    const turnos = Array.isArray(result.turnos) ? result.turnos : [];
    if (!turnos.length) throw new Error('Los alumnos no respondieron. Inténtalo de nuevo.');

    scenePrompt.textContent = 'Los alumnos están reaccionando a tu clase.';
    sceneHint.textContent = 'Escucha sus dudas y respóndeles con el micrófono.';
    setFeedback('Responden tus alumnos…', false);
    await speakTurns(turnos);
    setFeedback('Turno de tus alumnos terminado. Ahora te toca a ti.', false);
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    restoreControlsAfterProcessing();
  }
}

// ============================================================
// Micrófono (push-to-talk: pulsar para grabar, otra vez para enviar)
// ============================================================
async function startRecording() {
  if (!sessionActive || sessionPaused || isRecording || isProcessingAudio) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    setFeedback('Este navegador no permite grabar audio aquí. Abre la página desde http://127.0.0.1:8000 y usa un navegador compatible.', true);
    return;
  }

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!sessionActive) {
      recordingStream.getTracks().forEach(function (track) { track.stop(); });
      recordingStream = null;
      return;
    }
    audioChunks = [];
    const supportedMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = supportedMimeTypes.find(function (type) {
      return MediaRecorder.isTypeSupported(type);
    });
    mediaRecorder = mimeType
      ? new MediaRecorder(recordingStream, { mimeType: mimeType })
      : new MediaRecorder(recordingStream);

    mediaRecorder.addEventListener('dataavailable', function (event) {
      if (event.data.size > 0) audioChunks.push(event.data);
    });
    recordingPromise = new Promise(function (resolve) {
      mediaRecorder.addEventListener('stop', async function () {
        recordingStream.getTracks().forEach(function (track) { track.stop(); });
        recordingStream = null;
        isRecording = false;
        microphoneButton.classList.remove('is-on');
        microphoneButton.setAttribute('aria-label', 'Grabar y enviar voz');
        microphoneButton.title = 'Grabar y enviar voz';
        microphoneStatus.textContent = 'Procesando audio';
        const recordedAudio = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        try {
          await processRecordedAudio(recordedAudio);
        } finally {
          resolve();
          recordingPromise = null;
        }
      }, { once: true });
    });

    mediaRecorder.start();
    isRecording = true;
    finishButton.disabled = true;
    pauseButton.disabled = true;
    microphoneButton.classList.add('is-on');
    microphoneButton.setAttribute('aria-label', 'Detener grabación y enviar');
    microphoneButton.title = 'Detener grabación y enviar';
    microphoneStatus.textContent = 'Grabando · pulsa para enviar';
    scene.dataset.state = 'recording';
    statusText.textContent = 'Te estamos escuchando';
    sceneHint.textContent = 'Pulsa el micrófono otra vez cuando termines de hablar.';
    setFeedback('Grabando. Al pulsar de nuevo, el audio se enviará a transcripción.', false);
  } catch (error) {
    if (recordingStream) {
      recordingStream.getTracks().forEach(function (track) { track.stop(); });
      recordingStream = null;
    }
    setFeedback(error.name === 'NotAllowedError'
      ? 'No se concedió permiso para el micrófono. Revisa los permisos del navegador.'
      : 'No se pudo iniciar la grabación. Comprueba tu micrófono e inténtalo de nuevo.', true);
  }
}

async function stopRecording() {
  if (!isRecording || !mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
  if (recordingPromise) await recordingPromise;
}

async function toggleMicrophone() {
  if (isRecording) {
    await stopRecording();
    return;
  }
  await startRecording();
}

function togglePause() {
  if (!sessionActive || isRecording || isProcessingAudio) return;
  sessionPaused = !sessionPaused;
  pauseButton.classList.toggle('is-paused', sessionPaused);
  pauseButton.setAttribute('aria-label', sessionPaused ? 'Reanudar simulación' : 'Pausar simulación');
  if (sessionPaused) {
    window.clearInterval(timerInterval);
    stopSilenceTimer();
    scene.dataset.state = 'paused';
    statusText.textContent = 'Simulación en pausa';
    sceneHint.textContent = 'Tómate un momento. Reanuda cuando estés listo.';
    microphoneButton.disabled = true;
  } else {
    scene.dataset.state = 'active';
    statusText.textContent = 'Simulación en curso';
    sceneHint.textContent = 'Pulsa el micrófono, habla y púlsalo otra vez para enviar tu explicación.';
    microphoneButton.disabled = false;
    startTimer();
    resetSilenceTimer();
  }
}

// ============================================================
// Finalizar y guardar
// ============================================================
async function saveSessionLocally() {
  const response = await fetch(API_BASE + '/auth/me', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const account = await response.json();
  if (!response.ok || !account.authenticated || typeof account.id !== 'string') {
    throw new Error('No se pudo verificar tu cuenta para guardar la sesión localmente.');
  }

  const storedSessions = JSON.parse(localStorage.getItem(LOCAL_SESSIONS_KEY) || '[]');
  if (!Array.isArray(storedSessions)) {
    throw new Error('El historial local está dañado y no se puede actualizar.');
  }
  storedSessions.push({
    user_id: account.id,
    personaje_id: 'aula',
    personaje_nombre: 'Leonardo & Luis',
    fecha_inicio: new Date(Date.now() - elapsedSeconds * 1000).toISOString(),
    fecha_fin: new Date().toISOString(),
    duracion_segundos: elapsedSeconds,
    mensajes: messages
  });
  localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(storedSessions));
}

async function finishPractice() {
  if (!sessionActive || isRecording || isProcessingAudio) return;
  startButton.disabled = true;
  window.clearInterval(timerInterval);
  stopSilenceTimer();
  sessionActive = false;
  sessionPaused = false;
  markSpeaker(null);
  scene.dataset.state = 'ready';
  statusText.textContent = 'Simulación finalizada';
  scenePrompt.textContent = '¡Buen trabajo, profe! Gracias por la clase de hoy.';
  sceneHint.textContent = 'Puedes volver a empezar la simulación cuando quieras.';
  startButton.classList.remove('is-hidden');
  startButton.querySelector('span').textContent = 'Simular de nuevo';
  startButton.disabled = false;
  pauseButton.disabled = true;
  pauseButton.classList.remove('is-paused');
  pauseButton.setAttribute('aria-label', 'Pausar simulación');
  finishButton.disabled = true;
  microphoneButton.disabled = true;
  setFeedback('Guardando tu sesión y generando el análisis…', false);

  let savedRemotely = false;
  if (sessionId) {
    try {
      await requestJson('/sesiones/' + encodeURIComponent(sessionId) + '/finalizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sesion_id: sessionId,
          duracion_segundos: elapsedSeconds,
          mensajes: messages
        })
      });
      savedRemotely = true;
    } catch (error) {
      setFeedback(error.message + ' Se intentará guardar una copia local.', true);
    }
  }
  if (!savedRemotely) {
    try {
      await saveSessionLocally();
      setFeedback('Simulación finalizada en ' + formatTime(elapsedSeconds) + '. Se guardó en este navegador.', false);
    } catch (error) {
      setFeedback('La simulación terminó, pero no se pudo guardar: ' + error.message, true);
    }
  } else {
    setFeedback('Simulación finalizada en ' + formatTime(elapsedSeconds) + '. Análisis guardado: verás el detalle en 3 segundos…', false);
  }
  const finishedSessionId = sessionId;
  sessionId = null;
  if (savedRemotely && finishedSessionId) {
    window.setTimeout(function () {
      window.location.href = 'analisis.html?sesion=' + encodeURIComponent(finishedSessionId);
    }, 3000);
  }
}

function showTip(title, message) {
  if (!toastStack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const head = document.createElement('strong');
  head.textContent = 'Consejo ? ' + title;
  const body = document.createElement('span');
  body.textContent = message;
  toast.append(head, body);
  toastStack.append(toast);
  window.setTimeout(function () {
    toast.classList.add('is-out');
    window.setTimeout(function () { toast.remove(); }, 260);
  }, 5200);
  while (toastStack.children.length > 3) toastStack.firstElementChild.remove();
}

// ============================================================
// Botones y arranque
// ============================================================
startButton.addEventListener('click', beginPractice);
pauseButton.addEventListener('click', togglePause);
finishButton.addEventListener('click', finishPractice);
microphoneButton.addEventListener('click', toggleMicrophone);
tipsButton.addEventListener('click', function () {
  const tip = TIPS_SIMULACION[tipIndex % TIPS_SIMULACION.length];
  tipIndex += 1;
  showTip('Aula doble', tip);
});

shareButton.addEventListener('click', async function () {
  try {
    await navigator.clipboard.writeText(window.location.href);
    setFeedback('Enlace de esta simulación copiado.', false);
  } catch (error) {
    setFeedback('No se pudo copiar automáticamente. Copia el enlace desde la barra del navegador.', true);
  }
});
window.addEventListener('pagehide', function () {
  window.clearInterval(timerInterval);
  stopSilenceTimer();
  if (recordingStream) recordingStream.getTracks().forEach(function (track) { track.stop(); });
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
});

renderRubric(RUBRICA);
startButton.disabled = true;
requestJson('/health')
  .then(function (health) {
    const remoteIds = Array.isArray(health.personajes) ? health.personajes : [];
    const backendOk = remoteIds.includes('leonardo') || remoteIds.includes('luis') || remoteIds.length === 0;
    if (!backendOk) {
      setFeedback('El servidor activo no reconoce a los alumnos del aula. Detén y vuelve a iniciar `python server.py`; después, recarga esta página.', true);
      return;
    }
    startButton.disabled = false;
    const services = health.servicios || {};
    const missing = [];
    if (!services.conversacion_y_transcripcion) missing.push('GROQ_API_KEY');
    if (!services.voz_fish) missing.push('FISH_API_KEY');
    if (!services.sesiones_remotas) missing.push('DATABASE_URL');
    if (missing.length) {
      setFeedback('Servidor conectado. Configura ' + missing.join(' y ') + ' para habilitar la simulación completa.', true);
    } else {
      setFeedback('Servidor, voces Fish y transcripción conectados. Pulsa “Empezar simulación”.', false);
    }
  })
  .catch(function (error) {
    startButton.disabled = false;
    setFeedback(error.message, true);
  });











