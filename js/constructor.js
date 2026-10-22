'use strict';

const form = document.querySelector('#character-form');
const nameInput = document.querySelector('#character-name');
const topicInput = document.querySelector('#character-tema');
const descriptionInput = document.querySelector('#character-description');
const imageInput = document.querySelector('#character-image');
const voiceSelect = document.querySelector('#voice-select');
const previewImage = document.querySelector('#preview-image');
const previewPlaceholder = document.querySelector('#preview-placeholder');
const previewName = document.querySelector('#preview-name');
const previewDescription = document.querySelector('#preview-description');
const previewVoiceTag = document.querySelector('#preview-voice-tag');
const guide = document.querySelector('#verbo-tip');
const formMessage = document.querySelector('#form-message');
const voiceStatus = document.querySelector('#voice-status');
const imageStatus = document.querySelector('#image-status');
const guideStepNumber = document.querySelector('#guide-step-number');
const savedGrid = document.querySelector('#saved-grid');
const savedEmpty = document.querySelector('#saved-empty');
const playVoiceButton = document.querySelector('#play-voice');
const stopVoiceButton = document.querySelector('#stop-voice');
const storageKey = 'verbia-custom-characters';
const maximumImageBytes = 700 * 1024;
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : window.location.origin;

let currentImageData = '';
let availableVoices = [];
let serverVoices = [];
let serverMode = true;
let editingId = null;
let previewAudio = null;

function updateCounter(input, counter, limit) {
  counter.textContent = input.value.length + ' / ' + limit;
}

function setGuide(message, currentStep) {
  guide.textContent = message;
  const progressItems = Array.from(document.querySelectorAll('[data-guide-step]'));
  const currentIndex = progressItems.findIndex(function (item) {
    return item.dataset.guideStep === currentStep;
  });

  if (currentStep === 'done') {
    guideStepNumber.textContent = '¡LISTO!';
  } else {
    guideStepNumber.textContent = 'PASO ' + String(Math.max(currentIndex + 1, 1)).padStart(2, '0') + ' / 04';
  }

  progressItems.forEach(function (item, index) {
    item.classList.toggle('is-complete', currentStep === 'done' || index < currentIndex);
    if (item.dataset.guideStep === currentStep) {
      item.setAttribute('aria-current', 'step');
    } else {
      item.removeAttribute('aria-current');
    }
  });

  document.querySelectorAll('.builder-step').forEach(function (step) {
    step.classList.toggle('is-current', step.dataset.guide === currentStep);
  });
}

function updatePreview() {
  previewName.textContent = nameInput.value.trim() || 'Tu personaje';
  previewDescription.textContent = descriptionInput.value.trim() || 'Aquí aparecerá la descripción de tu personaje cuando la escribas.';
  previewVoiceTag.textContent = voiceLabel(voiceSelect.value);
}

function voiceLabel(id) {
  const found = serverVoices.find(function (v) { return v.id === id; });
  if (found) return found.nombre;
  const opt = voiceSelect.querySelector('option[value="' + id + '"]');
  return opt ? opt.textContent.trim() : 'Voz por elegir';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

async function apiJson(path, options) {
  const response = await fetch(API_BASE + path, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : { detail: await response.text() };
  if (!response.ok) throw new Error(data.detail || ('Error ' + response.status));
  return data;
}

function showFormMessage(message, isError) {
  formMessage.textContent = message;
  formMessage.classList.toggle('is-error', Boolean(isError));
}

function setImage(dataUrl, fileName) {
  currentImageData = dataUrl;
  if (dataUrl) {
    previewImage.src = dataUrl;
    previewImage.hidden = false;
    previewPlaceholder.hidden = true;
    imageStatus.textContent = fileName + ' lista para la vista previa.';
  } else {
    previewImage.removeAttribute('src');
    previewImage.hidden = true;
    previewPlaceholder.hidden = false;
    imageStatus.textContent = 'La imagen es opcional.';
  }
}

function readLocalCharacters() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) { return []; }
}

async function fetchServerCharacters() {
  const data = await apiJson('/api/personajes');
  return Array.isArray(data.personajes) ? data.personajes : [];
}

