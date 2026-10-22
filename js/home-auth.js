'use strict';

const homeAccountLink = document.querySelector('[data-home-account]');

async function updateHomeAccountLink() {
  try {
    const response = await fetch('/auth/me', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('No se pudo consultar la sesión.');

    const account = await response.json();
    if (account.authenticated) {
      homeAccountLink.textContent = 'Hola, ' + account.nombre;
      homeAccountLink.setAttribute('aria-label', 'Cuenta de ' + account.nombre);
      homeAccountLink.href = '/perfil.html';
    }
  } catch (error) {
    console.error('No se pudo cargar el estado de acceso de VerbIA.', error);
  }
}

updateHomeAccountLink();
