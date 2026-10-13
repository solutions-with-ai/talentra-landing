/*
 * Formulario de la lista de espera.
 *
 * PENDIENTE: pon en WAITLIST_ENDPOINT la URL que recibe las solicitudes. Sirve cualquiera que acepte un POST
 * de formulario y responda 2xx, por ejemplo:
 *   · Google Sheets: la URL de la "aplicación web" de tools/waitlist-google-sheet.gs (https://script.google.com/macros/s/…/exec)
 *   · Formspree: https://formspree.io/f/xxxxxxx
 *
 * Mientras esté vacío, en local (127.0.0.1 / localhost) el envío se simula para poder probarlo; publicado,
 * muestra un error con el email de contacto para no perder a nadie sin avisar.
 *
 * Cualquier enlace a #lista-espera abre el formulario, también al llegar a la web con esa URL
 * (p. ej. https://…/#lista-espera en una campaña o un post).
 */
(() => {
  const WAITLIST_ENDPOINT = "";

  const dlg = document.getElementById("waitlist");
  if (!dlg || typeof dlg.showModal !== "function") return;

  const form = dlg.querySelector("#wlForm");
  const formStep = dlg.querySelector("#wlFormStep");
  const doneStep = dlg.querySelector("#wlDoneStep");
  const submitBtn = form.querySelector(".wl-submit");
  const submitLabel = submitBtn.querySelector(".wl-label");
  const errorBox = dlg.querySelector("#wlError");
  const track = (name, props) => window.talentraTrack?.(name, props);
  const isLocal = ["127.0.0.1", "localhost", ""].includes(location.hostname);

  let source = "direct", started = false, sent = false, triedSubmit = false;

  /* ---------- Open / close ---------- */
  const open = (from) => {
    source = from;
    started = false;
    if (!dlg.open) dlg.showModal();
    (sent ? dlg.querySelector("#wlDoneTitle") : form.elements.nombre).focus();
  };

  document.querySelectorAll('[data-waitlist], a[href="#lista-espera"]').forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      open(a.dataset.track || "link");
    })
  );
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  // Click on the dimmed backdrop (outside the panel) closes it
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => {
    if (started && !sent) track("Waitlist abandon", { location: source });
    if (location.hash === "#lista-espera") history.replaceState(null, "", location.pathname + location.search);
  });

  if (location.hash === "#lista-espera") open("url");

  form.addEventListener("input", () => {
    if (!started) { started = true; track("Waitlist start", { location: source }); }
    if (triedSubmit) validate();
  });

  /* ---------- Validation ---------- */
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const rules = [
    [form.elements.nombre, (el) => (el.value.trim() ? "" : "Escribe tu nombre.")],
    [form.elements.email, (el) => (!el.value.trim() ? "Escribe tu email." : emailOk(el.value) ? "" : "Este email no parece válido.")],
    [form.elements.empresa, (el) => (el.value.trim() ? "" : "Escribe el nombre de tu empresa.")],
    [form.elements.consentimiento, (el) => (el.checked ? "" : "Necesitamos tu permiso para guardar tus datos.")],
  ];
  const validate = () => {
    let first = null;
    for (const [el, rule] of rules) {
      const msg = rule(el);
      const field = el.closest(".wl-field");
      const out = field.querySelector(".wl-msg");
      field.toggleAttribute("data-invalid", !!msg);
      el.setAttribute("aria-invalid", msg ? "true" : "false");
      out.textContent = msg;
      if (msg) el.setAttribute("aria-describedby", out.id); else el.removeAttribute("aria-describedby");
      if (msg && !first) first = el;
    }
    return first;
  };

  /* ---------- Submit ---------- */
  const send = async (data) => {
    if (!WAITLIST_ENDPOINT) {
      if (!isLocal) throw new Error("WAITLIST_ENDPOINT vacío");
      console.warn("[waitlist] Sin WAITLIST_ENDPOINT: envío simulado en local.", Object.fromEntries(data));
      await new Promise((r) => setTimeout(r, 700));
      return;
    }
    // URL-encoded body: a "simple" CORS request that both Google Apps Script and Formspree-style services accept
    const res = await fetch(WAITLIST_ENDPOINT, { method: "POST", body: new URLSearchParams(data), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    triedSubmit = true;
    errorBox.hidden = true;
    const invalid = validate();
    if (invalid) { invalid.focus(); return; }

    const data = new FormData(form);
    const isBot = !!data.get("web");
    data.delete("web");
    data.set("fuente", source);
    data.set("pagina", location.origin + location.pathname);
    data.set("referrer", document.referrer);
    const params = new URLSearchParams(location.search);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) if (params.get(k)) data.set(k, params.get(k));
    data.set("fecha", new Date().toISOString());

    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");
    submitLabel.textContent = "Enviando…";
    try {
      if (!isBot) await send(data);
      sent = true;
      track("Waitlist submit", { location: source, volume: data.get("volumen") || "sin respuesta" });
      dlg.querySelector("#wlDoneEmail").textContent = data.get("email");
      formStep.hidden = true;
      doneStep.hidden = false;
      dlg.querySelector("#wlDoneTitle").focus();
    } catch (err) {
      console.error("[waitlist]", err);
      track("Waitlist error", { location: source });
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.removeAttribute("aria-busy");
      submitLabel.textContent = "Quiero acceso anticipado";
    }
  });

  dlg.querySelector("#wlAnother").addEventListener("click", () => {
    form.reset();
    triedSubmit = false;
    sent = false;
    started = false;
    for (const [el] of rules) {
      el.closest(".wl-field").removeAttribute("data-invalid");
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    }
    form.querySelectorAll(".wl-msg").forEach((m) => (m.textContent = ""));
    doneStep.hidden = true;
    formStep.hidden = false;
    form.elements.nombre.focus();
  });
})();