function paintCards(list, isServer) {
  savedGrid.replaceChildren();
  savedEmpty.hidden = list.length > 0;
  if (!list.length) return;
  list.forEach(function (character, index) {
    const nombre = character.nombre || character.name || 'Sin nombre';
    const descripcion = character.descripcion || character.description || '';
    const tema = character.tema || '';
    const imagen = character.imagen_data || character.image || '';
    const vozId = character.voice_id || character.voice || 'fish-luis';
    const card = document.createElement('article');
    card.className = 'saved-card';
    const imgHtml = imagen
      ? '<img src="' + escapeHtml(imagen) + '" alt="Retrato" loading="lazy" />'
      : '<span aria-hidden="true">✳</span>';
    card.innerHTML = '<div class="saved-card-image">' + imgHtml + '</div>' +
      '<div class="saved-card-copy"><h3>' + escapeHtml(nombre) + '</h3><p>' +
      escapeHtml(descripcion || 'Sin descripción.') + '</p>' +
      '<span class="saved-card-voice">' + escapeHtml(voiceLabel(vozId)) + '</span>' +
      '<div class="saved-card-actions"><button type="button" data-a="p">Practicar →</button>' +
      '<button type="button" data-a="e">Editar</button>' +
      '<button type="button" data-a="d">Eliminar</button></div></div>';
    card.querySelector('[data-a="p"]').addEventListener('click', function () {
      if (isServer && character.id) {
        window.location.href = 'practicar.html?personaje=custom-' + encodeURIComponent(character.id);
      } else {
        try {
          sessionStorage.setItem('verbia-custom-draft', JSON.stringify({ nombre: nombre, descripcion: descripcion, tema: tema, voice_id: vozId, imagen_data: imagen }));
        } catch (e) {}
        window.location.href = 'practicar.html?personaje=custom-local';
      }
    });
    card.querySelector('[data-a="e"]').addEventListener('click', function () {
      nameInput.value = nombre; descriptionInput.value = descripcion; topicInput.value = tema;
      if (voiceSelect.querySelector('option[value="' + vozId + '"]')) voiceSelect.value = vozId;
      setImage(imagen, nombre);
      editingId = (isServer && character.id) ? character.id : ('local:' + index);
      updateCounter(nameInput, document.querySelector('#name-count'), 40);
      updateCounter(descriptionInput, document.querySelector('#description-count'), 600);
      updateCounter(topicInput, document.querySelector('#topic-count'), 80);
      updatePreview();
      showFormMessage('Editando "' + nombre + '". Guarda para aplicar.', false);
      document.querySelector('#crear-personaje').scrollIntoView({ behavior: 'smooth' });
    });
    card.querySelector('[data-a="d"]').addEventListener('click', async function () {
      if (!window.confirm('¿Eliminar a "' + nombre + '"?')) return;
      try {
        if (isServer && character.id) {
          await apiJson('/api/personajes/' + encodeURIComponent(character.id), { method: 'DELETE' });
        } else {
          const locals = readLocalCharacters(); locals.splice(index, 1);
          localStorage.setItem(storageKey, JSON.stringify(locals));
          // Si era el personaje en borrador de Practicar, lo borramos también
          // para que no siga cargándose tras eliminarlo.
          try {
            const draftRaw = sessionStorage.getItem('verbia-custom-draft') || localStorage.getItem('verbia-custom-draft');
            const draft = draftRaw ? JSON.parse(draftRaw) : null;
            if (draft && draft.nombre === nombre) {
              sessionStorage.removeItem('verbia-custom-draft');
              localStorage.removeItem('verbia-custom-draft');
            }
          } catch (e) {}
        }
        await renderCharacters();
        showFormMessage('Personaje eliminado.', false);
      } catch (err) { showFormMessage('No se pudo eliminar: ' + err.message, true); }
    });
    savedGrid.append(card);
  });
}

async function renderCharacters() {
  try {
    const serverList = await fetchServerCharacters();
    serverMode = true;
    paintCards(serverList, true);
  } catch (error) {
    serverMode = false;
    paintCards(readLocalCharacters(), false);
  }
}

async function loadServerVoices() {
  const data = await apiJson('/api/voces');
  serverVoices = Array.isArray(data.voces) ? data.voces : [];
  if (!serverVoices.length) throw new Error('sin voces');
  voiceSelect.replaceChildren();
  serverVoices.forEach(function (v) {
    const o = document.createElement('option'); o.value = v.id; o.textContent = v.nombre;
    voiceSelect.append(o);
  });
  serverMode = true;
  voiceStatus.textContent = 'Voces reales de VerbIA listas. Pulsa Probar para escuchar.';
  updatePreview();
}

function loadBrowserVoices() {
  if (!('speechSynthesis' in window)) {
    voiceSelect.innerHTML = '<option value="">Prueba de voz no disponible</option>';
    voiceStatus.textContent = 'Sin servidor ni voces del navegador.';
    return;
  }

  availableVoices = window.speechSynthesis.getVoices();
  const previousVoice = voiceSelect.value;
  voiceSelect.replaceChildren();

  const spanishVoices = availableVoices.filter(function (voice) {
    return voice.lang.toLowerCase().startsWith('es');
  });
  const choices = spanishVoices.length ? spanishVoices : availableVoices;

  if (!choices.length) {
    voiceSelect.add(new Option('No hay voces instaladas', ''));
    voiceSelect.disabled = true;
    playVoiceButton.disabled = true;
    voiceStatus.textContent = 'No encontramos voces disponibles. Instala una voz en español en tu dispositivo para probarla.';
    return;
  }

  choices.forEach(function (voice) {
    voiceSelect.add(new Option(voice.name + ' — ' + voice.lang, voice.name));
  });
  voiceSelect.disabled = false;
  playVoiceButton.disabled = false;
  if (choices.some(function (voice) { return voice.name === previousVoice; })) {
    voiceSelect.value = previousVoice;
  }
  voiceStatus.textContent = spanishVoices.length
    ? 'Elige una voz en español y escúchala antes de guardar.'
    : 'No hay voces en español instaladas; puedes probar las voces disponibles.';
  updatePreview();
}

