'use strict';

const authStatus = document.querySelector('#auth-status');
const authTitle = document.querySelector('#auth-title');
const authDescription = document.querySelector('#auth-description');
const authEyebrow = document.querySelector('#auth-eyebrow');
const googlePanel = document.querySelector('#google-panel');
const googleButton = document.querySelector('#google-button');
const googleButtonWrap = document.querySelector('#google-button-wrap');
const googlePlaceholder = document.querySelector('#google-placeholder');
const googlePlaceholderLabel = document.querySelector('#google-placeholder-label');
const setupNotice = document.querySelector('#setup-notice');
const signedInPanel = document.querySelector('#signed-in-panel');
const signedInName = document.querySelector('#signed-in-name');
const logoutButton = document.querySelector('#logout-button');
const greeting = document.querySelector('#verbo-greeting');
const nextPath = getSafeNextPath();

let authMode = 'login';
let authConfig = null;
let googleScriptLoading = false;
let googleInitialized = false;

function getSafeNextPath() {
  const requested = new URLSearchParams(window.location.search).get('next');
  if (!requested || !requested.startsWith('/') || requested.startsWith('//') || requested.includes('\\')) {
    return '/';
  }

  try {
    const target = new URL(requested, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname === '/login' || target.pathname.startsWith('/auth/')) {
      return '/';
    }
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}

function showStatus(message, isError) {
  authStatus.textContent = message || '';
  authStatus.classList.toggle('is-error', Boolean(isError));
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  document.querySelectorAll('.auth-tab').forEach(function (tab) {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  googlePanel.setAttribute('aria-labelledby', isRegister ? 'tab-register' : 'tab-login');
  authEyebrow.textContent = isRegister ? 'EMPIEZA GRATIS' : 'QUÉ BUENO VERTE';
  authTitle.innerHTML = isRegister
    ? 'Tu próximo paso<br><em>empieza aquí.</em>'
    : 'Tu voz tiene<br><em>un lugar aquí.</em>';
  authDescription.textContent = isRegister
    ? 'Crea tu cuenta gratis y empieza a practicar con VerbIA.'
    : 'Entra a tu cuenta y continúa donde lo dejaste.';
  googlePlaceholderLabel.textContent = isRegister ? 'Registrarme con Google' : 'Continuar con Google';
  showStatus('', false);
  renderGoogleButton();
}

async function fetchAuthConfig() {
  const response = await fetch('/auth/google/config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('No pudimos preparar el acceso seguro. Inténtalo de nuevo.');
  return response.json();
}

function loadGoogleScript() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    initializeGoogle();
    return;
  }
  if (googleScriptLoading) return;
  googleScriptLoading = true;
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = initializeGoogle;
  script.onerror = function () {
    googleScriptLoading = false;
    showStatus('No se pudo cargar el acceso de Google. Comprueba tu conexión e inténtalo de nuevo.', true);
  };
  document.head.append(script);
}

function initializeGoogle() {
  googleScriptLoading = false;
  if (!window.google || !window.google.accounts || !window.google.accounts.id || !authConfig || !authConfig.enabled) {
    return;
  }
  window.google.accounts.id.initialize({
    client_id: authConfig.client_id,
    nonce: authConfig.nonce,
    callback: handleGoogleCredential,
    auto_select: false,
    context: authMode === 'register' ? 'signup' : 'signin',
    ux_mode: 'popup'
  });
  googleInitialized = true;
  renderGoogleButton();
}

function renderGoogleButton() {
  if (!googleInitialized || !window.google || !window.google.accounts || !window.google.accounts.id) return;
  googleButton.replaceChildren();
  window.google.accounts.id.renderButton(googleButton, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: authMode === 'register' ? 'signup_with' : 'signin_with',
    logo_alignment: 'left',
    width: Math.min(340, Math.max(200, googleButtonWrap.clientWidth)),
    locale: 'es'
  });
}

async function handleGoogleCredential(response) {
  if (!response || typeof response.credential !== 'string' || !response.credential) {
    showStatus('Google no devolvió una credencial válida. Inténtalo de nuevo.', true);
    return;
  }
  showStatus('Verificando tu cuenta de forma segura…', false);

  try {
    const result = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const payload = await result.json();
    if (!result.ok) throw new Error(payload.detail || 'No se pudo verificar tu cuenta.');
    if (greeting) {
      greeting.textContent = '¡Qué alegría verte, ' + payload.nombre + '! Vamos a hacer que tu voz brille.';
    }
    window.location.replace(nextPath);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'No se pudo verificar tu cuenta. Inténtalo de nuevo.', true);
    try {
      authConfig = await fetchAuthConfig();
      if (authConfig.enabled) initializeGoogle();
    } catch (configError) {
      showStatus(configError instanceof Error ? configError.message : 'No se pudo preparar Google.', true);
    }
  }
}

async function showCurrentAccount() {
  try {
    const response = await fetch('/auth/me', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) return;
    const user = await response.json();
    if (!user.authenticated) return;
    googleButtonWrap.hidden = true;
    signedInPanel.hidden = false;
    setupNotice.hidden = true;
    signedInName.textContent = user.nombre;
    authTitle.textContent = 'Qué bueno verte.';
    authDescription.textContent = 'Tu cuenta está lista para continuar practicando.';
    if (greeting) {
      greeting.textContent = '¡Hola de nuevo, ' + user.nombre + '! Te estaba esperando.';
    }
  } catch {
    showStatus('No se pudo consultar tu sesión. Puedes volver a iniciar sesión con Google.', true);
  }
}

logoutButton.addEventListener('click', async function () {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('No se pudo cerrar la sesión.');
    window.location.reload();
  } catch (error) {
    logoutButton.disabled = false;
    showStatus(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.', true);
  }
});

document.querySelectorAll('.auth-tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    setAuthMode(tab.dataset.mode);
  });
});

window.addEventListener('resize', renderGoogleButton);

async function initializeAuthPage() {
  await showCurrentAccount();
  if (!signedInPanel.hidden) return;

  try {
    authConfig = await fetchAuthConfig();
    if (!authConfig.enabled) {
      googleButtonWrap.hidden = true;
      googlePlaceholder.hidden = false;
      setupNotice.hidden = false;
      return;
    }
    googlePlaceholder.hidden = true;
    googleButtonWrap.hidden = false;
    loadGoogleScript();
  } catch (error) {
    googleButtonWrap.hidden = true;
    googlePlaceholder.hidden = false;
    showStatus(error instanceof Error ? error.message : 'No se pudo preparar el acceso.', true);
  }
}

initializeAuthPage();
