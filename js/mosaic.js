/* ==========================================================
   mosaic.js
   Fotomozaik motoru.

   1. 100 fotoğraf ve ana portre yüklenir (hata durumunda kontrollü yedek).
   2. Her fotoğraf yüzü koruyacak şekilde kare kırpılır, griye çevrilir ve
      4x4'lük bir ton imzası çıkarılır.
   3. Ana portre hücrelere bölünür; her hücrenin de 4x4 ton imzası hesaplanır.
   4. Her hücreye, imzası en çok benzeyen fotoğraf atanır (tekrar ve komşuluk
      cezalarıyla, 100 fotoğrafın tamamı kullanılacak şekilde).
   5. Seçilen fotoğrafın parlaklığı, hücrenin ortalama tonuna eşitlenir ve
      portrenin ince ayrıntısıyla hafifçe harmanlanır.
   6. Sonuç tek bir kaynak tuvale yazılır; animasyon bu tuvalden hücre
      hücre çizim yapar (kare başına tek drawImage).
   ========================================================== */
(function (Anma) {
  "use strict";

  const SIG = 4;               // ton imzası çözünürlüğü (SIG x SIG)
  const ASPECT = 4 / 5;        // portre en/boy oranı (genişlik / yükseklik)

  /* ---------- Yardımcılar ---------- */

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (img.decode) img.decode().catch(() => {}).then(() => resolve(img));
        else resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /** Görsel için yüzü koruyan kırpma dikdörtgeni (kaynak koordinatlarında). */
  function faceCrop(img, aspect, focusY) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    let sw = w, sh = w / aspect;
    if (sh > h) { sh = h; sw = h * aspect; }
    const sx = (w - sw) / 2;
    // Portrelerde yüz genellikle üst üçte birlik bölümdedir
    const sy = (h - sh) * focusY;
    return { sx, sy, sw, sh };
  }

  /** Görsel yüklenemezse kullanılan, fotoğraf taklidi yapmayan nötr doku. */
  function fallbackTile(seed) {
    const c = makeCanvas(64, 64);
    const ctx = c.getContext("2d");
    const v = 40 + ((seed * 53) % 150);
    const g = ctx.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, `rgb(${v},${v},${v})`);
    g.addColorStop(1, `rgb(${v * 0.6},${v * 0.6},${v * 0.6})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return c;
  }

  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /** Tuvalden piksel okunabiliyor mu? (file:// altında tarayıcılar engeller) */
  function canReadPixels(img) {
    try {
      const c = makeCanvas(2, 2);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 2, 2);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ==========================================================
     Mosaic
     ========================================================== */
  class Mosaic {
    constructor(opts) {
      this.canvas = opts.canvas;
      this.frame = opts.frame;
      this.photos = opts.photos;            // [{file, ...}]
      this.mainSrc = opts.mainSrc;
      this.photoDir = opts.photoDir;
      this.onProgress = opts.onProgress || (() => {});
      this.onComplete = opts.onComplete || (() => {});

      this.ctx = this.canvas.getContext("2d");
      this.tiles = [];                      // {img|canvas, ok, mean, sig}
      this.main = null;
      this.ready = false;
      this.state = "idle";                  // idle | playing | complete
      this.raf = 0;
      this.pixelMode = true;
    }

    /* ---------- 1. Yükleme ---------- */
    async load() {
      const total = this.photos.length + 1;
      let done = 0;
      const tick = () => this.onProgress(++done, total);

      const mainP = loadImage(this.mainSrc).then((img) => { tick(); return img; });
      const tileP = this.photos.map((p, i) =>
        loadImage(this.photoDir + p.file).then((img) => {
          tick();
          return img
            ? { src: img, ok: true, index: i }
            : { src: fallbackTile(i), ok: false, index: i };
        })
      );

      const [main, tiles] = await Promise.all([mainP, Promise.all(tileP)]);
      this.tiles = tiles;
      const okTiles = tiles.filter((t) => t.ok);

      // Ana portre yoksa, yüklenebilen ilk portreyi hedef olarak kullan
      this.main = main || (okTiles[0] && okTiles[0].src) || null;
      this.failed = tiles.length - okTiles.length;
      this.pixelMode = this.main ? canReadPixels(this.main) : false;
      this.ready = !!this.main && okTiles.length > 0;
      return { ok: this.ready, failed: this.failed, pixelMode: this.pixelMode };
    }

    /* ---------- 2. Yerleşim ---------- */
    layout() {
      const fw = this.frame.clientWidth;
      const fh = this.frame.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pad = fw < 600 ? 0 : 8;

      let mh = fh - pad * 2;
      let mw = mh * ASPECT;
      if (mw > fw - 32) { mw = fw - 32; mh = mw / ASPECT; }

      // Hücre sayısı ekrana göre: mobilde daha az, daha büyük kare
      const cols = mw < 380 ? 30 : mw < 520 ? 40 : 46;
      const rows = Math.round(cols / ASPECT);
      const cellDev = Math.max(4, Math.floor((mw * dpr) / cols));   // ekran pikseli
      const cellHi = Math.min(40, Math.max(24, cellDev * 3));       // büyüteç çözünürlüğü

      this.dpr = dpr;
      this.cols = cols;
      this.rows = rows;
      this.cellDev = cellDev;
      this.cellHi = cellHi;
      this.mosaicW = cols * cellDev;                 // cihaz pikseli
      this.mosaicH = rows * cellDev;
      this.canvas.width = Math.round(fw * dpr);
      this.canvas.height = Math.round(fh * dpr);
      this.canvas.style.width = fw + "px";
      this.canvas.style.height = fh + "px";
      this.offX = Math.round((this.canvas.width - this.mosaicW) / 2);
      this.offY = Math.round((this.canvas.height - this.mosaicH) / 2);

      this._buildAtlas();
      this._buildTarget();
      this._assign();
      this._compose();
      this._buildFlights();
    }

    /** Fotoğrafları gri, kare, yüzü korunmuş küçük karelere dönüştürür. */
    _buildAtlas() {
      const s = this.cellHi;
      const n = this.tiles.length;
      const per = Math.ceil(Math.sqrt(n));
      const atlas = makeCanvas(per * s, per * s);
      const ctx = atlas.getContext("2d");
      ctx.imageSmoothingQuality = "high";

      this.tiles.forEach((t, i) => {
        const x = (i % per) * s, y = ((i / per) | 0) * s;
        const src = t.src;
        const cr = t.ok ? faceCrop(src, 1, 0.18) : { sx: 0, sy: 0, sw: src.width, sh: src.height };
        ctx.drawImage(src, cr.sx, cr.sy, cr.sw, cr.sh, x, y, s, s);
        t.ax = x; t.ay = y;
      });

      this.atlas = atlas;
      this.atlasPer = per;
      this.atlasGray = null;

      if (!this.pixelMode) return;
      const data = ctx.getImageData(0, 0, atlas.width, atlas.height).data;
      const gray = new Float32Array(atlas.width * atlas.height);
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = lum(data[p], data[p + 1], data[p + 2]);

      // Her karenin ortalaması, sapması ve 4x4 ton imzası
      const step = s / SIG;
      this.tiles.forEach((t) => {
        const sig = new Float32Array(SIG * SIG);
        let sum = 0, sq = 0;
        for (let yy = 0; yy < s; yy++) {
          const row = (t.ay + yy) * atlas.width + t.ax;
          const sy = Math.min(SIG - 1, (yy / step) | 0) * SIG;
          for (let xx = 0; xx < s; xx++) {
            const v = gray[row + xx];
            sum += v; sq += v * v;
            sig[sy + Math.min(SIG - 1, (xx / step) | 0)] += v;
          }
        }
        const cnt = s * s, per = cnt / (SIG * SIG);
        t.mean = sum / cnt;
        t.std = Math.sqrt(Math.max(1, sq / cnt - t.mean * t.mean));
        // Yapı imzası: ortalamadan bağımsız ve kompozisyondaki gibi kontrastı normalize edilmiş
        const norm = Math.min(1.25, 58 / t.std);
        for (let k = 0; k < sig.length; k++) sig[k] = (sig[k] / per - t.mean) * norm;
        t.sig = sig;
      });
      this.atlasGray = gray;
    }

    /** Ana portreyi hücre ızgarasına göre örnekler, tonlarını hazırlar. */
    _buildTarget() {
      const W = this.cols * this.cellHi, H = this.rows * this.cellHi;
      const c = makeCanvas(W, H);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      const cr = faceCrop(this.main, ASPECT, 0.25);
      ctx.drawImage(this.main, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, W, H);
      this.targetCanvas = c;
      if (!this.pixelMode) return;

      const data = ctx.getImageData(0, 0, W, H).data;
      const g = new Float32Array(W * H);
      const hist = new Uint32Array(256);
      for (let i = 0, p = 0; i < g.length; i++, p += 4) {
        const v = lum(data[p], data[p + 1], data[p + 2]);
        g[i] = v; hist[v | 0]++;
      }
      // Otomatik seviye: %1 ve %99 dilimleri tam aralığa yay
      const pct = (q) => { let acc = 0, lim = g.length * q; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= lim) return i; } return 255; };
      const lo = pct(0.01), hi = Math.max(lo + 1, pct(0.99));

      // Ton eğrisi + kenarlara doğru siyaha eriyen sinematik vinyet
      const cx = W / 2, cy = H * 0.4;
      const smooth = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
      // Kenar maskesi son görüntüye de uygulanır (karanlıktaki kareler bile kenarda kaybolur)
      this.maskX = new Float32Array(W);
      this.maskY = new Float32Array(H);
      for (let x = 0; x < W; x++) this.maskX[x] = smooth(x / (W * 0.1)) * smooth((W - x) / (W * 0.1));
      for (let y = 0; y < H; y++) this.maskY[y] = smooth(y / (H * 0.03)) * smooth((H - y) / (H * 0.12));
      for (let y = 0; y < H; y++) {
        // Dikdörtgenin sert kenarı görünmesin: alt kenar (omuzlar) daha geniş erir
        const fy = smooth(y / (H * 0.06)) * smooth((H - y) / (H * 0.22));
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          let v = (g[i] - lo) / (hi - lo);
          v = v < 0 ? 0 : v > 1 ? 1 : v;
          v = Math.pow(v, 1.38);                                  // orta tonları derinleştir
          v = v * v * (3 - 2 * v) * 0.3 + v * 0.7;                // hafif S-eğrisi
          v *= 0.92;                                              // ışıkları patlatma
          const fx = smooth(x / (W * 0.16)) * smooth((W - x) / (W * 0.16));
          const dx = (x - cx) / (W * 0.6), dy = (y - cy) / (H * 0.7);
          const d = Math.sqrt(dx * dx + dy * dy);
          const vig = 1 - smooth((d - 0.62) / 0.55) * 0.75;
          g[i] = v * 255 * vig * fx * fy;
        }
      }
      this.target = g;
      this.targetW = W;

      // Hücre ortalamaları ve imzaları
      const s = this.cellHi, step = s / SIG, n = this.cols * this.rows;
      this.cellMean = new Float32Array(n);
      this.cellSig = new Float32Array(n * SIG * SIG);
      for (let r = 0; r < this.rows; r++) {
        for (let q = 0; q < this.cols; q++) {
          const ci = r * this.cols + q;
          const base = ci * SIG * SIG;
          let sum = 0;
          for (let yy = 0; yy < s; yy++) {
            const row = (r * s + yy) * W + q * s;
            const sy = Math.min(SIG - 1, (yy / step) | 0) * SIG;
            for (let xx = 0; xx < s; xx++) {
              const v = g[row + xx];
              sum += v;
              this.cellSig[base + sy + Math.min(SIG - 1, (xx / step) | 0)] += v;
            }
          }
          const m = sum / (s * s), per = (s * s) / (SIG * SIG);
          this.cellMean[ci] = m;
          for (let k = 0; k < SIG * SIG; k++) this.cellSig[base + k] = this.cellSig[base + k] / per - m;
        }
      }
    }

    /** Her hücreye en uygun fotoğrafı atar. */
    _assign() {
      const n = this.cols * this.rows;
      const T = this.tiles.length;
      const assign = new Int16Array(n).fill(-1);
      const usage = new Float32Array(T);
      const avg = n / T;

      // Rastgele sırayla dolaş; böylece kullanım cezası ızgaraya eşit dağılır
      const order = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }

      const usable = this.tiles.map((t) => t.ok);
      const R = 2;

      for (const ci of order) {
        const r = (ci / this.cols) | 0, q = ci % this.cols;
        // Komşulukta zaten kullanılan kareler
        const near = new Set();
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const rr = r + dy, qq = q + dx;
          if (rr < 0 || qq < 0 || rr >= this.rows || qq >= this.cols) continue;
          const a = assign[rr * this.cols + qq];
          if (a >= 0) near.add(a);
        }
        let best = -1, bestCost = Infinity;
        for (let t = 0; t < T; t++) {
          if (!usable[t]) continue;
          let cost = 0;
          if (this.pixelMode) {
            const tile = this.tiles[t], base = ci * SIG * SIG;
            // Yapı benzerliği (ışığın karenin neresinden geldiği)
            for (let k = 0; k < SIG * SIG; k++) { const d = tile.sig[k] - this.cellSig[base + k]; cost += d * d; }
            cost /= SIG * SIG;
            // Ton benzerliği: düzeltme ne kadar az gerekirse fotoğraf o kadar doğal görünür
            const dm = tile.mean - this.cellMean[ci];
            cost += dm * dm * 0.1;
          } else {
            cost = Math.random() * 100;
          }
          cost += (usage[t] / avg) * (usage[t] / avg) * 650;   // her fotoğrafın adil kullanımı
          if (usage[t] >= avg * 1.8) cost += 1e5;             // hiçbir fotoğraf portreyi domine etmesin
          else if (usage[t] < avg * 0.5) cost -= 900 * (1 - usage[t] / (avg * 0.5)); // az kullanılana öncelik
          if (near.has(t)) cost += 1e6;                       // yan yana tekrar yok
          if (cost < bestCost) { bestCost = cost; best = t; }
        }
        assign[ci] = best;
        usage[best]++;
      }

      // Hiç kullanılmayan fotoğraf kalmasın: en çok kullanılandan bir hücre devret
      for (let t = 0; t < T; t++) {
        if (!usable[t] || usage[t] > 0) continue;
        let top = 0; for (let k = 1; k < T; k++) if (usage[k] > usage[top]) top = k;
        const ci = order.find((c) => assign[c] === top);
        assign[ci] = t; usage[t]++; usage[top]--;
      }
      this.assign = assign;
      this.usage = usage;
    }

    /** Son mozaik görüntüsünü üretir (yüksek çözünürlük + ekran çözünürlüğü). */
    _compose() {
      const s = this.cellHi, W = this.cols * s, H = this.rows * s;
      const hi = makeCanvas(W, H);
      const ctx = hi.getContext("2d");

      if (this.pixelMode) {
        const out = ctx.createImageData(W, H);
        const o = out.data;
        const g = this.atlasGray, aw = this.atlas.width, tg = this.target;
        // Portrenin ince ayrıntısı (gözler, ağız çizgisi). Az hücreli küçük ekranlarda
        // kareler büyük olduğundan portreye biraz daha fazla pay verilir.
        const small = this.cols <= 30;
        const ALPHA = small ? 0.52 : 0.42;
        const DETAIL = small ? 0.8 : 1;
        for (let r = 0; r < this.rows; r++) {
          for (let q = 0; q < this.cols; q++) {
            const ci = r * this.cols + q;
            const tile = this.tiles[this.assign[ci]];
            const m = this.cellMean[ci];
            const mN = m / 255;
            // Karanlık bölgelerde fotoğraflar gölge gibi kalır, aydınlıkta belirginleşir
            const detail = DETAIL * Math.min(1.25, (0.32 + 0.78 * Math.sqrt(mN)) * (58 / tile.std));
            for (let yy = 0; yy < s; yy++) {
              const trow = (r * s + yy) * W + q * s;
              const arow = (tile.ay + yy) * aw + tile.ax;
              const edgeY = yy === s - 1;
              for (let xx = 0; xx < s; xx++) {
                const tv = g[arow + xx];
                const adj = m + (tv - tile.mean) * detail;
                let v = adj * (1 - ALPHA) + tg[trow + xx] * ALPHA;
                if (edgeY || xx === s - 1) v *= 0.72;        // kareler arası ince derz
                v *= this.maskX[q * s + xx] * this.maskY[r * s + yy];
                v = v < 0 ? 0 : v > 255 ? 255 : v;
                const p = (trow + xx) * 4;
                // Sıcak, arşiv tonunda tek renk
                o[p] = Math.min(255, v * 1.02 + 2);
                o[p + 1] = v * 0.965;
                o[p + 2] = v * 0.895;
                o[p + 3] = 255;
              }
            }
          }
        }
        ctx.putImageData(out, 0, 0);
      } else {
        // Yedek mod (piksel okunamıyorsa): fotoğraf + portre katmanı
        ctx.filter = "grayscale(1) sepia(.18)";
        for (let ci = 0; ci < this.assign.length; ci++) {
          const t = this.tiles[this.assign[ci]];
          const x = (ci % this.cols) * s, y = ((ci / this.cols) | 0) * s;
          ctx.drawImage(this.atlas, t.ax, t.ay, s, s, x, y, s - 1, s - 1);
        }
        ctx.filter = "grayscale(1) contrast(1.15)";
        ctx.globalAlpha = 0.62;
        ctx.drawImage(this.targetCanvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        const grd = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.62);
        grd.addColorStop(0, "rgba(5,5,5,0)");
        grd.addColorStop(1, "rgba(5,5,5,1)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);
      }

      this.finalHi = hi;
      const disp = makeCanvas(this.mosaicW, this.mosaicH);
      const dctx = disp.getContext("2d");
      dctx.imageSmoothingQuality = "high";
      dctx.drawImage(hi, 0, 0, disp.width, disp.height);
      this.finalDisp = disp;
      this.baked = makeCanvas(this.canvas.width, this.canvas.height);
    }

    /* ---------- 3. Animasyon ---------- */
    _buildFlights() {
      const n = this.cols * this.rows;
      const cw = this.canvas.width, ch = this.canvas.height;
      const cx = cw / 2, cy = ch / 2;
      const reach = Math.hypot(cw, ch) * 0.62;
      const cd = this.cellDev;
      this.flights = new Array(n);

      for (let ci = 0; ci < n; ci++) {
        const q = ci % this.cols, r = (ci / this.cols) | 0;
        const tx = this.offX + q * cd, ty = this.offY + r * cd;
        const mN = this.pixelMode ? this.cellMean[ci] / 255 : Math.random();
        // Işık karanlıktan doğar: aydınlık bölgeler (yüz) önce gelir
        const dist = Math.hypot((q / this.cols - 0.5), (r / this.rows - 0.42));
        const delay = (1 - Math.pow(mN, 0.6)) * 4.6 + dist * 2.2 + Math.random() * 1.6;
        const ang = Math.random() * Math.PI * 2;
        const rad = reach * (0.55 + Math.random() * 0.6);
        const sx = cx + Math.cos(ang) * rad, sy = cy + Math.sin(ang) * rad;
        // Eğri yol için kontrol noktası (düz çizgi yerine süzülerek gelsin)
        const mx = (sx + tx) / 2, my = (sy + ty) / 2;
        const bend = (Math.random() - 0.5) * reach * 0.5;
        const nx = -(ty - sy), ny = tx - sx, nl = Math.hypot(nx, ny) || 1;
        this.flights[ci] = {
          tx, ty, sx, sy,
          kx: mx + (nx / nl) * bend, ky: my + (ny / nl) * bend,
          delay, dur: 2.8 + Math.random() * 1.6,
          s0: 0.25 + Math.random() * 1.4,
          sxSrc: q * cd, sySrc: r * cd,
          done: false,
        };
      }
      this.totalTime = Math.max(...this.flights.map((f) => f.delay + f.dur));
    }

    play() {
      if (!this.ready) return;
      cancelAnimationFrame(this.raf);
      this.state = "playing";
      this.flights.forEach((f) => (f.done = false));
      const bctx = this.baked.getContext("2d");
      bctx.clearRect(0, 0, this.baked.width, this.baked.height);
      const ease = Anma.fx.ease.outCubic;
      const ctx = this.ctx, cd = this.cellDev, src = this.finalDisp;
      let start = 0;
      let pending = this.flights.length;

      const frame = (now) => {
        if (!start) start = now;
        const t = (now - start) / 1000;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(this.baked, 0, 0);

        for (let i = 0; i < this.flights.length; i++) {
          const f = this.flights[i];
          if (f.done) continue;
          const p = (t - f.delay) / f.dur;
          if (p <= 0) continue;
          if (p >= 1) {
            f.done = true; pending--;
            bctx.drawImage(src, f.sxSrc, f.sySrc, cd, cd, f.tx, f.ty, cd, cd);
            ctx.drawImage(src, f.sxSrc, f.sySrc, cd, cd, f.tx, f.ty, cd, cd);
            continue;
          }
          const e = ease(p), u = 1 - e;
          const x = u * u * f.sx + 2 * u * e * f.kx + e * e * f.tx;
          const y = u * u * f.sy + 2 * u * e * f.ky + e * e * f.ty;
          const sc = f.s0 + (1 - f.s0) * e;
          const sz = cd * sc;
          ctx.globalAlpha = Math.min(1, p * 2.2) * (0.35 + 0.65 * e);
          ctx.drawImage(src, f.sxSrc, f.sySrc, cd, cd, x + (cd - sz) / 2, y + (cd - sz) / 2, sz, sz);
        }
        ctx.globalAlpha = 1;

        if (pending > 0 && this.state === "playing") this.raf = requestAnimationFrame(frame);
        else if (this.state === "playing") this._finish(true);
      };
      this.raf = requestAnimationFrame(frame);
    }

    /** Animasyonsuz son hali çizer (azaltılmış hareket, yeniden boyutlandırma). */
    showFinal() {
      cancelAnimationFrame(this.raf);
      this._finish(false);
    }

    _finish(withSweep) {
      this.state = "complete";
      const ctx = this.ctx;
      const draw = () => {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(this.finalDisp, this.offX, this.offY);
      };
      draw();
      this.onComplete();
      if (!withSweep) return;

      // Tamamlanınca portrenin üzerinden tek bir yumuşak ışık geçer
      const t0 = performance.now(), D = 3200;
      const sweep = (now) => {
        if (this.state !== "complete") return;
        const p = Math.min(1, (now - t0) / D);
        draw();
        const e = Anma.fx.ease.inOutSine(p);
        const w = this.mosaicW, h = this.mosaicH;
        const x = this.offX - w * 0.6 + e * w * 2.2;
        const g = ctx.createLinearGradient(x - w * 0.35, this.offY, x + w * 0.35, this.offY + h);
        const a = Math.sin(p * Math.PI) * 0.16;
        g.addColorStop(0, "rgba(255,248,236,0)");
        g.addColorStop(0.5, `rgba(255,248,236,${a})`);
        g.addColorStop(1, "rgba(255,248,236,0)");
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = g;
        ctx.fillRect(this.offX, this.offY, w, h);
        ctx.restore();
        if (p < 1) this.raf = requestAnimationFrame(sweep);
        else draw();
      };
      this.raf = requestAnimationFrame(sweep);
    }

    stop() {
      cancelAnimationFrame(this.raf);
      this.state = "idle";
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /* ---------- 4. Etkileşim ---------- */

    /** CSS koordinatındaki noktanın altındaki hücre. */
    cellAt(x, y) {
      const dx = x * this.dpr - this.offX, dy = y * this.dpr - this.offY;
      if (dx < 0 || dy < 0 || dx >= this.mosaicW || dy >= this.mosaicH) return null;
      const q = (dx / this.cellDev) | 0, r = (dy / this.cellDev) | 0;
      return this.cellInfo(r * this.cols + q);
    }

    cellInfo(ci) {
      const q = ci % this.cols, r = (ci / this.cols) | 0;
      const cssCell = this.cellDev / this.dpr;
      return {
        index: ci, q, r,
        photo: this.tiles[this.assign[ci]].index,
        cx: (this.offX / this.dpr) + (q + 0.5) * cssCell,
        cy: (this.offY / this.dpr) + (r + 0.5) * cssCell,
      };
    }

    /** Büyüteç tuvaline, verilen CSS noktasının çevresini yüksek çözünürlükte çizer. */
    drawLoupe(lc, x, y, zoom) {
      const size = lc.width;
      const lctx = lc.getContext("2d");
      const k = this.cellHi / (this.cellDev / this.dpr);   // CSS px -> yüksek çözünürlük px
      const hx = (x - this.offX / this.dpr) * k, hy = (y - this.offY / this.dpr) * k;
      const span = (lc.clientWidth / zoom) * k;
      lctx.fillStyle = "#050505";
      lctx.fillRect(0, 0, size, size);
      lctx.imageSmoothingQuality = "high";
      lctx.drawImage(this.finalHi, hx - span / 2, hy - span / 2, span, span, 0, 0, size, size);
    }
  }

  Anma.Mosaic = Mosaic;
})((window.Anma = window.Anma || {}));
