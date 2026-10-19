/*
 * Formulario de la lista de espera.
 *
 * La meta talentra-waitlist-endpoint apunta al Worker con contrato JSON y Turnstile.
 * Sin configuración no se simula éxito, tampoco en localhost. No registra datos personales en consola.
 * Configuración, pruebas y activación: tools/cloudflare/README.md.
 *
 * Cualquier enlace a #lista-espera abre el formulario, también al llegar a la web con esa URL
 * (p. ej. https://…/#lista-espera en una campaña o un post).
 * Si el formulario no puede abrirse (JS bloqueado o con error, navegador muy antiguo), #lista-espera lleva
 * a la sección del CTA, que muestra el email para apuntarse a mano.
 */
(() => {
  const WAITLIST_ENDPOINT = document.querySelector('meta[name="talentra-waitlist-endpoint"]')?.content.trim() || '';

  const dlg = document.getElementById("waitlist");
  if (!dlg || typeof dlg.showModal !== "function") return;
  document.documentElement.classList.add("wl-ready"); // hides the email fallback under the CTA

  const form = dlg.querySelector("#wlForm");
  const formStep = dlg.querySelector("#wlFormStep");
  const doneStep = dlg.querySelector("#wlDoneStep");
  const submitBtn = form.querySelector(".wl-submit");
  const submitLabel = submitBtn.querySelector(".wl-label");
  const errorBox = dlg.querySelector("#wlError");
  const track = (name, props) => window.talentraTrack?.(name, props);
  const isLocal = ["127.0.0.1", "localhost", ""].includes(location.hostname);
  const captchaBox = dlg.querySelector('#wlChallenge');
  let widgetId, token = '', challengeLoading;
  const explain = message => {
    errorBox.hidden = false;
    const detail = dlg.querySelector('#wlErrorDetail');
    if (detail) detail.textContent = message;
  };
  const ensureChallenge = () => challengeLoading ||= (async () => {
    if (!WAITLIST_ENDPOINT) throw new Error('not_configured');
    const endpoint = new URL(WAITLIST_ENDPOINT);
    if (endpoint.pathname !== '/api/waitlist' || (endpoint.protocol !== 'https:' && !(isLocal && endpoint.hostname === '127.0.0.1'))) throw new Error('not_configured');
    const response = await fetch(endpoint.origin + '/api/waitlist/config', {cache:'no-store',signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('not_configured');
    const config = await response.json();
    if (!config.turnstile_site_key) throw new Error('not_configured');
    if (config.mode === 'test') captchaBox.setAttribute('data-test-mode','');
    dlg.querySelector('#wlTestNotice').hidden = config.mode !== 'test';
    if (!window.turnstile) await new Promise((resolve,reject) => {
      const script = document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
      const timeout=setTimeout(()=>reject(new Error('challenge_unavailable')),12000);
      script.onload=()=>{clearTimeout(timeout);resolve();};script.onerror=()=>{clearTimeout(timeout);reject(new Error('challenge_unavailable'));};document.head.appendChild(script);
    });
    widgetId=window.turnstile.render('#wlChallenge',{sitekey:config.turnstile_site_key,action:'talentra_waitlist',theme:'auto',
      callback:value=>{token=value;},'expired-callback':()=>{token='';},'error-callback':()=>{token='';explain('No podemos completar la comprobación de seguridad. Inténtalo de nuevo.');}});
  })().catch(error=>{challengeLoading=null;throw error;});

  let source = "direct", started = false, sent = false, triedSubmit = false;

  /* ---------- Open / close ---------- */
  const open = (from) => {
    source = from;
    started = false;
    if (!dlg.open) dlg.showModal();
    (sent ? dlg.querySelector("#wlDoneTitle") : form.elements.nombre).focus();
    if (!sent) ensureChallenge().catch(()=>explain('El formulario todavía no está disponible. Puedes escribirnos al correo de contacto.'));
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
    [form.elements.nombre, (el) => (el.value.trim().length >= 2 ? "" : "Escribe tu nombre, con al menos dos caracteres.")],
    [form.elements.email, (el) => (!el.value.trim() ? "Escribe tu email." : emailOk(el.value) ? "" : "Este email no parece válido.")],
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
    await ensureChallenge();
    if (!token) throw new Error('challenge');
    const payload={name:data.get('nombre'),email:data.get('email'),company:data.get('empresa')||'',role:data.get('cargo')||'',
      consent:data.get('consentimiento')==='si',website:data.get('web')||'',source:String(data.get('fuente')||'direct').slice(0,80),language:'es',turnstile_token:token};
    const res = await fetch(WAITLIST_ENDPOINT, { method: 'POST', body: JSON.stringify(payload), headers: {'Content-Type':'application/json',Accept:'application/json'},signal:AbortSignal.timeout(15000) });
    const result=await res.json().catch(()=>({}));
    if (res.status!==202||result.status!=='received') throw new Error(res.status===429?'rate_limit':result.error||'unavailable');
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    triedSubmit = true;
    errorBox.hidden = true;
    const invalid = validate();
    if (invalid) { invalid.focus(); return; }

    const data = new FormData(form);
    data.set("fuente", source);
    const params = new URLSearchParams(location.search);
    if (params.get('utm_source')) data.set('fuente',params.get('utm_source').slice(0,80));

    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");
    submitLabel.textContent = "Enviando…";
    try {
      await send(data);
      sent = true;
      track("Waitlist submit", { location: source });
      dlg.querySelector("#wlDoneEmail").textContent = data.get("email");
      formStep.hidden = true;
      doneStep.hidden = false;
      dlg.querySelector("#wlDoneTitle").focus();
    } catch (err) {
      track("Waitlist error", { location: source });
      explain(err.message==='rate_limit'?'Has realizado varios intentos. Espera antes de volver a enviar.':err.message==='fictional_only'?'Esta vista es de pruebas: utiliza un correo ficticio terminado en @example.test.':err.message==='challenge'?'Completa la comprobación de seguridad antes de enviar.':err.message==='fields'?'Revisa el nombre y el correo: algún dato no tiene el formato esperado.':'No hemos podido confirmar el guardado. Tus datos siguen aquí; puedes reintentar sin duplicar la inscripción.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.removeAttribute("aria-busy");
      submitLabel.textContent = "Quiero tener acceso anticipado";
      token='';if(widgetId!==undefined)window.turnstile?.reset(widgetId);
    }
  });

  dlg.querySelector("#wlAnother").addEventListener("click", () => {
    form.reset();
    triedSubmit = false;
    sent = false;
    started = false;
    errorBox.hidden = true;
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
