(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  $("#year").textContent = new Date().getFullYear();

  /* ---------- Theme (dark by default, remembered per visitor) ---------- */
  const root = document.documentElement;
  const toggle = $("#themeToggle");
  const metaTheme = $('meta[name="theme-color"]');
  const isLight = () => root.dataset.theme === "light";
  const syncTheme = () => {
    toggle.setAttribute("aria-label", isLight() ? "Cambiar a modo oscuro" : "Cambiar a modo claro");
    metaTheme.content = isLight() ? "#f7f6fb" : "#0b1020";
  };
  toggle.addEventListener("click", () => {
    if (isLight()) delete root.dataset.theme; else root.dataset.theme = "light";
    try { localStorage.setItem("talentra-theme", isLight() ? "light" : "dark"); } catch {}
    syncTheme();
    window.talentraTrack?.("Theme toggle", { to: isLight() ? "light" : "dark" });
  });
  syncTheme();

  /* ---------- Nav state ---------- */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 30);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const menuToggle = $("#menuToggle"), navLinks = $("#navLinks");
  const setMenu = (open) => {
    navLinks.classList.toggle("open", open);
    menuToggle.setAttribute("aria-expanded", open);
    menuToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
  };
  menuToggle.addEventListener("click", () => {
    const open = !navLinks.classList.contains("open");
    setMenu(open);
    if (open) window.talentraTrack?.("Menu open");
  });
  $$("a", navLinks).forEach((a) => a.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  document.addEventListener("click", (e) => { if (!nav.contains(e.target)) setMenu(false); });

  /* ---------- Constellation: CVs as nodes that connect ---------- */
  const canvas = $("#constellation");
  const ctx = canvas.getContext("2d");
  let W, H, DPR, lastW = 0, pts = [];
  const mouse = { x: -9999, y: -9999 };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = innerWidth * DPR;
    H = canvas.height = innerHeight * DPR;
    // On mobile, scrolling shows/hides the address bar and changes only the height: keep the points
    if (innerWidth === lastW && pts.length) { if (reduced) drawFrame(); return; }
    lastW = innerWidth;
    const n = Math.round(Math.min(90, (innerWidth * innerHeight) / 16000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25 * DPR,
      vy: (Math.random() - 0.5) * 0.25 * DPR,
      r: (Math.random() * 1.4 + 0.6) * DPR,
      hot: Math.random() < 0.12,
    }));
  }
  function drawFrame() {
    ctx.clearRect(0, 0, W, H);
    const link = 130 * DPR;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;

      const dxm = p.x - mouse.x * DPR, dym = p.y - mouse.y * DPR;
      const dm = Math.hypot(dxm, dym);
      if (dm > 0 && dm < 160 * DPR) { p.x += (dxm / dm) * 0.8; p.y += (dym / dm) * 0.8; }

      for (let j = i + 1; j < pts.length; j++) {
        const q = pts[j];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < link) {
          const a = (1 - d / link) * 0.35;
          const light = isLight();
          ctx.strokeStyle = p.hot || q.hot ? `rgba(255,84,135,${a})` : light ? `rgba(60,70,110,${a * 0.45})` : `rgba(160,170,210,${a * 0.6})`;
          ctx.lineWidth = DPR * 0.7;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
      ctx.fillStyle = p.hot ? "rgba(255,100,140,.9)" : isLight() ? "rgba(60,70,110,.35)" : "rgba(200,210,240,.55)";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.hot ? p.r * 1.6 : p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function draw() { drawFrame(); requestAnimationFrame(draw); }
  resize();
  window.addEventListener("resize", resize);
  if (!reduced) draw(); else drawFrame();

  /* ---------- Cursor glow + spotlight cards ---------- */
  const glow = $("#cursorGlow");
  if (fine && !reduced) {
    window.addEventListener("pointermove", (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY;
      glow.style.opacity = 1;
      glow.style.left = e.clientX + "px";
      glow.style.top = e.clientY + "px";
    });
    $$(".spot").forEach((el) =>
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--x", e.clientX - r.left + "px");
        el.style.setProperty("--y", e.clientY - r.top + "px");
      })
    );
  }

  /* ---------- 3D tilt on hero mockup + parallax float cards ---------- */
  const stage = $("#stage"), mock = $("#mock");
  if (fine && !reduced) {
    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      mock.style.transform = `rotateY(${px * 14}deg) rotateX(${-py * 12}deg)`;
      mock.style.setProperty("--mx", (px + 0.5) * 100 + "%");
      mock.style.setProperty("--my", (py + 0.5) * 100 + "%");
      $$(".float-card", stage).forEach((c) => {
        const d = parseFloat(c.dataset.depth);
        c.style.transform = `translate(${px * 24 * d}px, ${py * 24 * d}px)`;
      });
    });
    stage.addEventListener("pointerleave", () => {
      mock.style.transform = "";
      $$(".float-card", stage).forEach((c) => (c.style.transform = ""));
    });
  }

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }),
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---------- Hero search demo (typing loop) ---------- */
  // Each query shows its own filters and results (the HTML holds the first one, for no-JS / reduced motion)
  const queries = [
    {
      q: "comercial con 5+ años en Madrid e inglés C1",
      chips: ["Ventas", "5+ años", "Madrid", "Inglés C1"],
      results: [
        ["LM", 330, "Laura M.", "Key Account Manager · Madrid · 7 años", ["Ventas 6 años", "Negociación", "Inglés C1"]],
        ["DR", 265, "Diego R.", "Comercial · Madrid · 5 años", ["Ventas 5 años", "Retail", "Inglés C1"]],
        ["AS", 160, "Ana S.", "Directora comercial · Remoto · 9 años", ["Ventas 8 años", "Liderazgo", "Inglés C1"]],
      ],
    },
    {
      q: "alguien que haya abierto mercado en Latinoamérica",
      chips: ["Expansión internacional", "Latinoamérica", "Desarrollo de negocio"],
      results: [
        ["VT", 20, "Valeria T.", "Country Manager · Bogotá · 10 años", ["Latinoamérica 6 años", "Apertura de mercado", "Liderazgo"]],
        ["CP", 200, "Carlos P.", "Business Developer · Remoto · 8 años", ["Expansión México 4 años", "Alianzas", "Inglés C1"]],
        ["AS", 160, "Ana S.", "Directora comercial · Remoto · 9 años", ["Chile y Perú 3 años", "Ventas 8 años", "Liderazgo"]],
      ],
    },
    {
      q: "responsable de ventas con experiencia liderando equipos",
      chips: ["Ventas", "Liderazgo de equipos", "3+ años"],
      results: [
        ["JL", 45, "Javier L.", "Jefe de ventas · Valencia · 11 años", ["Liderazgo 7 años", "Ventas 11 años", "Formación"]],
        ["AS", 160, "Ana S.", "Directora comercial · Remoto · 9 años", ["Liderazgo 6 años", "Ventas 8 años", "Inglés C1"]],
        ["LM", 330, "Laura M.", "Key Account Manager · Madrid · 7 años", ["Liderazgo 3 años", "Ventas 6 años", "Negociación"]],
      ],
    },
  ];
  const typed = $("#typed");
  const chipBox = $("#chips");
  const results = $$(".result");
  const render = ({ chips, results: rows }) => {
    chipBox.replaceChildren(...chips.map((t) => Object.assign(document.createElement("span"), { className: "chip", textContent: t })));
    rows.forEach(([ini, hue, name, meta, tags], i) => {
      const el = results[i], av = $(".avatar", el);
      av.textContent = ini; av.style.setProperty("--h", hue);
      $("strong", el).textContent = name;
      $("small", el).textContent = meta;
      $(".tags", el).replaceChildren(...tags.map((t) => Object.assign(document.createElement("i"), { textContent: t })));
    });
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function demo() {
    if (reduced) { typed.textContent = queries[0].q; return; }
    let qi = 0;
    await wait(900);
    for (;;) {
      const item = queries[qi % queries.length], q = item.q;
      render(item);
      const chips = $$(".chip", chipBox);
      for (let i = 1; i <= q.length; i++) { typed.textContent = q.slice(0, i); await wait(38 + Math.random() * 40); }
      await wait(250);
      for (const c of chips) { c.classList.add("on"); await wait(110); }
      for (const r of results) { r.classList.add("on"); await wait(160); }
      await wait(3400);
      results.forEach((r) => r.classList.remove("on"));
      chips.forEach((c) => c.classList.remove("on"));
      for (let i = q.length; i >= 0; i--) { typed.textContent = q.slice(0, i); await wait(14); }
      await wait(400);
      qi++;
    }
  }
  demo();

  /* ---------- Statement: words light up as you scroll ---------- */
  const big = $("#bigText");
  const wrapWords = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((t) => {
          if (!t.trim()) return frag.append(t);
          const s = document.createElement("span"); s.className = "w"; s.textContent = t; frag.append(s);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && !n.classList.contains("grad")) wrapWords(n);
      else if (n.nodeType === 1) n.classList.add("w");
    });
  };
  wrapWords(big);
  const words = $$(".w", big);

  /* ---------- Pipeline progress ---------- */
  const pipe = $("#pipeline"), fill = $("#pipeFill"), steps = $$(".step", pipe);

  function onScrollFx() {
    const vh = innerHeight;
    const br = big.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (vh * 0.85 - br.top) / (br.height + vh * 0.35)));
    const lit = Math.floor(p * words.length);
    words.forEach((w, i) => w.classList.toggle("lit", i < lit));

    const pr = pipe.getBoundingClientRect();
    const pp = Math.min(1, Math.max(0, (vh * 0.75 - pr.top) / (pr.height * 0.9)));
    fill.style.width = pp * 100 + "%";
    steps.forEach((s, i) => s.classList.toggle("active", pp >= i / (steps.length - 1) - 0.02));
  }
  if (!reduced) {
    window.addEventListener("scroll", onScrollFx, { passive: true });
    onScrollFx();
  }

})();
