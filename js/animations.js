/* ==========================================================
   animations.js
   Easing fonksiyonları, film grain dokusu, kaydırma geçişleri
   ve hareket tercihleri. Diğer modüller window.Anma.fx üzerinden kullanır.
   ========================================================== */
(function (Anma) {
  "use strict";

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const ease = {
    linear: (t) => t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    // Yumuşak "iniş": hızlı başlar, sonda çok yavaşlayarak yerine oturur
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /** Belirli bir aralıktaki ilerlemeyi 0-1 arasına çevirir. */
  function progress(t, start, duration) {
    return clamp01((t - start) / duration);
  }

  /** Statik gürültü dokusunu bir kez üretip film grain katmanına uygular. */
  function paintGrain(el) {
    if (!el) return;
    try {
      // Doku cihaz pikseli çözünürlüğünde üretilir: yüksek yoğunluklu telefon
      // ekranlarında iri lekeler yerine ince, film gibi bir tane oluşur.
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const size = Math.round(160 * dpr);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      el.style.backgroundImage = `url(${c.toDataURL("image/png")})`;
      el.style.backgroundSize = `${size / dpr}px ${size / dpr}px`;
    } catch (e) {
      el.remove(); // dokunun üretilememesi deneyimi bozmamalı
    }
  }

  /** Görünür alana giren .reveal elemanlarına sınıf ekler. */
  function initReveal(root) {
    const items = (root || document).querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    items.forEach((el) => io.observe(el));
  }

  /** Belirli bir süre bekleyen Promise. */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  Anma.fx = {
    ease,
    clamp01,
    progress,
    paintGrain,
    initReveal,
    wait,
    get reducedMotion() {
      return motionQuery.matches;
    },
    onMotionChange(fn) {
      if (motionQuery.addEventListener) motionQuery.addEventListener("change", fn);
    },
  };
})((window.Anma = window.Anma || {}));
