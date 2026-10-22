'use strict';

const profileGreeting = document.querySelector('#profile-greeting');
const profileName = document.querySelector('#profile-name');
const profileEmail = document.querySelector('#profile-email');
const profileCreated = document.querySelector('#profile-created');
const profilePhoto = document.querySelector('#profile-photo');
const profileInitials = document.querySelector('#profile-initials');
const profileStatus = document.querySelector('#profile-status');
const logoutButton = document.querySelector('#profile-logout');

function setProfileStatus(message) {
  profileStatus.textContent = message;
}

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(function (part) {
    return part.charAt(0);
  }).join('').toLocaleUpperCase('es-MX') || 'V';
}

function formatCreatedAt(value) {
  if (typeof value !== 'string') return 'No disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No disponible';
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

async function loadProfile() {
  setProfileStatus('');
  try {
    const response = await fetch('/auth/me', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('No se pudo cargar tu perfil. Inténtalo de nuevo.');
    const user = await response.json();
    if (!user.authenticated) {
      const next = window.location.pathname + window.location.search;
      window.location.replace('/login?next=' + encodeURIComponent(next));
      return;
    }
    if (typeof user.nombre !== 'string' || typeof user.email !== 'string') {
      throw new Error('El servidor devolvió datos de perfil incompletos.');
    }

    profileName.textContent = user.nombre;
    profileGreeting.textContent = user.nombre.split(/\s+/)[0] + '.';
    profileEmail.textContent = user.email;
    profileCreated.textContent = formatCreatedAt(user.fecha_registro);
    profileInitials.textContent = getInitials(user.nombre);

    if (typeof user.foto === 'string') {
      try {
        const photoUrl = new URL(user.foto);
        if (photoUrl.protocol === 'https:') {
          profilePhoto.src = photoUrl.href;
          profilePhoto.hidden = false;
          profileInitials.hidden = true;
          profilePhoto.addEventListener('error', function () {
            profilePhoto.hidden = true;
            profileInitials.hidden = false;
          }, { once: true });
        }
      } catch {
        profilePhoto.hidden = true;
      }
    }
  } catch (error) {
    setProfileStatus(error instanceof Error ? error.message : 'No se pudo cargar tu perfil.');
  }
}

logoutButton.addEventListener('click', async function () {
  logoutButton.disabled = true;
  setProfileStatus('');
  try {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json' }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'No se pudo cerrar la sesión.');
    window.location.replace('/');
  } catch (error) {
    logoutButton.disabled = false;
    setProfileStatus(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.');
  }
});

loadProfile();