nameInput.addEventListener('input', function () {
  updateCounter(nameInput, document.querySelector('#name-count'), 40);
  updatePreview();
  showFormMessage('', false);
});
descriptionInput.addEventListener('input', function () {
  updateCounter(descriptionInput, document.querySelector('#description-count'), 600);
  updatePreview();
  showFormMessage('', false);
});
topicInput.addEventListener('input', function () {
  updateCounter(topicInput, document.querySelector('#topic-count'), 80);
  showFormMessage('', false);
});

document.querySelectorAll('.builder-step').forEach(function (step) {
  step.addEventListener('focusin', function () {
    const guidance = {
      name: 'Primero el nombre. Piensa en quién será tu personaje.',
      description: 'Describe qué papel tendrá, qué hablará y cómo quieres que te responda.',
      image: 'Ahora dale una cara. Puedes subir una imagen o dejar la tarjeta sin foto.',
      voice: '¡Ya casi! Escucha las voces disponibles y elige la que mejor le quede.'
    };
    setGuide(guidance[step.dataset.guide], step.dataset.guide);
  });
});

imageInput.addEventListener('change', function () {
  const file = imageInput.files[0];
  if (!file) {
    setImage('', '');
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    imageInput.value = '';
    imageStatus.textContent = 'Ese formato no es compatible. Elige JPG, PNG o WebP.';
    showFormMessage('No pudimos usar esa imagen. Selecciona JPG, PNG o WebP.', true);
    return;
  }
  if (file.size > maximumImageBytes) {
    imageInput.value = '';
    imageStatus.textContent = 'La imagen supera el límite de 1 MB.';
    showFormMessage('Elige una imagen de 1 MB o menos.', true);
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', function () {
    if (typeof reader.result !== 'string') {
      imageStatus.textContent = 'No se pudo leer la imagen. Prueba con otro archivo.';
      showFormMessage('No pudimos leer la imagen seleccionada.', true);
      return;
    }
    setImage(reader.result, file.name);
    showFormMessage('', false);
  });
  reader.addEventListener('error', function () {
    imageStatus.textContent = 'No se pudo leer la imagen. Prueba con otro archivo.';
    showFormMessage('No pudimos leer la imagen seleccionada.', true);
  });
  reader.readAsDataURL(file);
});

voiceSelect.addEventListener('change', updatePreview);

playVoiceButton.addEventListener('click', async function () {
  if (serverMode && serverVoices.length) {
    // Voz real Fish Audio vía /tts.
    const nombre = nameInput.value.trim() || 'tu personaje';
    voiceStatus.textContent = 'Generando muestra de voz…';
    playVoiceButton.disabled = true; stopVoiceButton.disabled = false;
    try {
      const response = await fetch(API_BASE + '/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hola, soy ' + nombre + '. Estoy listo para conversar contigo.',
          personaje: 'custom-local', voz: voiceSelect.value || 'fish-luis', personaje_nombre: nombre
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error('Voz no disponible: ' + (response.status === 503 ? 'Falta FISH_API_KEY en el servidor' : errorText || 'Error ' + response.status));
      }
      const url = URL.createObjectURL(await response.blob());
      if (previewAudio) previewAudio.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      previewAudio = new Audio(url);
      previewAudio.onended = function () {
        URL.revokeObjectURL(url);
        voiceStatus.textContent = '¿Te gusta cómo suena? Puedes probar otra voz.';
        playVoiceButton.disabled = false; stopVoiceButton.disabled = true;
      };
      await previewAudio.play();
      voiceStatus.textContent = 'Reproduciendo la muestra de voz…';
      setGuide('Escucha cómo suena. Si te gusta, ya puedes guardar tu personaje.', 'voice');
    } catch (err) {
      voiceStatus.textContent = err.message || 'No se pudo generar la voz. Intenta de nuevo.';
      playVoiceButton.disabled = false; stopVoiceButton.disabled = true;
    }
    return;
  }
  // Modo navegador (speechSynthesis)
  if (!availableVoices.length || !voiceSelect.value) {
    voiceStatus.textContent = 'Selecciona una voz disponible para escuchar la prueba.';
    return;
  }
  window.speechSynthesis.cancel();
  const characterName = nameInput.value.trim() || 'tu personaje';
  const utterance = new SpeechSynthesisUtterance('Hola, soy ' + characterName + '. Estoy listo para conversar contigo.');
  // La siguiente línea queda por si acaso, no se ejecuta
  utterance.voice = null;
  utterance.lang = 'es';
  utterance.onstart = function () {
    voiceStatus.textContent = 'Reproduciendo la muestra de voz…';
    playVoiceButton.disabled = true;
    stopVoiceButton.disabled = false;
    setGuide('Escucha cómo suena. Si te gusta, ya puedes guardar tu personaje.', 'voice');
  };
  utterance.onend = function () {
    voiceStatus.textContent = '¿Te gusta cómo suena? Puedes probar otra voz.';
    playVoiceButton.disabled = false;
    stopVoiceButton.disabled = true;
  };
  utterance.onerror = function (event) {
    voiceStatus.textContent = 'No se pudo reproducir la voz (' + event.error + '). Intenta con otra voz o navegador.';
    playVoiceButton.disabled = false;
    stopVoiceButton.disabled = true;
  };
  window.speechSynthesis.speak(utterance);
});

