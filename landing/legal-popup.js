/*
 * Abre los documentos legales (privacidad, cookies, términos, aviso legal) en una ventana
 * emergente en lugar de navegar a otra página. Las páginas siguen existiendo por separado para enlaces
 * directos y buscadores; si algo falla al cargarlas, el enlace navega como siempre.
 */
(() => {
  const dlg = document.getElementById("legalDialog");
  if (!dlg || typeof dlg.showModal !== "function" || !window.fetch) return;

  const DOCS = ["privacidad.html", "cookies.html", "terminos.html", "aviso-legal.html"];
  const body = dlg.querySelector("#lgBody");
  const tabs = dlg.querySelector("#lgTabs");
  const cache = new Map();
  const track = (name, props) => window.talentraTrack?.(name, props);
  const docOf = (a) => {
    const href = a.getAttribute("href") || "";
    return DOCS.find((d) => href === d || href.endsWith("/" + d)) || null;
  };

  const loadDoc = async (doc) => {
    if (!cache.has(doc)) {
      const res = await fetch(doc);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = new DOMParser().parseFromString(await res.text(), "text/html");
      const main = page.querySelector("main.legal");
      if (!main) throw new Error("Sin contenido legal");
      cache.set(doc, main);
    }
    return cache.get(doc).cloneNode(true);
  };

  const show = () => {
    if (!dlg.open) dlg.showModal();
    body.scrollTop = 0;
    body.focus({ preventScroll: true }); // keep the focus ring off the first tab when opening
  };

  const openDoc = async (doc) => {
    const main = await loadDoc(doc); // throws → caller navigates normally
    const nav = main.querySelector(".legal-nav");
    tabs.replaceChildren(...(nav ? [...nav.children] : []));
    tabs.hidden = !nav;
    nav?.remove();
    main.querySelector("h1")?.setAttribute("id", "lgTitle");
    body.replaceChildren(...main.childNodes);
    show();
    track("Legal open", { doc: doc.replace(".html", "") });
  };

  // Any link to a legal page (footer, waitlist form, links inside the documents themselves)
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    const doc = docOf(a);
    if (!doc) return;
    e.preventDefault();
    try { await openDoc(doc); } catch (err) { console.error("[legal]", err); location.href = a.href; }
  });

  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
})();
