/* ==========================================================
   main.js
   Uygulama akışı: açılış → yükleme → mozaik → anma.
   Etkileşim: büyüteç, kare bilgisi, klavye gezinmesi, inceleme paneli.
   ========================================================== */
(function (Anma) {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const fx = Anma.fx;
  const photos = Anma.photos || [];

  const el = {
    body: document.body,
    intro: $("#intro"),
    main: $("#main"),
    start: $("#start-btn"),
    status: $("#load-status"),
    stage: $("#stage"),
    frame: $("#stage-frame"),
    canvas: $("#mosaic"),
    loupe: $("#loupe"),
    loupeCanvas: $("#loupe-canvas"),
    tip: $("#cell-tip"),
    tipImg: $("#cell-tip-img"),
    tipText: $("#cell-tip-text"),
    replay: $("#replay-btn"),
    sources: $("#sources-list"),
    viewer: $("#viewer"),
    viewerImg: $("#viewer-img"),
    viewerCaption: $("#viewer-caption"),
    viewerClose: $("#viewer-close"),
  };

  const PHOTO_DIR = "assets/ataturk/";
  const pad3 = (n) => String(n + 1).padStart(3, "0");
  const trLicense = (l) => (/public domain|^pd/i.test(l || "") ? "Kamu malı" : l);

  /* ---------- Mozaik ---------- */
  const mosaic = new Anma.Mosaic({
    canvas: el.canvas,
    frame: el.frame,
    photos,
    photoDir: PHOTO_DIR,
    mainSrc: "assets/images/ataturk-main.jpg",
    onProgress: (done, total) => {
      loadState.done = done;
      loadState.total = total;
      if (loadState.waiting) showStatus(`HATIRALAR TOPLANIYOR · ${Math.round((done / total) * 100)}%`);
    },
    onComplete: () => {
      el.stage.classList.add("is-complete");
      el.canvas.tabIndex = 0;
      el.canvas.classList.add("is-interactive");
    },
  });

  Anma.mosaic = mosaic;   // konsoldan inceleme için
  const loadState = { done: 0, total: photos.length + 1, waiting: false };
  // Yükleme sayfa açılır açılmaz başlar; animasyon ise yükleme bitmeden asla başlamaz
  const loading = photos.length ? mosaic.load() : Promise.resolve({ ok: false });

  function showStatus(text) {
    el.status.textContent = text;
  }

  /* ---------- Açılış → Deneyim ---------- */
  let started = false;

  async function begin() {
    if (started) return;
    started = true;
    el.start.setAttribute("aria-busy", "true");
    loadState.waiting = true;
    showStatus(`HATIRALAR TOPLANIYOR · ${Math.round((loadState.done / loadState.total) * 100)}%`);

    const result = await loading;
    loadState.waiting = false;
    showStatus("");

    el.intro.classList.add("is-leaving");
    el.body.classList.remove("is-intro");
    el.main.removeAttribute("aria-hidden");
    el.intro.setAttribute("aria-hidden", "true");
    el.start.disabled = true;

    if (!result.ok) {
      // Fotoğraflar yüklenemediyse sahneyi gizle, anma bölümüyle devam et
      el.stage.hidden = true;
      $("#anma").scrollIntoView();
      return;
    }

    await nextFrame();
    mosaic.layout();
    lastSize = size();
    el.canvas.focus({ preventScroll: true });

    if (fx.reducedMotion) {
      await fx.wait(500);
      mosaic.showFinal();
    } else {
      await fx.wait(1600);   // birkaç saniyelik saygı dolu karanlık
      mosaic.play();
    }
  }

  el.start.addEventListener("click", begin);

  el.replay.addEventListener("click", async () => {
    if (mosaic.state === "playing") return;
    hideInspect();
    el.stage.classList.remove("is-complete");
    el.canvas.classList.remove("is-interactive");
    mosaic.stop();
    el.stage.scrollIntoView({ behavior: fx.reducedMotion ? "auto" : "smooth", block: "start" });
    await fx.wait(900);
    if (fx.reducedMotion) mosaic.showFinal();
    else mosaic.play();
  });

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  /* ---------- İnceleme: büyüteç + kare bilgisi ---------- */
  const LOUPE_ZOOM = 3.4;
  let current = null;       // üzerinde durulan hücre
  let pointerDown = null;

  function sizeLoupe() {
    const r = el.loupe.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round((r.width || 168) * dpr);
    if (el.loupeCanvas.width !== w) el.loupeCanvas.width = el.loupeCanvas.height = w;
  }

  function inspect(x, y, cell) {
    if (!cell) { hideInspect(); return; }
    current = cell;
    el.loupe.style.left = x + "px";
    el.loupe.style.top = y + "px";
    el.loupe.classList.add("is-on");
    sizeLoupe();
    mosaic.drawLoupe(el.loupeCanvas, x, y, LOUPE_ZOOM);

    const p = photos[cell.photo];
    const src = PHOTO_DIR + p.file;
    if (el.tipImg.getAttribute("src") !== src) el.tipImg.src = src;
    el.tipText.textContent = `KARE ${pad3(cell.photo)}${p.year ? " · " + p.year : ""}`;
    const fw = el.frame.clientWidth;
    const tipX = Math.min(Math.max(8, x + 96), fw - 190);
    const tipY = Math.max(8, y - 28);
    el.tip.style.transform = `translate(${tipX}px, ${tipY}px)`;
    el.tip.classList.add("is-on");
  }

  function hideInspect() {
    current = null;
    el.loupe.classList.remove("is-on");
    el.tip.classList.remove("is-on");
  }

  function localPoint(e) {
    const r = el.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  el.canvas.addEventListener("pointermove", (e) => {
    if (mosaic.state !== "complete") return;
    if (e.pointerType !== "mouse" && !pointerDown) return;
    const { x, y } = localPoint(e);
    inspect(x, y, mosaic.cellAt(x, y));
  });
  el.canvas.addEventListener("pointerdown", (e) => {
    if (mosaic.state !== "complete") return;
    pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (e.pointerType !== "mouse") {
      const { x, y } = localPoint(e);
      inspect(x, y, mosaic.cellAt(x, y));
    }
  });
  el.canvas.addEventListener("pointerup", (e) => {
    if (!pointerDown || mosaic.state !== "complete") { pointerDown = null; return; }
    const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    const quick = performance.now() - pointerDown.t < 450;
    pointerDown = null;
    if (moved < 8 && quick && current) openViewer(current.photo);
    else if (e.pointerType !== "mouse") hideInspect();
  });
  el.canvas.addEventListener("pointerleave", hideInspect);
  el.canvas.addEventListener("pointercancel", () => { pointerDown = null; hideInspect(); });

  /* Klavye: ok tuşlarıyla kareler arasında gezin, Enter ile incele */
  let keyCell = -1;
  el.canvas.addEventListener("keydown", (e) => {
    if (mosaic.state !== "complete") return;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      if (keyCell < 0) keyCell = Math.round(mosaic.rows * 0.38) * mosaic.cols + (mosaic.cols >> 1);
      else {
        const [dx, dy] = moves[e.key];
        const q = Math.min(mosaic.cols - 1, Math.max(0, (keyCell % mosaic.cols) + dx));
        const r = Math.min(mosaic.rows - 1, Math.max(0, ((keyCell / mosaic.cols) | 0) + dy));
        keyCell = r * mosaic.cols + q;
      }
      const c = mosaic.cellInfo(keyCell);
      inspect(c.cx, c.cy, c);
    } else if ((e.key === "Enter" || e.key === " ") && current) {
      e.preventDefault();
      openViewer(current.photo);
    } else if (e.key === "Escape") {
      hideInspect();
    }
  });
  el.canvas.addEventListener("blur", () => { keyCell = -1; hideInspect(); });

  /* ---------- İnceleme paneli ---------- */
  let returnFocus = null;

  function openViewer(i) {
    const p = photos[i];
    if (!p) return;
    returnFocus = document.activeElement;
    el.viewerImg.src = PHOTO_DIR + p.file;
    el.viewerImg.alt = p.alt || "Mustafa Kemal Atatürk'ün tarihî fotoğrafı";
    el.viewerCaption.innerHTML = "";
    const line = document.createElement("span");
    line.textContent = `KARE ${pad3(i)}${p.year ? " · " + p.year : ""} · ${trLicense(p.license)}`;
    const br = document.createElement("br");
    const a = document.createElement("a");
    a.href = p.page; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Kaynak: Wikimedia Commons";
    el.viewerCaption.append(line, br, a);
    hideInspect();
    if (typeof el.viewer.showModal === "function") el.viewer.showModal();
    else window.open(p.page, "_blank", "noopener");
    el.viewerClose.focus();
  }

  el.viewerClose.addEventListener("click", () => el.viewer.close());
  el.viewer.addEventListener("click", (e) => { if (e.target === el.viewer) el.viewer.close(); });
  el.viewer.addEventListener("close", () => { if (returnFocus) returnFocus.focus({ preventScroll: true }); });

  /* ---------- Kaynak listesi ---------- */
  function renderSources() {
    const frag = document.createDocumentFragment();
    photos.forEach((p) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = p.page; a.target = "_blank"; a.rel = "noopener";
      a.textContent = p.label + (p.year ? ` (${p.year})` : "");
      a.title = `${trLicense(p.license)}${p.artist ? " · " + p.artist : ""}`;
      li.appendChild(a);
      frag.appendChild(li);
    });
    el.sources.appendChild(frag);
  }

  /* ---------- Yeniden boyutlandırma ---------- */
  let lastSize = null, resizeTimer = 0;
  const size = () => ({ w: el.frame.clientWidth, h: el.frame.clientHeight });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!lastSize || mosaic.state === "idle") return;
      const s = size();
      // Mobil adres çubuğunun küçük yükseklik oynamalarında yeniden kurma
      if (s.w === lastSize.w && Math.abs(s.h - lastSize.h) < 140) return;
      lastSize = s;
      const wasPlaying = mosaic.state === "playing";
      hideInspect();
      mosaic.layout();
      if (wasPlaying && !fx.reducedMotion) mosaic.play();
      else mosaic.showFinal();
    }, 260);
  });

  /* ---------- Başlat ---------- */
  fx.paintGrain(document.querySelector(".grain"));
  fx.initReveal();
  renderSources();
})((window.Anma = window.Anma || {}));