stopVoiceButton.addEventListener('click', function () {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  playVoiceButton.disabled = false;
  stopVoiceButton.disabled = true;
  voiceStatus.textContent = 'Prueba detenida. Puedes elegir otra voz.';
});

form.addEventListener('submit', async function (event) {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const nombre = nameInput.value.trim();
  const descripcion = descriptionInput.value.trim();
  const tema = topicInput.value.trim();
  if (!nombre || !descripcion) {
    showFormMessage('Añade un nombre y una descripción antes de guardar.', true);
    return;
  }
  const voiceId = voiceSelect.value || 'fish-luis';
  const payload = { nombre: nombre, descripcion: descripcion, tema: tema, imagen_data: currentImageData || null, voice_id: voiceId };

  // Intento 1: servidor (PUT si edita, POST si crea).
  try {
    if (editingId && !String(editingId).startsWith('local:')) {
      await apiJson('/api/personajes/' + encodeURIComponent(editingId), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
    } else if (editingId && String(editingId).startsWith('local:')) {
      const idx = parseInt(String(editingId).split(':')[1], 10);
      const locals = readLocalCharacters();
      const item = { nombre: nombre, descripcion: descripcion, tema: tema, imagen_data: currentImageData, voice_id: voiceId };
      if (!Number.isNaN(idx) && locals[idx]) locals[idx] = item; else locals.push(item);
      localStorage.setItem(storageKey, JSON.stringify(locals));
    } else {
      await apiJson('/api/personajes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
    }
    editingId = null;
    await renderCharacters();
    showFormMessage('¡Personaje guardado! Pulsa “Practicar” en su tarjeta para hablar con él.', false);
    setGuide('¡Lo lograste! Tu personaje está guardado.', 'done');
  } catch (error) {
    // Intento 2: localStorage (sin servidor).
    try {
      const item = { nombre: nombre, descripcion: descripcion, tema: tema, imagen_data: currentImageData, voice_id: voiceId };
      const locals = readLocalCharacters();
      if (editingId && String(editingId).startsWith('local:')) {
        const idx = parseInt(String(editingId).split(':')[1], 10);
        if (!Number.isNaN(idx) && locals[idx]) locals[idx] = item; else locals.push(item);
      } else { locals.push(item); }
      localStorage.setItem(storageKey, JSON.stringify(locals));
      editingId = null;
      serverMode = false;
      paintCards(locals, false);
      showFormMessage('Guardado en este navegador (sin servidor).', false);
      setGuide('¡Lo lograste! Tu personaje está guardado en este dispositivo.', 'done');
    } catch (storageError) {
      showFormMessage('No se pudo guardar. Revisa el espacio del navegador.', true);
      return;
    }
  }

  form.reset();
  currentImageData = '';
  setImage('', '');
  updateCounter(nameInput, document.querySelector('#name-count'), 40);
  updateCounter(descriptionInput, document.querySelector('#description-count'), 600);
  updateCounter(topicInput, document.querySelector('#topic-count'), 80);
  updatePreview();
});

(async function init() {
  updateCounter(nameInput, document.querySelector('#name-count'), 40);
  updateCounter(descriptionInput, document.querySelector('#description-count'), 600);
  updateCounter(topicInput, document.querySelector('#topic-count'), 80);
  updatePreview();
  setGuide('¡Hola! Soy Verbo. Primero, pensemos un nombre para tu personaje.', 'name');
  try { await loadServerVoices(); }
  catch (error) {
    serverMode = false;
    loadBrowserVoices();
    if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', loadBrowserVoices);
  }
  await renderCharacters();
})();
