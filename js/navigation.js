/* ============================================================
   navigation.js — menú móvil transversal
   ------------------------------------------------------------
   Se carga en TODAS las páginas con `.nav-toggle`, para que el
   comportamiento sea el mismo en móvil, tableta y PC:
   - cerrar al tocar fuera
   - cerrar con Escape
   - cerrar al navegar
   - cerrar al pasar a la vista de escritorio
   ============================================================ */

// Punto de ruptura del menú. Debe coincidir con el `@media`
// (max-width: 760px) del CSS.

function initNavToggle(toggle) {
  const nav = document.getElementById(toggle.getAttribute("aria-controls"));
  const label = document.querySelector(`label[for="${toggle.id}"]`);

  if (!nav) {
    console.error("El menú de navegación no tiene un destino válido.", toggle);
    return;
  }

  const setOpen = (open) => {
    toggle.checked = open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    nav.classList.toggle("is-open", open);
  };

  setOpen(toggle.checked);
  toggle.addEventListener("change", () => setOpen(toggle.checked));

  // Al elegir un destino dentro del menú, se cierra.
  nav.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
  });

  // Cerrar al tocar fuera del botón y del panel.
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    if (
      !toggle.contains(event.target) &&
      !nav.contains(event.target) &&
      !label?.contains(event.target)
    ) {
      setOpen(false);
    }
  });

  // Cerrar con Escape (accesibilidad de teclado).
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
}

function initNavigation() {
  const toggles = document.querySelectorAll(".nav-toggle");
  if (!toggles.length) return;

  toggles.forEach(initNavToggle);

  // Al pasar a la vista de escritorio el menú debe cerrarse.
  // Se usa `change` en lugar de `resize`: sólo se evalúa al
  // cruzar el breakpoint, no en cada píxel redimensionado.
  // (En móvil `resize` se dispara al mostrar/ocultar la barra
  //  del navegador, lo que cerraba el menú sin querer.)
  if (window.matchMedia) {
    const desktop = window.matchMedia("(min-width: 761px)");
    const onBreakpoint = (event) => {
      if (event.matches) toggles.forEach((t) => { t.checked = false; });
    };
    if (desktop.addEventListener) desktop.addEventListener("change", onBreakpoint);
    else if (desktop.addListener) desktop.addListener(onBreakpoint);
  } else {
    window.addEventListener("resize", () => {
      if (window.innerWidth > 760) toggles.forEach((t) => { t.checked = false; });
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNavigation);
} else {
  initNavigation();
}
