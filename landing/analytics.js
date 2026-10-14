/*
 * Métricas de Talentra (sin cookies).
 *
 * Cómo activarlo: crea el sitio en https://plausible.io con el dominio de la web y pon ese dominio en
 * ANALYTICS.domain. Mientras esté vacío no se carga nada ni se envía nada (los eventos salen en la consola
 * si abres la web con ?debug-analytics).
 *
 * Eventos que se envían (además de la visita a cada página, que registra Plausible por su cuenta):
 *   Waitlist click   · abre el formulario de lista de espera       · props: location (nav, hero-pill, hero, cta)
 *   Waitlist start   · empieza a rellenarlo                         · props: location
 *   Waitlist submit  · lo envía correctamente                       · props: location
 *   Waitlist abandon · lo cierra tras empezar sin enviarlo          · props: location
 *   Waitlist error   · el envío falla                               · props: location
   (los cuatro últimos se envían desde waitlist.js)
 *   Click            · clic en cualquier otro enlace o botón         · props: label, section, href
 *   Outbound click   · clic que sale de la web (incl. mailto)        · props: href, section
 *   Section view     · una sección entra en pantalla (1 vez/visita)  · props: section
 *   Scroll depth     · llega al 25/50/75/100 % de la página          · props: percent
 *   Engaged time     · tiempo con la pestaña visible, al salir       · props: bucket
 *   Theme toggle     · cambia el tema                                · props: to
 *   Menu open        · abre el menú del móvil
 *   Legal open       · abre un documento legal en la ventana emergente · props: doc (desde legal-popup.js)
 */
(() => {
  const ANALYTICS = {
    provider: "plausible", // "plausible" | "umami"
    domain: "solutions-with-ai.github.io", // El mismo dominio con el que se da de alta el sitio en Plausible (o el website-id si usas Umami)
    src: "https://plausible.io/js/script.js", // Umami: "https://cloud.umami.is/script.js"
  };

  const debug = /[?&]debug-analytics\b/.test(location.search);
  const enabled = !!ANALYTICS.domain;

  // Queue so events fired before the provider script loads are not lost
  window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };

  if (enabled) {
    const s = document.createElement("script");
    s.defer = true;
    s.src = ANALYTICS.src;
    if (ANALYTICS.provider === "umami") s.dataset.websiteId = ANALYTICS.domain;
    else s.dataset.domain = ANALYTICS.domain;
    document.head.append(s);
  }

  // Passive events (scroll, time, sections) must not count as interaction, or the bounce rate would always be 0
  const PASSIVE = new Set(["Section view", "Scroll depth", "Engaged time"]);
  const track = (name, props = {}) => {
    if (debug) console.info("[analytics]", name, props);
    if (!enabled) return;
    if (ANALYTICS.provider === "umami") window.umami?.track(name, props);
    else window.plausible(name, { props, interactive: !PASSIVE.has(name) });
  };
  window.talentraTrack = track;

  const sectionOf = (el) => {
    const s = el.closest("[data-section], section[id], header, footer, main");
    if (!s) return "other";
    return s.dataset.section || s.id || s.tagName.toLowerCase();
  };

  /* ---------- Clicks ---------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("a, button");
    if (!el) return;
    const section = sectionOf(el);
    if (el.matches("[data-waitlist]")) return track("Waitlist click", { location: el.dataset.track || section });
    if (el.id === "themeToggle" || el.id === "menuToggle") return; // tracked with their own events
    const href = el.getAttribute("href") || "";
    if (/^(https?:|mailto:)/.test(href) && !href.startsWith(location.origin)) track("Outbound click", { href, section });
    const label = el.dataset.track || el.getAttribute("aria-label") || el.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
    track("Click", { label, section, href });
  });

  /* ---------- Sections seen ---------- */
  const seen = new Set();
  const sectionIO = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const name = en.target.dataset.section || en.target.id;
    if (seen.has(name)) return;
    seen.add(name);
    sectionIO.unobserve(en.target);
    track("Section view", { section: name });
  }), { threshold: 0.35 });
  const observeSections = () => document.querySelectorAll("[data-section]").forEach((el) => sectionIO.observe(el));

  /* ---------- Scroll depth ---------- */
  const marks = [25, 50, 75, 100];
  let reached = 0;
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const pct = max <= 0 ? 100 : ((scrollY + 2) / max) * 100;
    while (reached < marks.length && pct >= marks[reached]) track("Scroll depth", { percent: String(marks[reached++]) });
    if (reached === marks.length) removeEventListener("scroll", onScroll);
  };
  addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Engaged time (only while the tab is visible) ---------- */
  let visibleSince = document.visibilityState === "visible" ? performance.now() : null, engaged = 0, sent = false;
  const bucket = (s) => (s < 10 ? "0-10s" : s < 30 ? "10-30s" : s < 60 ? "30-60s" : s < 180 ? "1-3min" : s < 600 ? "3-10min" : "10min+");
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (visibleSince != null) engaged += performance.now() - visibleSince;
      visibleSince = null;
      if (!sent) { sent = true; track("Engaged time", { bucket: bucket(engaged / 1000) }); }
    } else visibleSince = performance.now();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeSections);
  else observeSections();
})();
