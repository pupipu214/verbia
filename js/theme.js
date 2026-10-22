const themeStorageKey = "verbai-theme";
const LOGO_DARK = "static/img/verbai-logo-dark.svg";
const LOGO_LIGHT = "/static/img/verbai-logo-final.svg";
const themeToggleButtons = document.querySelectorAll("[data-theme-toggle]");
const brandLogos = document.querySelectorAll(".brand-logo");

function setTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";

  brandLogos.forEach((logo) => {
    const useDarkBackgroundLogo = isDark || logo.hasAttribute("data-dark-background");
    logo.src = useDarkBackgroundLogo ? LOGO_DARK : LOGO_LIGHT;
  });

  themeToggleButtons.forEach((button) => {
    const label = isDark ? "Activar modo claro" : "Activar modo oscuro";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(isDark));
  });
}

const savedTheme = localStorage.getItem(themeStorageKey);
const initialTheme = savedTheme || (
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
);
setTheme(initialTheme);

themeToggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(themeStorageKey, nextTheme);
    setTheme(nextTheme);
  });
});

window.addEventListener("storage", (event) => {
  if (event.key === themeStorageKey && (event.newValue === "light" || event.newValue === "dark")) {
    setTheme(event.newValue);
  }
});
