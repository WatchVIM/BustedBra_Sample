/* ============================================================
   WatchVIM Website Frontend (ROOT app.js)

   Repo root:
     /app.js
     /config.json
     /index.html
     /checkout.html
     /paypal-checkout.js
     /privacy.html
     /refund.html
     /terms.html
     /contact.html

   Features:
   - Landing page at root (no hash) → “Enter WatchVIM” → #/home
   - Landing page includes Mux promo playback (PROMO_PLAYBACK_ID)
   - Manifest -> Catalog loading
   - Logo + theme from /config.json (overrides defaults)
   - Hero carousel for featured titles
   - Tabs + title/series drilldowns
   - Mux playback pages
   - Optional Supabase auth (login + signup + membership)
   - Paywall logic for AVOD / SVOD / TVOD (supports hybrids)
   - TV D-pad focus navigation (TV devices only)
   - LIVE loop channel (no manual Next)
   - VAST pre-roll + repeating mid-roll via Google IMA SDK (titles + episodes + LIVE)
   - Optional Global Ads Pod (mux/url) before content (AVOD + LIVE)
   - Mobile:
       • Top nav tabs only on desktop (md+)
       • Bottom tab bar on mobile only

   PATCHES in this regen:
   ✅ Header: add “Become a Member” next to “Log in”
   ✅ Avatar picker on Signup + Profile (stored in Supabase user_metadata.avatar_id)
   ✅ TVOD checkout stays on-site via new SPA route #/checkout (branded shell + embed checkout.html)
   ✅ LIVE connection hardened (supports CMS endpoint shapes + titleId-only items)
   ✅ LIVE: Pluto-style guide rows are UNDER player + Now Playing card (image + times)
   ✅ Home rows: no poster cut-off + wheel-to-scroll + smoother mobile scrolling
   ✅ Series episodes: thumbnails restored
   ✅ Back button: series/film drilldowns return to last catalog tab
   ✅ Player “small → big → small” jump reduced via stable aspect wrapper + contain
   ✅ Hero per-tab filtering (Movies hero = Movies only, etc.)
   ✅ Footer black strip full-width
============================================================ */

(() => {
  // =========================================================
  // CONSTANTS + STATE
  // =========================================================
  const PROMO_PLAYBACK_ID = "sJQ12hEfeyDCR4gtKbhIXzzGpzHU71BQB8GTIU1pklY";

  const DEFAULT_CONFIG = {
    MANIFEST_URL: "https://t6ht6kdwnezp05ut.public.blob.vercel-storage.com/manifest.json",
    CATALOG_URL_FALLBACK: "https://t6ht6kdwnezp05ut.public.blob.vercel-storage.com/catalog.json",
    LOGO_URL: "./WatchVIM_New_OTT_Logo.png",
    THEME: { accent: "#e50914", background: "#0a0a0a", gold: "#d4af37" },

    SUPABASE_URL: "https://oxqneksxmwopepchkatv.supabase.co",
    SUPABASE_ANON_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cW5la3N4bXdvcGVwY2hrYXR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MzA1NTEsImV4cCI6MjA3OTIwNjU1MX0.CPdAIY-9QthHnbg3yTwJ_10PYp1CBTIV_o4x4qO6EJE",

    PAYPAL_CLIENT_ID: "",
    TVOD_API_BASE: "",
    TVOD_CHECKOUT_URL_BASE: "/checkout.html",

    // Optional: CMS publishes Loop Channel JSON endpoint
    LOOP_CHANNEL_URL: "",

    // Global fallback VAST tag (set GAM tag here OR via config.json)
    VAST_TAG: "",

    // Global Ads Pod (array of {type:"mux", playbackId, label} or {type:"url", src, label})
    GLOBAL_ADS: [],
    PLAY_GLOBAL_ADS_ON_AVOD: false,
    PLAY_GLOBAL_ADS_ON_LIVE: false,

    ADS_DEBUG: false,

    // LIVE/VOD fallback ad cadence if CMS doesn’t provide it
    LIVE_AD_FREQUENCY_MINS_FALLBACK: 10,
    AVOD_MIDROLL_EVERY_MINS_FALLBACK: 10,

    // PATCH: TV mode should NOT trigger on desktop width anymore.
    FORCE_TV_MODE: false
  };

  let CONFIG = { ...DEFAULT_CONFIG };

  const state = {
    catalog: null,
    titles: [],
    byId: new Map(),
    activeTab: "Home",
    route: { name: "landing", params: {} },
    session: null,
    user: null,

    // Back-to-catalog helpers
    lastBrowseTab: "Home",
    lastBrowseHash: "#/home?tab=Home",

    // UI helpers
    ui: {
      authAvatarPick: null,
      profileAvatarPick: null
    },

    loop: {
      channel: null,
      queue: [],
      index: 0,
      playingAd: false,
      adTimer: null,
      rotateTimer: null,
      progressTimer: null
    }
  };

  const app = document.getElementById("app");

  // =========================================================
  // STYLES
  // =========================================================
  function injectGlobalStyles() {
    if (document.getElementById("watchvim-inline-styles")) return;
    const s = document.createElement("style");
    s.id = "watchvim-inline-styles";
    s.textContent = `
      body{
        margin:0;
        background:var(--watch-bg,#0a0a0a);
        color:#fff;
        font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }

      .row-scroll{-ms-overflow-style:none; scrollbar-width:none;}
      .row-scroll::-webkit-scrollbar{display:none;}
      .focus-ring{ outline:2px solid var(--watch-accent,#e50914); outline-offset:2px; border-radius:12px; }

      .line-clamp-1,.line-clamp-2,.line-clamp-3,.line-clamp-4{
        display:-webkit-box;
        -webkit-box-orient:vertical;
        overflow:hidden;
      }
      .line-clamp-1{-webkit-line-clamp:1;}
      .line-clamp-2{-webkit-line-clamp:2;}
      .line-clamp-3{-webkit-line-clamp:3;}
      .line-clamp-4{-webkit-line-clamp:4;}

      /* LIVE (Pluto-style) */
      .wv-live-rail{ position:relative; }
      .wv-live-rail .wv-rail-card{ border-radius:24px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.05); }
      .wv-progress-track{ height:8px; border-radius:999px; background:rgba(255,255,255,.14); overflow:hidden; }
      .wv-progress-bar{ height:100%; width:0%; background:var(--watch-accent,#e50914); }
      .wv-guide-scroll{ max-height:540px; overflow:auto; -webkit-overflow-scrolling:touch; }

      /* Hero trailer preview should FILL the hero area (not letterboxed) */
      .wv-hero-preview{
        position:absolute; inset:0;
        width:100%; height:100%;
        display:block;
        --media-object-fit: cover;
        --media-object-position: center;
      }

      /* =========================
         SERIES PAGE LAYOUT FIX
         ========================= */
      .seriesHero{
        position:relative;
        height:320px;
        background-size:cover;
        background-position:center;
      }
      .seriesHeroScrim{
        position:absolute; inset:0;
        background:linear-gradient(to bottom, rgba(0,0,0,.15), rgba(0,0,0,.85));
      }
      .seriesHeader{
        display:flex;
        gap:22px;
        padding:28px 28px 18px;
        margin-top:-70px;
        background:#0a0a0a;
        position:relative;
        z-index:2;
      }
      .seriesPoster{
        width:220px;
        flex:0 0 220px;
        border-radius:18px;
        box-shadow:0 18px 40px rgba(0,0,0,.55);
        transform:translateY(-18px);
      }
      .seriesMeta{
        min-width:0;
        padding-top:18px;
      }
      .seriesMeta .kicker{
        letter-spacing:.22em;
        font-size:12px;
        opacity:.8;
        margin-bottom:6px;
      }
      .seriesMeta .title{
        font-size:44px;
        line-height:1.05;
        margin:0 0 10px;
      }
      .seriesMeta .tagline{
        opacity:.85;
        max-width:900px;
        margin-bottom:14px;
      }
      .seasonTabs{
        margin-top:10px;
        display:flex;
        gap:10px;
        flex-wrap:wrap;
      }
      .seriesBody{
        padding:10px 28px 60px;
      }
      @media (max-width: 900px){
        .seriesHeader{ flex-direction:column; margin-top:-60px; }
        .seriesPoster{ width:180px; flex-basis:auto; transform:translateY(-10px); }
        .seriesMeta{ padding-top:0; }
        .seriesMeta .title{ font-size:34px; }
      }

      /* Ads debug chip */
      .ads-debug-chip{
        position:fixed; bottom:12px; right:12px; z-index:99999;
        background:rgba(0,0,0,.75); border:1px solid rgba(255,255,255,.2);
        padding:8px 10px; border-radius:12px; font-size:11px; color:#fff;
        max-width:360px; line-height:1.25;
      }

      /* Simple modal */
      .wv-modal-backdrop{ position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; padding:18px; }
      .wv-modal{ width:min(560px, 100%); border-radius:18px; border:1px solid rgba(255,255,255,.12); background:#0b0b0b; box-shadow:0 24px 80px rgba(0,0,0,.55); overflow:hidden; }
      .wv-modal header{ padding:16px 16px 10px; border-bottom:1px solid rgba(255,255,255,.08); }
      .wv-modal .body{ padding:14px 16px 16px; }
      .wv-btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:#fff; cursor:pointer; }
      .wv-btn:hover{ background:rgba(255,255,255,.10); }
      .wv-btn-primary{ background:var(--watch-accent,#e50914); border-color:transparent; font-weight:700; }
      .wv-btn-primary:hover{ filter:brightness(1.05); }
      .wv-input{ width:100%; padding:12px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:#fff; outline:none; }
      .wv-input:focus{ border-color:rgba(255,255,255,.25); }

      /* Row scrolling: smoother + works on mousewheel */
      .row-scroll{ -webkit-overflow-scrolling:touch; scroll-behavior:smooth; padding-bottom:8px; }

      /* Player sizing stability (prevents “small → big → small” jumps) */
      mux-player, video{ display:block; width:100%; height:100%; }
      .wv-player-wrap{ position:relative; width:100%; background:#000; border-radius:24px; overflow:hidden; }
      .wv-player-wrap::before{ content:""; display:block; padding-top:56.25%; } /* 16:9 */
      .wv-player-inner{ position:absolute; inset:0; }

      /* Footer full-width fallback */
      .wv-footer, .wv-mobilebar{ width:100%; background:rgba(0,0,0,.95); }

      /* Avatar UI */
      .wv-avatar{ width:32px; height:32px; border-radius:999px; overflow:hidden; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.06); }
      .wv-avatar img{ width:100%; height:100%; object-fit:cover; display:block; }
      .wv-avatar-lg{ width:84px; height:84px; border-radius:999px; overflow:hidden; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.06); }
      .wv-avatar-lg img{ width:100%; height:100%; object-fit:cover; display:block; }
      .wv-avatar-grid button{ border-radius:18px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.05); padding:10px; cursor:pointer; }
      .wv-avatar-grid button:hover{ background:rgba(255,255,255,.09); }
      .wv-avatar-grid button.wv-selected{ outline:2px solid var(--watch-accent,#e50914); outline-offset:2px; }
    `;
    document.head.appendChild(s);
  }

  // =========================================================
  // HELPERS
  // =========================================================
  function esc(str = "") {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  function numOrNull(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function toMins(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : "";
  }

  function firstUrl(...vals) {
    for (const v of vals) {
      if (!v) continue;
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "object") {
        const u = v.url || v.src || v.href || v.publicUrl;
        if (typeof u === "string" && u.trim()) return u.trim();
      }
    }
    return "";
  }

  function normalizeMediaUrl(u) {
    if (!u) return "";
    if (/^(data:|blob:|https?:\/\/)/i.test(u)) return u;
    if (/^\/\//.test(u)) return location.protocol + u;
    if (u.startsWith("/")) return location.origin + u;
    return u;
  }

  function poster(t) {
    return normalizeMediaUrl(firstUrl(
      t?.posterUrl, t?.poster_url,
      t?.appImages?.tvPosterUrl, t?.appImages?.mobilePosterUrl, t?.appImages?.posterUrl,
      t?.images?.poster, t?.images?.posterUrl,
      t?.poster, t?.cover, t?.thumbnailUrl
    ));
  }

  function hero(t) {
    return normalizeMediaUrl(firstUrl(
      t?.featureHeroUrl, t?.featuredHeroUrl, t?.featureHeroImageUrl, t?.featureImageUrl,
      t?.heroUrl, t?.hero_url,
      t?.appImages?.tvHeroUrl, t?.appImages?.mobileHeroUrl, t?.appImages?.heroUrl, t?.appImages?.hero,
      t?.images?.hero, t?.images?.heroUrl,
      t?.heroImage, t?.hero,
      poster(t)
    ));
  }

  function episodePoster(ep, series = null) {
    return normalizeMediaUrl(firstUrl(
      ep?.posterUrl, ep?.poster_url,
      ep?.thumbnailUrl, ep?.thumbnail_url,
      ep?.imageUrl, ep?.image_url,
      ep?.appImages?.tvPosterUrl, ep?.appImages?.mobilePosterUrl, ep?.appImages?.posterUrl, ep?.appImages?.thumbnailUrl,
      ep?.images?.poster, ep?.images?.posterUrl, ep?.images?.thumbnail, ep?.images?.thumb,
      series ? poster(series) : ""
    ));
  }

  function typeLabel(type) {
    const map = { films: "Movie", documentaries: "Documentary", series: "Series", shorts: "Short", foreign: "Foreign" };
    return map[type] || type || "Title";
  }

  // PATCH: TV mode should only be true for actual TV devices (or forced).
  function isTV() {
    if (CONFIG?.FORCE_TV_MODE) return true;
    const ua = navigator.userAgent.toLowerCase();
    return /aft|smarttv|tizen|webos|android tv|hbbtv|netcast/.test(ua);
  }

  // PATCH: Mobile detection for bottom tab bar.
  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 767px)").matches;
  }

  function pickFirstString(...vals) {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
  }

  function logAds(...args) {
    if (!CONFIG.ADS_DEBUG) return;
    console.log("[WatchVIM ADS]", ...args);
    ensureAdsDebugChip(String(args.map(String).join(" ")));
  }

  function ensureAdsDebugChip(msg) {
    if (!CONFIG.ADS_DEBUG) return;
    let el = document.getElementById("adsDebugChip");
    if (!el) {
      el = document.createElement("div");
      el.id = "adsDebugChip";
      el.className = "ads-debug-chip";
      document.body.appendChild(el);
    }
    el.textContent = msg;
  }

  // =========================================================
  // AVATARS (preset SVGs stored by avatar_id in Supabase user_metadata)
  // =========================================================
  const AVATAR_PRESETS = [
    "ember", "gold", "neon", "ocean", "violet", "mint", "mono", "sunrise"
  ];

  function initialsFromString(str) {
    const s = String(str || "").trim();
    if (!s) return "WV";
    const parts = s.split(/[\s.@_-]+/).filter(Boolean);
    const a = (parts[0] || "W")[0] || "W";
    const b = (parts[1] || parts[0] || "V")[0] || "V";
    return (a + b).toUpperCase();
  }

  function avatarPalette(id) {
    const pal = {
      ember:   ["#e50914", "#d4af37", "rgba(0,0,0,.85)"],
      gold:    ["#d4af37", "#e50914", "rgba(0,0,0,.85)"],
      neon:    ["#00e5ff", "#e50914", "rgba(0,0,0,.85)"],
      ocean:   ["#00c6ff", "#0072ff", "rgba(0,0,0,.85)"],
      violet:  ["#a855f7", "#e50914", "rgba(0,0,0,.85)"],
      mint:    ["#34d399", "#d4af37", "rgba(0,0,0,.85)"],
      mono:    ["#ffffff", "#6b7280", "rgba(0,0,0,.90)"],
      sunrise: ["#fb7185", "#fbbf24", "rgba(0,0,0,.85)"]
    };
    return pal[id] || pal.ember;
  }

  function svgToDataUri(svg) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function avatarSvg(id, seedText) {
    const [c1, c2, ink] = avatarPalette(id);
    const initials = initialsFromString(seedText);
    // Simple geometric + gradient + initials (clean + “premium”)
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${c1}"/>
            <stop offset="100%" stop-color="${c2}"/>
          </linearGradient>
          <radialGradient id="r" cx="30%" cy="20%" r="90%">
            <stop offset="0%" stop-color="rgba(255,255,255,.35)"/>
            <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
          </radialGradient>
          <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="rgba(0,0,0,.35)"/>
          </filter>
        </defs>

        <rect width="256" height="256" rx="64" fill="url(#g)"/>
        <circle cx="80" cy="64" r="120" fill="url(#r)"/>
        <path d="M-10 200 C 60 160, 120 260, 266 190 L 266 266 L -10 266 Z" fill="rgba(0,0,0,.18)"/>
        <path d="M0 170 C 90 120, 110 220, 256 150" stroke="rgba(255,255,255,.22)" stroke-width="10" fill="none" stroke-linecap="round"/>

        <g filter="url(#s)">
          <circle cx="128" cy="128" r="74" fill="${ink}" opacity=".22"/>
          <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
                font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
                font-size="72" font-weight="900" fill="rgba(255,255,255,.92)" letter-spacing="2">
            ${initials}
          </text>
        </g>
      </svg>
    `.trim();
  }

  function userAvatarId(u) {
    const um = u?.user_metadata || {};
    const id = (um.avatar_id || um.avatarId || "").toString().trim();
    return id && AVATAR_PRESETS.includes(id) ? id : "";
  }

  function userAvatarUrl(u) {
    const um = u?.user_metadata || {};
    const custom = (um.avatar_url || um.avatarUrl || "").toString().trim();
    if (custom) return normalizeMediaUrl(custom);

    const id = userAvatarId(u) || "ember";
    const seed = u?.email || um?.full_name || "WatchVIM";
    return svgToDataUri(avatarSvg(id, seed));
  }

  function renderAvatarGrid({ selectedId = "", clickFn = "selectAuthAvatar" } = {}) {
    const safeSelected = (selectedId && AVATAR_PRESETS.includes(selectedId)) ? selectedId : "";
    const seed = state.user?.email || "WatchVIM";
    return `
      <div class="wv-avatar-grid mt-3 grid grid-cols-4 gap-2">
        ${AVATAR_PRESETS.map((id) => {
          const uri = svgToDataUri(avatarSvg(id, seed));
          return `
            <button class="${id === safeSelected ? "wv-selected" : ""}" type="button" data-avatar="${esc(id)}" onclick="${clickFn}('${esc(id)}')">
              <div class="wv-avatar mx-auto" style="width:46px;height:46px;">
                <img src="${esc(uri)}" alt="${esc(id)}"/>
              </div>
              <div class="mt-2 text-[10px] text-white/70 uppercase tracking-[0.18em] text-center">${esc(id)}</div>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  // =========================================================
  // SCRIPT LOADER
  // =========================================================
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some((s) => s.src === src)) return resolve(true);
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error("Failed to load script: " + src));
      document.head.appendChild(s);
    });
  }

  async function ensureMuxPlayerLoaded() {
    if (customElements.get("mux-player")) return true;
    try {
      await loadScript("https://unpkg.com/@mux/mux-player@latest/dist/mux-player.js");
      return !!customElements.get("mux-player");
    } catch (e) {
      console.warn("[WatchVIM] mux-player failed to load", e);
      return false;
    }
  }

  // =========================================================
  // CONFIG LOADING
  // =========================================================
  function mergeConfigSafe(base, incoming) {
    const out = { ...base, ...(incoming || {}) };
    out.THEME = { ...(base.THEME || {}), ...((incoming && incoming.THEME) || {}) };

    if (!out.SUPABASE_URL) out.SUPABASE_URL = base.SUPABASE_URL;
    if (!out.SUPABASE_ANON_KEY) out.SUPABASE_ANON_KEY = base.SUPABASE_ANON_KEY;
    if (!out.MANIFEST_URL) out.MANIFEST_URL = base.MANIFEST_URL;
    if (!out.CATALOG_URL_FALLBACK) out.CATALOG_URL_FALLBACK = base.CATALOG_URL_FALLBACK;

    // Ensure VAST_TAG retained
    if (!out.VAST_TAG) out.VAST_TAG = base.VAST_TAG;

    if (!Array.isArray(out.GLOBAL_ADS)) out.GLOBAL_ADS = [];

    // Preserve explicit false
    if (typeof out.PLAY_GLOBAL_ADS_ON_AVOD !== "boolean") out.PLAY_GLOBAL_ADS_ON_AVOD = !!base.PLAY_GLOBAL_ADS_ON_AVOD;
    if (typeof out.PLAY_GLOBAL_ADS_ON_LIVE !== "boolean") out.PLAY_GLOBAL_ADS_ON_LIVE = !!base.PLAY_GLOBAL_ADS_ON_LIVE;
    if (typeof out.ADS_DEBUG !== "boolean") out.ADS_DEBUG = !!base.ADS_DEBUG;

    return out;
  }

  async function loadConfigJSON() {
    const paths = ["/config.json?t=" + Date.now(), "./config.json?t=" + Date.now()];
    for (const p of paths) {
      try {
        const res = await fetch(p, { cache: "no-store" });
        if (!res.ok) continue;
        const json = await res.json();
        CONFIG = mergeConfigSafe(CONFIG, json);
        break;
      } catch (_) {}
    }

    const theme = CONFIG.THEME || {};
    document.documentElement.style.setProperty("--watch-accent", theme.accent || "#e50914");
    document.documentElement.style.setProperty("--watch-bg", theme.background || "#0a0a0a");
    document.documentElement.style.setProperty("--watch-gold", theme.gold || "#d4af37");
  }

  // =========================================================
  // DATA LOADING (Manifest -> Catalog)
  // =========================================================
  async function fetchCatalogFromManifest() {
    const directCatalog =
      CONFIG.CATALOG_URL ||
      CONFIG.CATALOG_URL_STABLE ||
      CONFIG.STABLE_CATALOG_URL ||
      "";

    if (!CONFIG.MANIFEST_URL) {
      const url = directCatalog || CONFIG.CATALOG_URL_FALLBACK;
      if (!url) throw new Error("No MANIFEST_URL and no catalog URL configured.");
      const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("Catalog fetch failed.");
      return await r.json();
    }

    try {
      const mRes = await fetch(CONFIG.MANIFEST_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!mRes.ok) throw new Error("Manifest fetch failed");
      const manifest = await mRes.json();

      const catalogUrl =
        manifest.stableCatalogUrl ||
        manifest.latestCatalogUrl ||
        manifest.catalogUrl ||
        directCatalog ||
        CONFIG.CATALOG_URL_FALLBACK;
      console.log("[WatchVIM] Chosen catalogUrl:", catalogUrl);

      if (!catalogUrl) throw new Error("No catalog URL in manifest or fallback config.");

      const cRes = await fetch(catalogUrl + "?t=" + Date.now(), { cache: "no-store" });
      if (!cRes.ok) throw new Error("Catalog fetch failed");
      const catalog = await cRes.json();

      console.log("[WatchVIM] loopChannel exists:", !!catalog.loopChannel);
      console.log("[WatchVIM] loop rotation items:", catalog.loopChannel?.rotationItems?.length || 0);

      return catalog;
    } catch (e) {
      const url = directCatalog || CONFIG.CATALOG_URL_FALLBACK;
      if (!url) throw e;
      const cRes = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
      if (!cRes.ok) throw e;
      return await cRes.json();
    }
  }

  // Robust ID normalization + episode indexing
  function normalizeCatalog(catalog) {
    const raw = catalog?.titles || catalog?.publishedTitles || catalog?.items || [];
    const byId = new Map();

    const titles = (Array.isArray(raw) ? raw : [])
      .map((t) => {
        if (!t) return null;
        const id = t.id || t.titleId || t.title_id || t.contentId || t.slug || t.key;
        if (!id) return null;
        if (!t.id) t.id = String(id);
        return t;
      })
      .filter(Boolean);

    titles.forEach((t) => {
      byId.set(String(t.id), t);

      if (String(t.type).toLowerCase() === "series") {
        (t.seasons || []).forEach((s, si) => {
          (s.episodes || []).forEach((ep, ei) => {
            const epId = ep.id || ep.episodeId || ep.contentId || `${t.id}_s${si + 1}e${ei + 1}`;
            ep.id = String(epId);
            ep.__seriesId = t.id;
            ep.__seasonIndex = si;
            ep.__epIndex = ei;
            byId.set(ep.id, ep);
          });
        });
      }
    });

    return { titles, byId };
  }

  // =========================================================
  // HERO MANAGER (CMS) CONNECTOR
  // =========================================================
  function getHeroManagerConfig() {
    const c = state.catalog || {};
    const hm =
      c?.home?.heroManager ||
      c?.heroManager ||
      c?.homepage?.heroManager ||
      c?.home?.hero_manager ||
      c?.hero_manager ||
      null;

    return hm && typeof hm === "object" ? hm : null;
  }

  function resolveHeroManagerItems(hm) {
    const slides = Array.isArray(hm?.slides) ? hm.slides : [];
    const out = [];
    const seen = new Set();

    for (const sl of slides) {
      if (!sl) continue;

      const id = sl.titleId || sl.title_id || sl.id || sl.refId || sl.contentId || sl.slug || sl.key || "";
      if (!id) continue;

      const base = state.byId.get(String(id)) || null;
      if (!base) continue;

      const merged = { ...base };

      merged.__hero_slide = true;
      merged.__hero_webHeroUrl = normalizeMediaUrl(firstUrl(sl.webHeroUrl, sl.heroUrl, sl.hero, sl.webHero));
      merged.__hero_titleOverride = (sl.titleOverride || sl.title_override || "").trim();
      merged.__hero_synopsisOverride = (sl.synopsisOverride || sl.synopsis_override || "").trim();
      merged.__hero_titleLogoUrl = normalizeMediaUrl(firstUrl(sl.titleLogoUrl, sl.title_logo_url, sl.logoUrl, sl.logo));
      merged.__hero_trailerPlaybackId = (sl.trailerPlaybackId || sl.trailer_playback_id || "").trim();

      if (merged.__hero_trailerPlaybackId) merged.trailerPlaybackId = merged.__hero_trailerPlaybackId;

      if (seen.has(merged.id)) continue;
      seen.add(merged.id);
      out.push(merged);
    }

    return out;
  }

  function heroImageForHeroItem(t) {
    return normalizeMediaUrl(firstUrl(t?.__hero_webHeroUrl, hero(t)));
  }
  function heroTitleForHeroItem(t) {
    return (t?.__hero_titleOverride || "").trim() || t?.title || "Untitled";
  }
  function heroSynopsisForHeroItem(t) {
    return (t?.__hero_synopsisOverride || "").trim() || t?.synopsis || t?.description || "";
  }
  function heroTrailerIdForHeroItem(t) {
    return (t?.__hero_trailerPlaybackId || "").trim() || t?.trailerPlaybackId || "";
  }

  function featuredItems() {
    const c = state.catalog || {};

    const hm = getHeroManagerConfig();
    const hmMode = String(hm?.mode || "").toLowerCase();
    if (hm && hmMode === "custom") {
      const itemsFromHM = resolveHeroManagerItems(hm);
      if (itemsFromHM.length) return itemsFromHM;
    }

    const direct =
      c.heroCarousel?.items || c.heroCarousel ||
      c.featureCarousel?.items || c.featureCarousel ||
      c.featuredCarousel?.items || c.featuredCarousel ||
      c.heroTitles || c.heroItems || c.featuredTitles || c.featured ||
      c.featuredItems || c.featuredList ||
      c.homepage?.hero || c.homepage?.featured ||
      null;

    const resolveRef = (it) => {
      if (!it) return null;
      if (typeof it === "string") return state.byId.get(it) || null;

      const id =
        it.id || it.refId || it.titleId || it.title_id || it.contentId ||
        it?.ref?.id || it?.ref?.refId ||
        it?.title?.id || it?.title?.refId ||
        it?.itemId || it?.slug || it?.key || null;

      if (id) return state.byId.get(String(id)) || it;
      if (it.refType && it.refId) return state.byId.get(String(it.refId)) || it;
      return it?.id ? it : null;
    };

    let items = [];
    if (Array.isArray(direct) && direct.length) items = direct.map(resolveRef).filter(Boolean);

    if (!items.length) {
      items = state.titles.filter((t) =>
        t.isHero === true ||
        t.isFeatured === true ||
        t.featured === true ||
        t.hero === true ||
        t.feature === true ||
        (Array.isArray(t.tags) && t.tags.some((tag) => /hero|featured|feature/i.test(tag))) ||
        (Array.isArray(t.genre) && t.genre.some((g) => /hero|featured|feature/i.test(g)))
      );
    }

    const seen = new Set();
    return items.filter((t) => {
      const id = t?.id;
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function sortFeatured(items) {
    return items.slice().sort((a, b) => {
      const ao = a.heroOrder ?? a.featuredOrder ?? a.featuredRank ?? a.rank ?? a.order ?? 9999;
      const bo = b.heroOrder ?? b.featuredOrder ?? b.featuredRank ?? b.rank ?? b.order ?? 9999;
      return ao - bo;
    });
  }

  // =========================================================
  // LIVE: hydrate loopChannel from CMS endpoint (optional)
  // =========================================================
  async function hydrateLoopChannelFromCMS() {
    try {
      const c = state.catalog || {};

      // Accept MANY config/catalog shapes (CMS portal “Loop Channel”)
      const rawUrl =
        CONFIG.LOOP_CHANNEL_URL ||
        CONFIG.LIVE_CHANNEL_URL ||
        c.loopChannelUrl || c.loop_channel_url ||
        c.liveChannelUrl || c.live_channel_url ||
        c.loopChannel?.url || c.loopChannel?.endpoint || c.loopChannel?.endpointUrl ||
        c.liveChannel?.url || c.liveChannel?.endpoint || c.liveChannel?.endpointUrl ||
        c.home?.loopChannelUrl || c.home?.loop_channel_url ||
        c.home?.liveChannelUrl || c.home?.live_channel_url ||
        c.home?.loopChannel?.url || c.home?.loopChannel?.endpoint ||
        c.home?.liveChannel?.url || c.home?.liveChannel?.endpoint ||
        "";

      const url = normalizeMediaUrl(rawUrl);
      if (!url) return;

      const u = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) return;

      const json = await res.json();

      const pickChannelObj = (obj) => {
        if (!obj || typeof obj !== "object") return null;
        return (
          obj.loopChannel || obj.liveChannel || obj.channel ||
          obj.loop_channel || obj.live_channel ||
          null
        );
      };

      let ch = null;

      // 1) Raw array → queue
      if (Array.isArray(json)) {
        ch = { queue: json };
      } else if (json && typeof json === "object") {
        // 2) channel object possibly nested
        ch =
          pickChannelObj(json) ||
          pickChannelObj(json.data) ||
          pickChannelObj(json.result) ||
          pickChannelObj(json.payload) ||
          null;

        // 3) queue array possibly nested (common CMS shapes)
        const q =
          (Array.isArray(json.queue) && json.queue) ||
          (Array.isArray(json.items) && json.items) ||
          (Array.isArray(json.programs) && json.programs) ||
          (Array.isArray(json.playlist) && json.playlist) ||
          (Array.isArray(json.slots) && json.slots) ||
          (Array.isArray(json.data?.queue) && json.data.queue) ||
          (Array.isArray(json.data?.items) && json.data.items) ||
          (Array.isArray(json.data?.programs) && json.data.programs) ||
          (Array.isArray(json.result?.queue) && json.result.queue) ||
          (Array.isArray(json.result?.items) && json.result.items) ||
          null;

        if (!ch && q) ch = { queue: q };

        // 4) If ch exists but queue is stored under other names
        if (ch && typeof ch === "object" && !Array.isArray(ch)) {
          if (!Array.isArray(ch.queue)) {
            const q2 =
              (Array.isArray(ch.items) && ch.items) ||
              (Array.isArray(ch.queueItems) && ch.queueItems) ||
              (Array.isArray(ch.programs) && ch.programs) ||
              (Array.isArray(ch.playlist) && ch.playlist) ||
              (Array.isArray(ch.slots) && ch.slots) ||
              null;
            if (q2) ch.queue = q2;
          }
        }
      }

      if (!ch) return;
      if (Array.isArray(ch)) ch = { queue: ch };
      if (!Array.isArray(ch.queue)) ch.queue = [];

      // Persist on catalog so initLoopQueue can read it
      state.catalog.loopChannel = ch;
    } catch (e) {
      console.warn("[WatchVIM] hydrateLoopChannelFromCMS failed:", e);
    }
  }

  async function loadData() {
    renderLoading("Loading catalog…");
    state.catalog = await fetchCatalogFromManifest();

    // ✅ LIVE connection from config/catalog endpoint
    await hydrateLoopChannelFromCMS();

    const norm = normalizeCatalog(state.catalog);
    state.titles = norm.titles;
    state.byId = norm.byId;

    initLoopQueue();
  }

  // =========================================================
  // TAB FILTERS
  // =========================================================
  const TAB_FILTERS = {
    Home: () => true,
    Movies: (t) => t.type === "films" || t.type === "documentaries",
    Series: (t) => t.type === "series",
    Shorts: (t) => t.type === "shorts" || (t.runtimeMins && Number(t.runtimeMins) <= 40),
    Foreign: (t) =>
      t.type === "foreign" ||
      (t.genre || []).some((g) => /foreign|international|world/i.test(g)) ||
      (t.language && !/english/i.test(t.language)),
    LIVE: () => false
  };

  // =========================================================
  // SUPABASE (Optional Auth)
  // =========================================================
  let supabase = null;

  async function initSupabaseIfPossible() {
    if (supabase) return supabase;
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;

    try {
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js");
    } catch (e) {
      console.warn("[WatchVIM] Supabase SDK failed to load. Continuing without auth.", e);
      return null;
    }

    supabase = window.supabase?.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    if (!supabase) return null;

    try {
      const { data } = await supabase.auth.getSession();
      state.session = data?.session || null;
      state.user = data?.session?.user || null;
    } catch (_) {
      state.session = null;
      state.user = null;
    }

    await refreshUserFromServer();
    syncSvodFlagToLocalStorage();

    supabase.auth.onAuthStateChange(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        state.session = data?.session || null;
        state.user = data?.session?.user || null;
      } catch (_) {
        state.session = null;
        state.user = null;
      }
      await refreshUserFromServer();
      syncSvodFlagToLocalStorage();
      render();
    });

    return supabase;
  }

  async function refreshUserFromServer() {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const user = data?.user || null;
      state.user = user;
      if (state.session && user) state.session.user = user;
      return user;
    } catch (e) {
      console.warn("[WatchVIM] refreshUserFromServer failed:", e);
      return null;
    }
  }

  function currentMembershipInfo() {
    const u = state.user || state.session?.user || null;
    const um = u?.user_metadata || {};
    const am = u?.app_metadata || {};

    const plan =
      um.membership_plan || um.subscription_plan || um.plan || um.tier ||
      am.membership_plan || am.subscription_plan || am.plan || am.tier || null;

    const status =
      um.membership_status || um.subscription_status || um.status ||
      am.membership_status || am.subscription_status || am.status || null;

    const expiresAt =
      um.membership_expires_at || um.current_period_end || um.expires_at ||
      am.membership_expires_at || am.current_period_end || am.expires_at || null;

    return { plan, status, expiresAt };
  }

  function currentMembershipPlan() {
    const info = currentMembershipInfo() || {};
    const planFromMeta = info.plan || null;

    let planFromLS = null;
    try {
      planFromLS =
        localStorage.getItem("watchvim_membership_plan") ||
        localStorage.getItem("watchvim_membership") ||
        localStorage.getItem("membership_plan") ||
        localStorage.getItem("plan") ||
        null;
    } catch (_) {}

    return planFromMeta || planFromLS || null;
  }

  function isActiveSvodMember() {
    if (!state.user && !state.session?.user) return false;

    const { plan, status, expiresAt } = currentMembershipInfo();
    const mergedPlan = currentMembershipPlan() || plan || "";

    const p = String(mergedPlan || "").toUpperCase();
    const s = String(status || "").toUpperCase();

    if (p.includes("CANCEL")) return false;

    try {
      const flag = localStorage.getItem("watchvim_svod_active");
      if (flag && String(flag).toLowerCase() === "true") return true;
    } catch (_) {}

    const looksSvod = p.includes("SVOD") || p.includes("SUB") || p.includes("MONTH") || p.includes("ANNUAL");
    if (!looksSvod) return false;

    if (status) {
      const ok = ["ACTIVE", "TRIALING", "PAID"].includes(s);
      if (!ok) return false;
    }

    if (expiresAt) {
      const t = Date.parse(expiresAt);
      if (!Number.isNaN(t) && Date.now() > t) return false;
    }

    return true;
  }

  function syncSvodFlagToLocalStorage() {
    try {
      const info = currentMembershipInfo();
      const plan = String(info?.plan || "").toUpperCase();
      const status = String(info?.status || "").toUpperCase();

      const isExplicitCancel =
        plan.includes("CANCEL") || status === "CANCELED" || status === "CANCELLED";

      const prev = (localStorage.getItem("watchvim_svod_active") || "").toLowerCase() === "true";
      const activeNow = isActiveSvodMember();

      if (isExplicitCancel) {
        localStorage.setItem("watchvim_svod_active", "false");
      } else if (activeNow) {
        localStorage.setItem("watchvim_svod_active", "true");
      } else {
        localStorage.setItem("watchvim_svod_active", prev ? "true" : "false");
      }

      const p = currentMembershipPlan();
      if (p) localStorage.setItem("watchvim_membership_plan", String(p));
    } catch (_) {}
  }

  async function signIn(email, password) {
    const client = await initSupabaseIfPossible();
    if (!client) return alert("Auth not configured.");

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);

    await refreshUserFromServer();
    syncSvodFlagToLocalStorage();
    navTo("#/home");
  }

  async function signUp(email, password, fullName, membershipPlan, avatarId) {
    const client = await initSupabaseIfPossible();
    if (!client) {
      const error = new Error("Auth not configured.");
      alert(error.message);
      return { error };
    }

    const safeAvatar = (avatarId && AVATAR_PRESETS.includes(avatarId)) ? avatarId : "ember";

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || "",
          membership_plan: membershipPlan || "tvod-only",
          avatar_id: safeAvatar
        },
        emailRedirectTo: window.location.origin + "/#/login?mode=login"
      }
    });

    if (error) {
      alert(error.message);
      return { error };
    }

    await refreshUserFromServer();
    syncSvodFlagToLocalStorage();
    return { data };
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    try { localStorage.setItem("watchvim_svod_active", "false"); } catch (_) {}
    navTo("#/home");
  }

  async function updateProfileAvatar(avatarId) {
    const client = await initSupabaseIfPossible();
    if (!client) return alert("Auth not configured.");
    const safeAvatar = (avatarId && AVATAR_PRESETS.includes(avatarId)) ? avatarId : "ember";

    try {
      const { error } = await client.auth.updateUser({
        data: { avatar_id: safeAvatar }
      });
      if (error) throw error;

      await refreshUserFromServer();
      render();
    } catch (e) {
      alert(e?.message || "Failed to update avatar.");
    }
  }

  // =========================================================
  // ROUTER
  // =========================================================
  function parseHash() {
    const hash = window.location.hash;
    if (!hash || hash === "#") return { name: "landing", params: {} };

    const raw = hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const parts = (path || "home").split("/").filter(Boolean);
    const query = Object.fromEntries(new URLSearchParams(qs || ""));

    if (parts[0] === "home") return { name: "home", params: { tab: query.tab || null } };
    if (parts[0] === "title" && parts[1]) return { name: "title", params: { id: parts[1] } };

    // series supports ?season=0 toggle
    if (parts[0] === "series" && parts[1]) {
      return { name: "series", params: { id: parts[1], season: query.season ?? null } };
    }

    if (parts[0] === "episode" && parts[1] && parts[2] && parts[3]) {
      return {
        name: "episode",
        params: {
          seriesId: parts[1],
          seasonIndex: parts[2],
          epIndex: parts[3],
          kind: query.kind || "content"
        }
      };
    }

    if (parts[0] === "watch" && parts[1]) return { name: "watch", params: { id: parts[1], kind: query.kind || "content" } };
    if (parts[0] === "loop") return { name: "loop", params: {} };
    if (parts[0] === "search") return { name: "search", params: {} };
    if (parts[0] === "login") return { name: "login", params: { mode: query.mode || "login" } };
    if (parts[0] === "profile") return { name: "profile", params: {} };

    // ✅ NEW: in-app branded checkout (keeps user on-site)
    if (parts[0] === "checkout") return { name: "checkout", params: { titleId: query.titleId || parts[1] || "" } };

    return { name: "home", params: { tab: query.tab || null } };
  }

  function navTo(hash) { location.hash = hash; }
  window.addEventListener("hashchange", () => render());

  function rememberBrowseLocation() {
    state.lastBrowseTab = state.activeTab || "Home";
    state.lastBrowseHash = location.hash || `#/home?tab=${encodeURIComponent(state.lastBrowseTab)}`;
  }

  function goBackToCatalog() {
    const fallback = `#/home?tab=${encodeURIComponent(state.lastBrowseTab || "Home")}`;
    navTo(state.lastBrowseHash || fallback);
  }

  function openDetails(id, type) {
    rememberBrowseLocation();
    const t = String(type || "").toLowerCase();
    if (t === "series") navTo(`#/series/${encodeURIComponent(id)}`);
    else navTo(`#/title/${encodeURIComponent(id)}`);
  }

  // =========================================================
  // ACCESS MODES + PAYWALL
  // =========================================================
  const ACCESS = Object.freeze({ AVOD: "AVOD", SVOD: "SVOD", TVOD: "TVOD", FREE: "FREE" });

  function isAvodTitle(t) {
    const monet = t?.monetization || {};
    return !!(
      monet.avod ||
      t?.avod === true ||
      String(t?.paywall || "").toUpperCase() === "AVOD" ||
      String(t?.access || "").toUpperCase() === "AVOD" ||
      (typeof t?.monetization === "string" && String(t?.monetization).toUpperCase().includes("AVOD"))
    );
  }

  function isSvodTitle(t) {
    const monet = t?.monetization || {};
    return !!(
      monet.svod ||
      String(t?.paywall || "").toUpperCase() === "SVOD" ||
      String(t?.access || "").toUpperCase() === "SVOD"
    );
  }

  function hasTvod(t) {
    const monet = t?.monetization || {};
    const tvod = monet?.tvod || {};
    return !!(tvod.enabled || tvod.price != null || tvod.rentPrice != null || tvod.buyPrice != null);
  }

  function isTVODUnlockedForTitle(title) {
    const id = title?.id || title?.title_id || title?.slug || title?.key || "";
    if (!id) return false;

    const purchased = state.user?.user_metadata?.purchased_titles || [];
    if (Array.isArray(purchased) && purchased.includes(id)) return true;

    try {
      const v = localStorage.getItem(`watchvim_tvod_unlocked_${id}`);
      return String(v || "").toLowerCase() === "true";
    } catch (_) {
      return false;
    }
  }

  function checkAccessForPlayback(t) {
    const monet = t?.monetization || {};
    const tvod = monet?.tvod || {};
    const isAVOD = isAvodTitle(t);
    const isSVOD = isSvodTitle(t);
    const hasTVODFlag = !!tvod.enabled || hasTvod(t);

    if (!isAVOD && !isSVOD && !hasTVODFlag) return { allowed: true, adMode: "none" };

    if (isAVOD) {
      if (isSVOD && isActiveSvodMember()) return { allowed: true, adMode: "none" };
      return { allowed: true, adMode: "avod" };
    }

    if (isSVOD) {
      if (!state.user) {
        return {
          allowed: false, adMode: "none", reason: "login",
          message: "This title is available with a WatchVIM membership. Please log in or create an account to continue."
        };
      }
      if (!isActiveSvodMember()) {
        return {
          allowed: false, adMode: "none", reason: "upgrade",
          message: "Your account does not have an active streaming membership. Upgrade your plan to watch this title."
        };
      }
      return { allowed: true, adMode: "none" };
    }

    if (hasTVODFlag) {
      if (!state.user) return { allowed: false, adMode: "none", reason: "login", message: "Please log in to rent or buy this title." };
      if (isTVODUnlockedForTitle(t)) return { allowed: true, adMode: "none" };
      return {
        allowed: false, adMode: "none", reason: "tvod",
        message: "This title is available as a rental or purchase. Rent or buy it to unlock playback."
      };
    }

    return { allowed: true, adMode: "none" };
  }

  function showPaywallModal({ title = "Restricted", message = "", actions = [] } = {}) {
    const backdrop = document.createElement("div");
    backdrop.className = "wv-modal-backdrop";
    backdrop.innerHTML = `
      <div class="wv-modal">
        <header>
          <div style="font-weight:800;font-size:16px;">${esc(title)}</div>
          <div style="opacity:.7;font-size:12px;margin-top:4px;">${esc(message)}</div>
        </header>
        <div class="body">
          <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;">
            ${actions.map((a, i) => `
              <button class="wv-btn ${a.primary ? "wv-btn-primary" : ""}" data-act="${i}">${esc(a.label || "OK")}</button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => { try { backdrop.remove(); } catch (_) {} };

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    backdrop.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-act"));
        const act = actions[idx];
        try { act?.onClick?.(); } catch (_) {}
        close();
      });
    });

    return close;
  }

  // =========================================================
  // ADS (Google IMA via VAST) + GLOBAL AD POD
  // =========================================================
  async function ensureImaLoaded() {
    if (window.google?.ima) return true;
    try {
      await loadScript("https://imasdk.googleapis.com/js/sdkloader/ima3.js");
      return !!window.google?.ima;
    } catch (e) {
      console.warn("[WatchVIM] Failed to load Google IMA SDK", e);
      return false;
    }
  }

  function ensureRelativePosition(el) {
    if (!el) return;
    const pos = window.getComputedStyle(el).position;
    if (!pos || pos === "static") el.style.position = "relative";
  }

  function findVideoInContainer(container) {
    if (!container) return null;
    const mux = container.querySelector("mux-player");
    if (mux) {
      try { const v = mux.shadowRoot?.querySelector("video"); if (v) return v; } catch (_) {}
      try { if (mux.media) return mux.media; } catch (_) {}
    }
    return container.querySelector("video") || null;
  }

  function pauseContentAudio(containerEl) {
    const mux = containerEl?.querySelector?.("mux-player") || null;
    const video = findVideoInContainer(containerEl);

    const snap = { wasPaused: true, muted: null, volume: null };

    try { if (mux && typeof mux.pause === "function") mux.pause(); } catch (_) {}

    if (video) {
      try { snap.wasPaused = !!video.paused; } catch (_) {}
      try { snap.muted = video.muted; } catch (_) {}
      try { snap.volume = video.volume; } catch (_) {}
      try { video.muted = true; } catch (_) {}
      try { video.volume = 0; } catch (_) {}
      try { video.pause(); } catch (_) {}
    }

    return function restore() {
      const mux2 = containerEl?.querySelector?.("mux-player") || null;
      const v2 = findVideoInContainer(containerEl);

      if (v2) {
        try { if (snap.muted !== null) v2.muted = snap.muted; } catch (_) {}
        try { if (snap.volume !== null) v2.volume = snap.volume; } catch (_) {}
        if (snap.wasPaused === false) { try { v2.play().catch(() => {}); } catch (_) {} }
      }

      if (mux2 && snap.wasPaused === false && typeof mux2.play === "function") {
        try { mux2.play().catch(() => {}); } catch (_) {}
      }
    };
  }

  function getCatalogAdvertising() {
    return state.catalog?.advertising || state.catalog?.ads || {};
  }

  function buildAdConfig(base, { forceAvod = false } = {}) {
    if (!base) return null;

    const isAVOD = isAvodTitle(base);
    const isSVOD = isSvodTitle(base);
    const hasTVODFlag = hasTvod(base);

    // Only ads for AVOD (or forced)
    if ((!isAVOD && !forceAvod) || hasTVODFlag) return null;
    if (isSVOD && !isAVOD && !forceAvod) return null;

    const adv = base.advertising || base.ads || {};
    const globalAdv = getCatalogAdvertising();

    const preTag = pickFirstString(
      adv.preRollVastTag, adv.preRollTag, adv.prerollTag, adv.preroll_vast,
      base.preRollVastTag, base.preRollTag, base.vastTag, base.vast,
      globalAdv.preRollVastTag, globalAdv.preRollTag, globalAdv.prerollTag, globalAdv.vastTag, globalAdv.vast,
      CONFIG.VAST_TAG
    );

    const midTag = pickFirstString(
      adv.midRollVastTag, adv.midRollTag, adv.midrollTag, adv.midroll_vast,
      base.midRollVastTag, base.midRollTag,
      globalAdv.midRollVastTag, globalAdv.midRollTag, globalAdv.midrollTag,
      CONFIG.VAST_TAG
    );

    const midEveryMins =
      numOrNull(adv.midRollEveryMins) ??
      numOrNull(adv.midrollEveryMins) ??
      numOrNull(adv.midRollIntervalMins) ??
      numOrNull(adv.midrollIntervalMins) ??
      numOrNull(globalAdv.midRollEveryMins) ??
      numOrNull(globalAdv.midRollIntervalMins) ??
      null;

    const runtimeMins = Number(base.runtimeMins || base.runtime || 0);
    const midSecondsExplicit = Number(adv.midRollTimeSec ?? adv.midrollTimeSec ?? NaN);
    const midMinutesExplicit = Number(adv.midRollTimeMins ?? adv.midrollTimeMins ?? NaN);
    const midPercentExplicit = Number(adv.midRollAtPercent ?? adv.midrollAtPercent ?? NaN);

    let midSeconds = null;
    if (Number.isFinite(midSecondsExplicit) && midSecondsExplicit > 0) midSeconds = midSecondsExplicit;
    else if (Number.isFinite(midMinutesExplicit) && midMinutesExplicit > 0) midSeconds = midMinutesExplicit * 60;
    else if (Number.isFinite(midPercentExplicit) && midPercentExplicit > 0 && runtimeMins > 0)
      midSeconds = runtimeMins * 60 * (midPercentExplicit / 100);
    else if (runtimeMins > 0) midSeconds = (runtimeMins * 60) / 2;

    const midDurationSec =
      Number(adv.midRollDurationSec ?? adv.midrollDurationSec ?? globalAdv.midRollDurationSec ?? 15) || 15;

    if (!preTag && !midTag) return null;

    return { preTag, midTag, midSeconds, midEveryMins: midEveryMins || null, midDurationSec };
  }

  // ---------- Global Ads Pod ----------
  function makeAdOverlay(mountEl = null) {
    const overlay = document.createElement("div");
    const isInPlayer = !!mountEl;

    if (isInPlayer) {
      ensureRelativePosition(mountEl);
      overlay.className = "wv-ad-overlay absolute inset-0 z-[9999] bg-black flex items-center justify-center";
    } else {
      overlay.className = "wv-ad-overlay fixed inset-0 z-[9999] bg-black flex items-center justify-center";
    }

    overlay.innerHTML = `
      <div class="w-full h-full flex flex-col">
        <div class="flex-1 relative" id="ad-stage"></div>
        <div class="p-3 text-center text-xs text-white/70" id="ad-label"></div>
      </div>
    `;

    (mountEl || document.body).appendChild(overlay);

    return {
      overlay,
      stage: overlay.querySelector("#ad-stage"),
      label: overlay.querySelector("#ad-label"),
      destroy() { try { overlay.remove(); } catch (_) {} }
    };
  }

  async function playGlobalAdPod(ads = [], { mountEl = null } = {}) {
    if (!ads?.length) return;

    const ui = makeAdOverlay(mountEl);

    const playOne = (ad) =>
      new Promise((resolve) => {
        ui.label.textContent = ad?.label ? `Ad: ${ad.label}` : "Advertisement";
        ui.stage.innerHTML = "";

        let el;

        if (ad.type === "mux" && ad.playbackId) {
          el = document.createElement("mux-player");
          el.setAttribute("playback-id", ad.playbackId);
          el.setAttribute("stream-type", "on-demand");
          el.setAttribute("playsinline", "");
          el.setAttribute("autoplay", "");
          el.setAttribute("muted", "");
          el.style.width = "100%";
          el.style.height = "100%";
          el.style.setProperty("--media-object-fit", "contain");
        } else if (ad.type === "url" && ad.src) {
          el = document.createElement("video");
          el.src = ad.src;
          el.autoplay = true;
          el.muted = true;
          el.playsInline = true;
          el.controls = false;
          el.style.width = "100%";
          el.style.height = "100%";
          el.style.objectFit = "contain";
        } else {
          resolve();
          return;
        }

        ui.stage.appendChild(el);

        const done = () => resolve();
        el.addEventListener("ended", done, { once: true });
        el.addEventListener("error", done, { once: true });

        setTimeout(done, 45_000);

        const tryPlay = async () => {
          try {
            if (typeof el.play === "function") await el.play();
          } catch {
            ui.label.textContent = "Tap to play ad…";
            ui.overlay.addEventListener(
              "click",
              async () => {
                try {
                  ui.label.textContent = ad?.label ? `Ad: ${ad.label}` : "Advertisement";
                  if (typeof el.play === "function") await el.play();
                } catch {}
              },
              { once: true }
            );
          }
        };

        tryPlay();
      });

    try {
      for (const ad of ads) await playOne(ad);
    } finally {
      ui.destroy();
    }
  }

  // ---------- IMA VAST runner ----------
  function removeTapToPlay(containerEl) {
    if (!containerEl) return;
    containerEl.querySelectorAll(".wv-tap-to-play").forEach((x) => x.remove());
  }

  function addTapToPlayFallback(containerEl) {
    if (!containerEl) return;
    if (containerEl.querySelector(".wv-ad-overlay")) return;

    const muxEl = containerEl.querySelector("mux-player");
    const vid = findVideoInContainer(containerEl);
    if (!muxEl && !vid) return;

    removeTapToPlay(containerEl);

    const btn = document.createElement("button");
    btn.className =
      "wv-tap-to-play absolute inset-x-0 bottom-6 mx-auto w-fit px-4 py-2 rounded-full text-white text-sm z-[10000]";
    btn.style.background = "var(--watch-accent,#e50914)";
    btn.textContent = "Tap to Play";
    containerEl.appendChild(btn);

    btn.addEventListener("click", async () => {
      try {
        const v = findVideoInContainer(containerEl);
        if (v?.play) await v.play();
      } catch (_) {}
      btn.remove();
    });
  }

  async function runVastAd(vastTag, containerEl, { onBeforeAd, onComplete } = {}) {
    if (!containerEl || !vastTag) return false;

    ensureRelativePosition(containerEl);
    removeTapToPlay(containerEl);

    const adDiv = document.createElement("div");
    adDiv.className = "wv-ad-overlay absolute inset-0 z-[99999] bg-black/90 flex items-center justify-center";
    containerEl.appendChild(adDiv);

    let cleanupCalled = false;
    const cleanup = (ok) => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      try { adDiv.remove(); } catch (_) {}
      try { onComplete && onComplete(!!ok); } catch (_) {}
    };

    const ok = await ensureImaLoaded();
    if (!ok) { cleanup(false); return false; }

    let tries = 0;
    const maxTries = 12;

    const initIMA = () => {
      tries++;

      const videoEl = findVideoInContainer(containerEl);
      if (!videoEl) {
        if (tries < maxTries) return setTimeout(initIMA, 250);
        logAds("No video element found for VAST ad.");
        cleanup(false);
        return;
      }

      try {
        const adDisplayContainer = new google.ima.AdDisplayContainer(adDiv, videoEl);
        const adsLoader = new google.ima.AdsLoader(adDisplayContainer);

        adsLoader.addEventListener(
          google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
          (e) => {
            let adsManager;
            try {
              adsManager = e.getAdsManager(videoEl);
            } catch (err) {
              logAds("getAdsManager failed", err);
              cleanup(false);
              return;
            }

            const AdEvent = google.ima.AdEvent.Type;

            adsManager.addEventListener(AdEvent.ALL_ADS_COMPLETED, () => cleanup(true));
            adsManager.addEventListener(AdEvent.CONTENT_RESUME_REQUESTED, () => cleanup(true));
            adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, (errEvt) => {
              logAds("Ad error", errEvt);
              cleanup(false);
            });

            try { onBeforeAd && onBeforeAd(videoEl); } catch (_) {}

            const w = containerEl.clientWidth || 640;
            const h = containerEl.clientHeight || 360;

            try { adDisplayContainer.initialize(); } catch (_) {}

            try {
              adsManager.init(w, h, google.ima.ViewMode.NORMAL);
              adsManager.start();
            } catch (err) {
              logAds("adsManager.start failed", err);
              cleanup(false);
            }
          },
          false
        );

        adsLoader.addEventListener(
          google.ima.AdErrorEvent.Type.AD_ERROR,
          (errEvt) => {
            logAds("AdsLoader error", errEvt);
            cleanup(false);
          },
          false
        );

        const adsRequest = new google.ima.AdsRequest();
        adsRequest.adTagUrl = vastTag;
        adsRequest.linearAdSlotWidth = containerEl.clientWidth || 640;
        adsRequest.linearAdSlotHeight = containerEl.clientHeight || 360;

        adsLoader.requestAds(adsRequest);

        setTimeout(() => cleanup(false), 20000);
      } catch (err) {
        logAds("VAST ad setup failed", err);
        cleanup(false);
      }
    };

    initIMA();
    return true;
  }

  // ---------- VOD: pre-roll + repeating mid-roll ----------
  function setupVodAds(adConfig, containerEl) {
    const { preTag, midTag, midSeconds, midEveryMins } = adConfig || {};
    if (!preTag && !midTag) return;

    const getVideo = (cb, attempt = 0) => {
      const v = findVideoInContainer(containerEl);
      if (v) return cb(v);
      if (attempt < 12) return setTimeout(() => getVideo(cb, attempt + 1), 250);
    };

    if (preTag) {
      getVideo((video) => {
        runVastAd(preTag, containerEl, {
          onBeforeAd: () => { try { video.pause(); } catch (_) {} },
          onComplete: () => { try { video.play().catch(() => {}); } catch (_) { addTapToPlayFallback(containerEl); } }
        });
      });
    }

    if (midTag) {
      getVideo((video) => {
        let lastFire = 0;
        let firedOnce = false;

        const every = Number(midEveryMins || 0);

        if (every >= 1) {
          const handler = () => {
            const now = Date.now();
            if (now - lastFire < every * 60 * 1000) return;
            if (!video.currentTime || video.currentTime < 15) return;

            lastFire = now;
            logAds(`VOD mid-roll firing every ${every} mins`);

            runVastAd(midTag, containerEl, {
              onBeforeAd: () => { try { video.pause(); } catch (_) {} },
              onComplete: () => { try { video.play().catch(() => {}); } catch (_) { addTapToPlayFallback(containerEl); } }
            });
          };

          const intervalId = setInterval(handler, 1000);
          video.addEventListener("ended", () => clearInterval(intervalId), { once: true });
          window.addEventListener("hashchange", () => clearInterval(intervalId), { once: true });
          return;
        }

        let triggerSec = midSeconds || null;

        const handler = () => {
          if (firedOnce) return;
          const dur = video.duration;
          if (!dur || !isFinite(dur)) return;

          if (triggerSec == null || triggerSec <= 0) triggerSec = dur / 2;

          if (video.currentTime >= triggerSec) {
            firedOnce = true;
            video.removeEventListener("timeupdate", handler);

            runVastAd(midTag, containerEl, {
              onBeforeAd: () => { try { video.pause(); } catch (_) {} },
              onComplete: () => { try { video.play().catch(() => {}); } catch (_) { addTapToPlayFallback(containerEl); } }
            });
          }
        };

        video.addEventListener("timeupdate", handler);
      });
    }
  }

  // =========================================================
  // ✅ AD ORDER PATCH HELPERS (VAST FIRST)
  // =========================================================
  async function playVastPrerollOnce(adConfig, containerEl) {
    const tag = adConfig?.preTag || "";
    if (!tag || !containerEl) return false;

    return await new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; resolve(!!ok); };

      const attemptStart = async () => {
        try {
          const v = findVideoInContainer(containerEl);
          const started = await runVastAd(tag, containerEl, {
            onBeforeAd: () => { try { v && v.pause(); } catch (_) {} },
            onComplete: () => {
              try {
                const v2 = findVideoInContainer(containerEl);
                if (v2?.play) v2.play().catch(() => {});
              } catch (_) { addTapToPlayFallback(containerEl); }
              finish(true);
            }
          });

          if (!started) finish(false);
        } catch (_) {
          finish(false);
        }
      };

      attemptStart();
      setTimeout(() => finish(false), 25000);
    });
  }

  // Global Ads + VAST orchestration
  async function playWithAdsIfNeeded({ containerEl, isAvod, isLive, adConfig }) {
    if (!containerEl) return;

    // ✅ VAST FIRST for AVOD + LIVE
    if ((isAvod || isLive) && adConfig?.preTag) {
      try {
        logAds("VAST preroll (FIRST)");
        await playVastPrerollOnce(adConfig, containerEl);
        adConfig = { ...(adConfig || {}), preTag: "" }; // avoid double-firing
      } catch (_) {}
    }

    const shouldPlayGlobal =
      (isAvod && CONFIG.PLAY_GLOBAL_ADS_ON_AVOD) || (isLive && CONFIG.PLAY_GLOBAL_ADS_ON_LIVE);

    if (shouldPlayGlobal && Array.isArray(CONFIG.GLOBAL_ADS) && CONFIG.GLOBAL_ADS.length) {
      let restore = null;
      try {
        restore = pauseContentAudio(containerEl);
        logAds("Playing GLOBAL_ADS pod (in-player)");
        await playGlobalAdPod(CONFIG.GLOBAL_ADS, { mountEl: containerEl });
      } finally {
        try { restore && restore(); } catch (_) {}
      }
    }

    // Setup remaining VAST (mid-roll, or preroll if it wasn't run above)
    if (adConfig && (adConfig.preTag || adConfig.midTag)) {
      setupVodAds(adConfig, containerEl);
    }
  }

  // =========================================================
  // PLAYER MOUNT
  // =========================================================
  function mountPlayer({ playbackId, directUrl, streamType = "on-demand", wrapId = "playerWrap" }) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;

    ensureRelativePosition(wrap);

    const muxId = wrapId === "playerWrap" ? "muxPlayer" : `muxPlayer_${wrapId}`;
    const htmlId = wrapId === "playerWrap" ? "html5Player" : `html5Player_${wrapId}`;

    wrap.innerHTML = playbackId
      ? `
        <mux-player
          id="${muxId}"
          stream-type="${esc(streamType)}"
          playback-id="${esc(playbackId)}"
          metadata-video-title="WatchVIM"
          controls
          autoplay
          playsinline
          style="width:100%;height:100%;display:block;--media-object-fit:contain;--media-object-position:center;"
        ></mux-player>
      `
      : `
        <video
          id="${htmlId}"
          controls
          autoplay
          playsinline
          webkit-playsinline
          style="width:100%;height:100%;display:block;object-fit:contain;background:#000;"
        >
          <source src="${esc(directUrl || "")}" type="video/mp4" />
        </video>
      `;
  }

  // =========================================================
  // SHELL
  // =========================================================
  function Header() {
    const tabs = ["Home", "Movies", "Series", "Shorts", "Foreign", "LIVE", "Search"];
    const loggedIn = !!state.user;
    const avatar = loggedIn ? userAvatarUrl(state.user) : "";

    return `
      <header class="sticky top-0 z-30 bg-black/95 backdrop-blur border-b border-white/10">
        <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button class="flex items-center gap-2" onclick="setTab('Home')" aria-label="Go home">
            <img
              id="appLogo"
              src="${esc(CONFIG.LOGO_URL)}"
              alt="WatchVIM"
              class="h-8 w-auto object-contain"
              onerror="this.onerror=null;this.style.display='none';document.getElementById('logoFallback').classList.remove('hidden');"
            />
            <span id="logoFallback" class="hidden text-lg font-black tracking-wide">WatchVIM</span>
          </button>

          <nav class="hidden md:flex ml-6 gap-2 text-sm">
            ${tabs.map((tab) => `
              <button
                class="tv-focus px-3 py-1.5 rounded-full ${state.activeTab === tab ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10"}"
                onclick="${tab === "Search" ? "navTo('#/search')" : `setTab('${tab}')`}"
              >${tab}</button>
            `).join("")}
          </nav>

          <div class="ml-auto flex gap-2 text-xs md:text-sm">
            ${
              loggedIn
                ? `
                  <button class="tv-focus px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-2" onclick="navTo('#/profile')">
                    <span class="wv-avatar"><img src="${esc(avatar)}" alt="Avatar"/></span>
                    <span>Profile</span>
                  </button>
                  <button class="tv-focus px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="signOut()">Log out</button>
                `
                : `
                  <button class="tv-focus px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="navTo('#/login?mode=login')">Log in</button>
                  <button class="tv-focus px-3 py-1.5 rounded-lg font-bold hover:opacity-90"
                    style="background:var(--watch-accent,#e50914);"
                    onclick="navTo('#/login?mode=signup')">Become a Member</button>
                `
            }
          </div>
        </div>
      </header>
    `;
  }

  // Footer links wired to static pages
  function SiteFooter() {
    const year = new Date().getFullYear();
    return `
      <footer class="wv-footer mt-10 border-t border-white/10 bg-black/95" style="background:rgba(0,0,0,.95);width:100%;">
        <div class="max-w-6xl mx-auto px-4 md:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-white/60">
          <div>© ${year} WatchVIM</div>
          <div class="flex items-center gap-4">
            <a class="tv-focus hover:text-white" href="/privacy.html">Privacy</a>
            <a class="tv-focus hover:text-white" href="/refund.html">Refund</a>
            <a class="tv-focus hover:text-white" href="/terms.html">Terms</a>
            <a class="tv-focus hover:text-white" href="/contact.html">Contact</a>
          </div>
        </div>
      </footer>
    `;
  }

  function MobileTabBar() {
    if (!isMobile()) return "";
    const items = ["Home", "Movies", "Series", "Shorts", "Foreign", "LIVE"];
    return `
      <footer class="wv-mobilebar fixed bottom-0 left-0 right-0 bg-black/95 border-t border-white/10" style="background:rgba(0,0,0,.95);width:100%;">
        <div class="max-w-6xl mx-auto flex justify-around px-2 py-2">
          ${items.map((tab) => `
            <button
              class="tv-focus flex-1 mx-1 py-2 rounded-lg text-[11px] ${state.activeTab === tab ? "bg-white text-black font-semibold" : "bg-white/10 text-white/80"}"
              onclick="setTab('${tab}')"
            >${tab}</button>
          `).join("")}
        </div>
      </footer>
    `;
  }

  function setTab(tab) {
    state.activeTab = tab;
    if (tab === "LIVE") navTo("#/loop");
    else navTo(`#/home?tab=${encodeURIComponent(tab)}`);
  }

  // =========================================================
  // HERO CAROUSEL
  // =========================================================
  let heroCarouselIndex = 0;
  let heroCarouselTimer = null;

  function HeroSection(items) {
    if (!items.length) return "";

    const slidesHtml = items.map((t, idx) => {
      const img = heroImageForHeroItem(t);
      const trailerPb = heroTrailerIdForHeroItem(t);
      const hasTrailer = !!trailerPb;
      const titleText = heroTitleForHeroItem(t);
      const synopsisText = heroSynopsisForHeroItem(t);
      const titleLogo = normalizeMediaUrl(firstUrl(t.__hero_titleLogoUrl));
      const type = t.type;

      return `
        <div class="hero-slide absolute inset-0 ${idx === 0 ? "" : "hidden"}" data-hero-slide="${idx}">
          <div class="w-full h-full relative">
            <div class="w-full h-full" data-hero-stage="1">
              ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover" />` : ""}
              <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
              <div class="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 via-transparent to-transparent"></div>
            </div>

            ${
              hasTrailer
                ? `
                  <button
                    class="tv-focus absolute inset-0 flex items-center justify-center group"
                    onclick="navTo('#/watch/${t.id}?kind=trailer')"
                    data-hero-hover="${esc(trailerPb)}"
                    aria-label="Play trailer preview"
                  >
                    <div class="w-14 h-14 md:w-16 md:h-16 rounded-full bg-black/60 border border-white/40 flex items-center justify-center text-2xl md:text-3xl group-hover:scale-105 transition-transform">
                      ▶
                    </div>
                  </button>
                `
                : ""
            }

            <div class="absolute left-0 right-0 bottom-0 p-4 md:p-8">
              <div class="max-w-3xl space-y-2 md:space-y-3">
                <div class="text-[10px] md:text-xs uppercase tracking-[0.2em] text-[color:var(--watch-gold,#d4af37)]/90">
                  ${typeLabel(type)}
                </div>

                ${
                  titleLogo
                    ? `<img src="${esc(titleLogo)}" alt="${esc(titleText)}" class="h-10 md:h-14 w-auto object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.75)]" />`
                    : `<h1 class="text-xl md:text-4xl font-black leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">${esc(titleText)}</h1>`
                }

                <p class="text-xs md:text-sm text-white/80 line-clamp-3 md:line-clamp-4">${esc(synopsisText)}</p>

                <div class="flex flex-wrap gap-2 text-[10px] md:text-xs text-white/70">
                  ${t.releaseYear ? `<span class="px-2 py-1 rounded bg-black/60 border border-white/10">${esc(t.releaseYear)}</span>` : ""}
                  ${toMins(t.runtimeMins) ? `<span class="px-2 py-1 rounded bg-black/60 border border-white/10">${toMins(t.runtimeMins)} mins</span>` : ""}
                  ${(t.genre || []).slice(0, 4).map((g) => `<span class="px-2 py-1 rounded bg-black/60 border border-white/10">${esc(g)}</span>`).join("")}
                </div>

                <div class="pt-1 md:pt-2 flex flex-wrap gap-2">
                  <button
                    class="tv-focus px-4 py-2 rounded-lg font-bold text-xs md:text-sm hover:opacity-90"
                    style="background:var(--watch-accent,#e50914);"
                    onclick="openDetails('${esc(t.id)}','${esc(t.type)}')"
                  >View Details</button>

                  ${
                    hasTrailer
                      ? `
                        <button
                          class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs md:text-sm"
                          onclick="navTo('#/watch/${t.id}?kind=trailer')"
                        >Play Trailer</button>
                      `
                      : ""
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    const dotsHtml =
      items.length > 1
        ? `
          <div class="absolute bottom-3 right-4 flex gap-1">
            ${items.map((_t, idx) => `
              <button
                class="hero-dot w-2.5 h-2.5 rounded-full border border-white/40 ${idx === 0 ? "bg-white" : "bg-transparent"}"
                data-hero-dot="${idx}"
                aria-label="Go to slide ${idx + 1}"
              ></button>
            `).join("")}
          </div>
        `
        : "";

    const arrowsHtml =
      items.length > 1
        ? `
          <button id="heroPrev" class="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 items-center justify-center border border-white/30" aria-label="Previous">‹</button>
          <button id="heroNext" class="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 items-center justify-center border border-white/30" aria-label="Next">›</button>
        `
        : "";

    return `
      <section class="relative w-full overflow-hidden">
        <div class="relative aspect-[16/9] sm:aspect-[4/3] md:aspect-video lg:aspect-[21/9] bg-black">
          ${slidesHtml}
          ${arrowsHtml}
          ${dotsHtml}
        </div>
      </section>
    `;
  }

  function showHeroSlide(index) {
    const slides = Array.from(document.querySelectorAll(".hero-slide"));
    const dots = Array.from(document.querySelectorAll(".hero-dot"));
    if (!slides.length) return;

    const count = slides.length;
    heroCarouselIndex = ((index % count) + count) % count;

    slides.forEach((el, i) => {
      if (i === heroCarouselIndex) el.classList.remove("hidden");
      else el.classList.add("hidden");
    });

    dots.forEach((d, i) => {
      if (i === heroCarouselIndex) d.classList.add("bg-white");
      else d.classList.remove("bg-white");
    });
  }

  function setupHeroCarousel(count) {
    if (heroCarouselTimer) { clearInterval(heroCarouselTimer); heroCarouselTimer = null; }
    if (!count || count <= 1) return;

    showHeroSlide(heroCarouselIndex || 0);

    const prev = document.getElementById("heroPrev");
    const next = document.getElementById("heroNext");
    if (prev) prev.onclick = () => showHeroSlide(heroCarouselIndex - 1);
    if (next) next.onclick = () => showHeroSlide(heroCarouselIndex + 1);

    document.querySelectorAll(".hero-dot").forEach((dot) => {
      const idx = Number(dot.getAttribute("data-hero-dot") || "0");
      dot.onclick = () => showHeroSlide(idx);
    });

    heroCarouselTimer = setInterval(() => showHeroSlide(heroCarouselIndex + 1), 8000);
  }

  // ✅ Hero hover trailer preview (cover)
  function wireHeroHover() {
    if (isTV()) return;

    document.querySelectorAll("[data-hero-hover]").forEach((btn) => {
      const pb = btn.getAttribute("data-hero-hover");
      const slide = btn.closest(".hero-slide");
      const stage = slide?.querySelector?.('[data-hero-stage="1"]') || slide || btn;
      if (!pb || !slide || !stage) return;

      let previewEl = null;
      let timer = null;

      btn.addEventListener("mouseenter", () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (previewEl) return;

          const imgEl = slide.querySelector("img");
          if (imgEl) imgEl.classList.add("hidden");

          previewEl = document.createElement("mux-player");
          previewEl.setAttribute("stream-type", "on-demand");
          previewEl.setAttribute("playback-id", pb);
          previewEl.setAttribute("muted", "");
          previewEl.setAttribute("autoplay", "");
          previewEl.setAttribute("loop", "");
          previewEl.setAttribute("playsinline", "");
          previewEl.className = "wv-hero-preview";

          try {
            previewEl.style.setProperty("--media-object-fit", "cover");
            previewEl.style.setProperty("--media-object-position", "center");
          } catch (_) {}

          stage.insertBefore(previewEl, stage.firstChild);
        }, 250);
      });

      btn.addEventListener("mouseleave", () => {
        if (timer) clearTimeout(timer);
        if (previewEl) {
          previewEl.remove();
          previewEl = null;
          const imgEl = slide.querySelector("img");
          if (imgEl) imgEl.classList.remove("hidden");
        }
      });
    });
  }

  function wireRowScrolling() {
    document.querySelectorAll(".row-scroll").forEach((row) => {
      if (row.__wheelWired) return;
      row.__wheelWired = true;

      row.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          row.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      }, { passive: false });
    });
  }

  // =========================================================
  // PAGES
  // =========================================================
  function LandingPage() {
    return `
      <section class="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 md:px-8">
        <div class="max-w-6xl mx-auto grid md:grid-cols-2 gap-8 items-center">
          <div class="space-y-5 text-center md:text-left">
            <div class="inline-flex items-center gap-3">
              <img src="${esc(CONFIG.LOGO_URL)}" alt="WatchVIM" class="h-10 md:h-12 w-auto object-contain mx-auto md:mx-0"
                onerror="this.onerror=null;this.style.display='none';" />
              <span class="hidden md:inline text-[11px] uppercase tracking-[0.25em] text-[color:var(--watch-gold,#d4af37)]/80">Streaming Platform</span>
            </div>

            <h1 class="text-3xl md:text-5xl font-black leading-tight">
              Cinema. Culture. <br><span class="text-[color:var(--watch-gold,#d4af37)]">On Demand.</span>
            </h1>

            <p class="text-white/70 text-sm md:text-base max-w-xl mx-auto md:mx-0">
              WatchVIM brings films, series, and original stories together in one sleek destination.
              Stream free with ads, subscribe for ad-free access, or rent selected titles.
            </p>

            <div class="flex flex-col sm:flex-row gap-3 pt-1 justify-center md:justify-start">
              <button class="tv-focus px-6 py-3 rounded-full font-bold text-sm md:text-base hover:opacity-90"
                style="background:var(--watch-accent,#e50914);"
                onclick="navTo('#/home')">Enter WatchVIM</button>

              <button class="tv-focus px-6 py-3 rounded-full bg-white/5 border border-white/15 text-xs md:text-sm hover:bg-white/10"
                onclick="navTo('#/login?mode=signup')">Become a Member</button>
            </div>

            <div class="pt-3 text-[11px] md:text-xs text-white/50">
              Browse the catalog without logging in. Create an account when you’re ready.
            </div>
          </div>

          <div class="w-full">
            <div class="relative aspect-[9/16] md:aspect-video rounded-3xl overflow-hidden border border-white/10 bg-black shadow-2xl">
              <mux-player
                id="landingPromoPlayer"
                class="w-full h-full"
                stream-type="on-demand"
                playback-id="${esc(PROMO_PLAYBACK_ID)}"
                muted
                autoplay
                loop
                playsinline
                style="--media-object-fit: cover; --media-object-position: center;"
              ></mux-player>
              <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function tileCard(t) {
    const p = poster(t);
    return `
      <button class="tv-focus text-left w-[140px] md:w-[170px] flex-none" onclick="openDetails('${esc(t.id)}','${esc(t.type)}')">
        <div class="rounded-xl overflow-hidden border border-white/10 bg-white/5">
          <div class="aspect-[2/3] bg-black">
            ${p ? `<img src="${esc(p)}" class="w-full h-full object-cover" loading="lazy" />` : ""}
          </div>
        </div>
        <div class="mt-2 text-xs md:text-sm font-semibold line-clamp-1">${esc(t.title || "Untitled")}</div>
        <div class="text-[11px] text-white/60 line-clamp-1">${esc(typeLabel(t.type))}${t.releaseYear ? ` • ${esc(t.releaseYear)}` : ""}</div>
      </button>
    `;
  }

  function rowBlock(label, items) {
    if (!items?.length) return "";
    return `
      <section class="mt-6">
        <div class="px-4 md:px-8 max-w-6xl mx-auto flex items-center justify-between">
          <div class="text-sm md:text-base font-black">${esc(label)}</div>
        </div>
        <div class="px-4 md:px-8 max-w-6xl mx-auto mt-3">
          <div class="row-scroll flex gap-3 overflow-x-auto py-1">
            ${items.map(tileCard).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function moreLikeThisGroupType(type) {
    const t = String(type || "").toLowerCase();
    if (t === "films" || t === "documentaries") return ["films", "documentaries"];
    return [t || "films"];
  }

  function getMoreLikeThisItems(baseTitle, limit = 24) {
    if (!baseTitle) return [];
    const baseGenres = (baseTitle.genre || []).map((g) => String(g || "").toLowerCase()).filter(Boolean);
    const group = moreLikeThisGroupType(baseTitle.type);

    const candidates = state.titles
      .filter((t) => t && t.id && t.id !== baseTitle.id)
      .filter((t) => group.includes(String(t.type || "").toLowerCase()));

    const scored = candidates.map((t) => {
      let score = 0;

      const tGenres = (t.genre || []).map((g) => String(g || "").toLowerCase());
      for (const g of tGenres) if (baseGenres.includes(g)) score += 3;

      const by = Number(baseTitle.releaseYear || 0);
      const ty = Number(t.releaseYear || 0);
      if (by && ty && Math.abs(by - ty) <= 2) score += 1;

      if (String(t.language || "").toLowerCase() && String(baseTitle.language || "").toLowerCase()) {
        if (String(t.language).toLowerCase() === String(baseTitle.language).toLowerCase()) score += 1;
      }

      return { t, score };
    });

    scored.sort((a, b) => b.score - a.score);

    let out = scored.filter((x) => x.score > 0).slice(0, limit).map((x) => x.t);

    if (out.length < limit) {
      const picked = new Set(out.map((x) => x.id));
      const fillers = candidates.filter((x) => !picked.has(x.id)).slice(0, limit - out.length);
      out = out.concat(fillers);
    }

    return out.slice(0, limit);
  }

  function MoreLikeThisSection(baseTitle) {
    const items = getMoreLikeThisItems(baseTitle, 24);
    if (!items.length) return "";
    return `
      <section class="mt-10">
        <div class="px-4 md:px-8 max-w-6xl mx-auto flex items-center justify-between">
          <div class="text-sm md:text-base font-black">More Like This</div>
        </div>
        <div class="px-4 md:px-8 max-w-6xl mx-auto mt-3">
          <div class="row-scroll flex gap-3 overflow-x-auto py-1">
            ${items.map(tileCard).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function HomePage() {
    const tab = state.route.params?.tab || state.activeTab || "Home";
    if (tab && tab !== state.activeTab) state.activeTab = tab;

    const all = state.titles.slice();
    const movies = all.filter(TAB_FILTERS.Movies);
    const series = all.filter(TAB_FILTERS.Series);
    const shorts = all.filter(TAB_FILTERS.Shorts);
    const foreign = all.filter(TAB_FILTERS.Foreign);

    const filterFn = TAB_FILTERS[tab] || TAB_FILTERS.Home;
    const tabItems = all.filter(filterFn);

    // ✅ Hero filtered by tab
    let heroItems = sortFeatured(featuredItems());
    if (tab && tab !== "Home") {
      heroItems = heroItems.filter(filterFn);
      if (!heroItems.length) heroItems = tabItems.slice(0, 10);
    }
    heroItems = heroItems.slice(0, 10);

    const bodyRows = tab === "Home"
      ? [
          rowBlock("Trending Now", all.slice(0, 20)),
          rowBlock("Movies & Docs", movies.slice(0, 20)),
          rowBlock("Series", series.slice(0, 20)),
          rowBlock("Shorts (Quick Watches)", shorts.slice(0, 20)),
          rowBlock("Foreign & International", foreign.slice(0, 20))
        ].join("")
      : rowBlock(tab, tabItems.slice(0, 60));

    return `
      ${HeroSection(heroItems)}
      <main class="pb-28 md:pb-10">
        ${bodyRows}
      </main>
    `;
  }

  function CreditsBlock(t) {
    const actors = (t.actors || t.cast || []).join?.(", ") || t.actors || t.cast || "";
    const director = (t.director || t.directors || "").toString();
    const writers = (t.writers || t.writer || []).join?.(", ") || t.writers || t.writer || "";
    const imdb = t.imdbRating || t.ratings?.imdb || "";
    const rt = t.rottenTomatoesRating || t.ratings?.rottenTomatoes || "";

    if (!actors && !director && !writers && !imdb && !rt) return "";
    return `
      <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        ${actors ? `<div><div class="text-xs text-white/60">Actors</div><div>${esc(actors)}</div></div>` : ""}
        ${director ? `<div><div class="text-xs text-white/60">Director</div><div>${esc(director)}</div></div>` : ""}
        ${writers ? `<div><div class="text-xs text-white/60">Writers</div><div>${esc(writers)}</div></div>` : ""}
        ${
          imdb || rt
            ? `<div class="flex gap-2 items-end">
                ${imdb ? `<span class="px-2 py-1 rounded bg-white/10 text-xs">IMDb: <b>${esc(imdb)}</b></span>` : ""}
                ${rt ? `<span class="px-2 py-1 rounded bg-white/10 text-xs">Rotten Tomatoes: <b>${esc(rt)}</b></span>` : ""}
              </div>`
            : ""
        }
      </div>
    `;
  }

  function TitleDetailPage(id) {
    const t = state.byId.get(String(id));
    if (!t) return notFound("Title not found");

    const h = hero(t);
    const p = poster(t);
    const access = checkAccessForPlayback(t);

    return `
      <main class="pb-28 md:pb-10">
        <section class="relative">
          <button
            class="wv-btn absolute top-4 left-4 z-20"
            style="background:rgba(0,0,0,.55);border-color:rgba(255,255,255,.18);backdrop-filter:blur(10px);"
            onclick="goBackToCatalog()"
          >← Back</button>

          <div class="aspect-[16/9] md:aspect-[21/9] bg-black">
            ${h ? `<img src="${esc(h)}" class="w-full h-full object-cover" />` : ""}
          </div>
          <div class="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent"></div>

          <div class="max-w-6xl mx-auto px-4 md:px-8 -mt-24 md:-mt-28 relative">
            <div class="flex gap-4 md:gap-6 items-end">
              <div class="w-28 md:w-40 flex-none">
                <div class="rounded-2xl overflow-hidden border border-white/10 bg-white/5">
                  <div class="aspect-[2/3] bg-black">
                    ${p ? `<img src="${esc(p)}" class="w-full h-full object-cover" />` : ""}
                  </div>
                </div>
              </div>

              <div class="flex-1 pb-2">
                <div class="text-[10px] md:text-xs uppercase tracking-[0.2em] text-[color:var(--watch-gold,#d4af37)]/90">${esc(typeLabel(t.type))}</div>
                <h1 class="text-2xl md:text-4xl font-black leading-tight">${esc(t.title || "Untitled")}</h1>
                <div class="mt-2 text-xs md:text-sm text-white/70 line-clamp-3">${esc(t.synopsis || t.description || "")}</div>

                <div class="mt-3 flex flex-wrap gap-2 text-[11px] md:text-xs text-white/70">
                  ${t.releaseYear ? `<span class="px-2 py-1 rounded bg-white/10">${esc(t.releaseYear)}</span>` : ""}
                  ${toMins(t.runtimeMins) ? `<span class="px-2 py-1 rounded bg-white/10">${toMins(t.runtimeMins)} mins</span>` : ""}
                  ${(t.genre || []).slice(0, 4).map((g) => `<span class="px-2 py-1 rounded bg-white/10">${esc(g)}</span>`).join("")}
                </div>

                <div class="mt-4 flex flex-wrap gap-2">
                  <button class="tv-focus px-4 py-2 rounded-xl font-bold text-sm hover:opacity-90"
                    style="background:var(--watch-accent,#e50914);"
                    onclick="startPlayback('${esc(t.id)}','content')">Play</button>

                  ${t.trailerPlaybackId ? `
                    <button class="tv-focus px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm"
                      onclick="startPlayback('${esc(t.id)}','trailer')">Trailer</button>
                  ` : ""}

                  ${
                    access.allowed === false && access.reason === "tvod"
                      ? `<button class="tv-focus px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm"
                          onclick="startTVODCheckout('${esc(t.id)}')">Rent / Buy</button>`
                      : ""
                  }
                </div>

                ${CreditsBlock(t)}
              </div>
            </div>
          </div>
        </section>

        ${MoreLikeThisSection(t)}
      </main>
    `;
  }

  // ✅ Series: fixed (no rogue pasted snippet), season tabs in header, episode thumbs restored
  function SeriesDetailPage(id, seasonParam) {
    const series = state.byId.get(String(id));
    if (!series) return notFound("Series not found");

    const seasons = Array.isArray(series.seasons) ? series.seasons : [];
    let seasonIndex = Number(seasonParam);
    if (!Number.isFinite(seasonIndex) || seasonIndex < 0) seasonIndex = 0;
    if (seasonIndex >= seasons.length) seasonIndex = 0;

    const currentSeason = seasons[seasonIndex] || { episodes: [] };
    const episodes = Array.isArray(currentSeason.episodes) ? currentSeason.episodes : [];

    const heroUrl = hero(series);
    const posterUrl = poster(series);

    return `
      <main class="pb-28 md:pb-10">
        <button
          class="wv-btn absolute top-4 left-4 z-20"
          style="background:rgba(0,0,0,.55);border-color:rgba(255,255,255,.18);backdrop-filter:blur(10px);"
          onclick="goBackToCatalog()"
        >← Back</button>

        <div class="seriesHero" style="background-image:url('${esc(heroUrl)}')">
          <div class="seriesHeroScrim"></div>
        </div>

        <section class="seriesHeader max-w-6xl mx-auto">
          <img class="seriesPoster" src="${esc(posterUrl)}" alt="${esc(series.title || "Series")} Poster" />

          <div class="seriesMeta">
            <div class="kicker">SERIES</div>
            <h1 class="title">${esc(series.title || "Untitled")}</h1>
            ${(series.logline || series.tagline) ? `<div class="tagline">${esc(series.logline || series.tagline)}</div>` : ""}

            <div class="seasonTabs">
              ${(seasons || []).map((ss, idx) => `
                <button
                  class="tv-focus px-3 py-2 rounded-xl text-xs md:text-sm ${idx === seasonIndex ? "bg-white text-black font-bold" : "bg-white/10 hover:bg-white/20 text-white"}"
                  onclick="navTo('#/series/${esc(series.id)}?season=${idx}')"
                >Season ${idx + 1}</button>
              `).join("")}
            </div>
          </div>
        </section>

        <section class="seriesBody max-w-6xl mx-auto">
          <div class="text-sm font-black">Episodes</div>

          <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            ${episodes.map((ep, ei) => {
              const epPoster = episodePoster(ep, series);
              return `
                <button class="tv-focus text-left p-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10"
                  onclick="startEpisode('${esc(series.id)}', ${seasonIndex}, ${ei})">
                  <div class="flex gap-3">
                    <div class="w-28 flex-none rounded-xl overflow-hidden bg-black border border-white/10">
                      <div class="aspect-[16/9] bg-black">
                        ${epPoster ? `<img src="${esc(epPoster)}" class="w-full h-full object-cover" />` : ""}
                      </div>
                    </div>
                    <div class="flex-1">
                      <div class="text-xs text-white/60">S${seasonIndex + 1} • E${ei + 1}</div>
                      <div class="text-sm font-bold line-clamp-1">${esc(ep.title || `Episode ${ei + 1}`)}</div>
                      <div class="text-[12px] text-white/70 line-clamp-2 mt-1">${esc(ep.synopsis || ep.description || "")}</div>
                    </div>
                  </div>
                </button>
              `;
            }).join("")}
          </div>

          ${CreditsBlock(series)}
          ${MoreLikeThisSection(series)}
        </section>
      </main>
    `;
  }

  function SearchPage() {
    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-6 pb-28 md:pb-10">
        <div class="text-xl font-black">Search</div>
        <div class="mt-4">
          <input id="searchBox" class="wv-input" placeholder="Search titles…" />
        </div>
        <div id="searchResults" class="mt-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3"></div>
      </main>
    `;
  }

  function wireSearch() {
    const box = document.getElementById("searchBox");
    const out = document.getElementById("searchResults");
    if (!box || !out) return;

    const renderResults = (q) => {
      const query = String(q || "").trim().toLowerCase();
      const results = !query ? [] : state.titles.filter((t) =>
        String(t.title || "").toLowerCase().includes(query) ||
        String(t.synopsis || t.description || "").toLowerCase().includes(query) ||
        (t.genre || []).join(" ").toLowerCase().includes(query)
      ).slice(0, 60);

      out.innerHTML = results.map(tileCard).join("") || `<div class="col-span-full text-white/60 text-sm">No results.</div>`;
    };

    box.addEventListener("input", () => renderResults(box.value));
    setTimeout(() => box.focus(), 50);
  }

  function LoginPage(mode = "login") {
    const isSignup = String(mode).toLowerCase() === "signup";
    const defaultPick = "ember";
    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-10 pb-28 md:pb-10">
        <div class="max-w-md mx-auto border border-white/10 bg-white/5 rounded-3xl p-6">
          <div class="text-2xl font-black">${isSignup ? "Create account" : "Log in"}</div>
          <div class="text-white/60 text-sm mt-1">${isSignup ? "Join WatchVIM in a few clicks." : "Welcome back."}</div>

          ${isSignup ? `
            <div class="mt-5">
              <label class="text-xs text-white/60">Full name</label>
              <input id="authName" class="wv-input mt-2" placeholder="Your name" />
            </div>

            <div class="mt-5">
              <div class="text-xs text-white/60">Choose an avatar</div>
              <input id="authAvatar" type="hidden" value="${esc(defaultPick)}" />
              ${renderAvatarGrid({ selectedId: defaultPick, clickFn: "selectAuthAvatar" })}
            </div>
          ` : ""}

          <div class="mt-5">
            <label class="text-xs text-white/60">Email</label>
            <input id="authEmail" class="wv-input mt-2" placeholder="you@email.com" />
          </div>

          <div class="mt-4">
            <label class="text-xs text-white/60">Password</label>
            <input id="authPass" type="password" class="wv-input mt-2" placeholder="••••••••" />
          </div>

          ${isSignup ? `
            <div class="mt-4">
              <label class="text-xs text-white/60">Plan label (optional)</label>
              <input id="authPlan" class="wv-input mt-2" placeholder="SVOD Monthly / Annual / TVOD-only" />
            </div>
          ` : ""}

          <div class="mt-6 flex gap-2 justify-end">
            <button class="wv-btn" onclick="navTo('#/home')">Cancel</button>
            <button class="wv-btn wv-btn-primary" onclick="${isSignup ? "doSignup()" : "doLogin()"}">
              ${isSignup ? "Create account" : "Log in"}
            </button>
          </div>

          <div class="mt-5 text-xs text-white/60">
            ${isSignup
              ? `Already have an account? <a class="underline hover:text-white" href="#/login?mode=login">Log in</a>`
              : `New here? <a class="underline hover:text-white" href="#/login?mode=signup">Create an account</a>`
            }
          </div>
        </div>
      </main>
    `;
  }

  function ProfilePage() {
    const u = state.user;
    const info = currentMembershipInfo();
    const currentAvatarId = userAvatarId(u) || "ember";
    const avatar = u ? userAvatarUrl(u) : "";

    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-8 pb-28 md:pb-10">
        <div class="text-2xl font-black">Profile</div>

        ${u ? `
          <div class="mt-4 border border-white/10 bg-white/5 rounded-3xl p-6 max-w-xl">
            <div class="flex items-center gap-4">
              <div class="wv-avatar-lg"><img src="${esc(avatar)}" alt="Avatar"/></div>
              <div class="min-w-0">
                <div class="text-sm text-white/60">Signed in as</div>
                <div class="text-lg font-bold break-all">${esc(u.email || "Unknown")}</div>
              </div>
            </div>

            <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div class="text-xs text-white/60">Plan</div>
                <div class="font-bold">${esc(info.plan || currentMembershipPlan() || "—")}</div>
              </div>
              <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div class="text-xs text-white/60">Status</div>
                <div class="font-bold">${esc(info.status || (isActiveSvodMember() ? "Active" : "—"))}</div>
              </div>
            </div>

            <div class="mt-5">
              <div class="text-sm font-black">Avatar</div>
              <div class="text-xs text-white/60 mt-1">Pick an avatar for your WatchVIM profile.</div>
              <input id="profileAvatar" type="hidden" value="${esc(currentAvatarId)}" />
              ${renderAvatarGrid({ selectedId: currentAvatarId, clickFn: "selectProfileAvatar" })}
              <div class="mt-4 flex justify-end gap-2">
                <button class="wv-btn" onclick="saveProfileAvatar()">Save Avatar</button>
                <button class="wv-btn" onclick="signOut()">Log out</button>
              </div>
            </div>
          </div>
        ` : `
          <div class="mt-4 text-white/70">You’re not logged in.</div>
          <div class="mt-4 flex gap-2">
            <button class="wv-btn wv-btn-primary" onclick="navTo('#/login?mode=login')">Log in</button>
            <button class="wv-btn" onclick="navTo('#/login?mode=signup')">Become a Member</button>
          </div>
        `}
      </main>
    `;
  }

  function CheckoutPage(titleId) {
    const tid = String(titleId || "").trim();
    const t = tid ? state.byId.get(tid) : null;

    const checkoutBase = CONFIG.TVOD_CHECKOUT_URL_BASE || "/checkout.html";
    const src = `${checkoutBase}?titleId=${encodeURIComponent(tid)}&embed=1`;

    const titleText = t?.title || "Checkout";
    const p = t ? poster(t) : "";

    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-6 pb-28 md:pb-10">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs uppercase tracking-[0.2em] text-white/60">TVOD</div>
            <div class="text-xl md:text-2xl font-black">Checkout</div>
            <div class="text-sm text-white/70 line-clamp-1 mt-1">${esc(titleText)}</div>
          </div>
          <div class="flex gap-2">
            ${t ? `<button class="wv-btn" onclick="navTo('#/title/${esc(t.id)}')">Back</button>` : `<button class="wv-btn" onclick="goBackToCatalog()">Back</button>`}
          </div>
        </div>

        <div class="mt-5 grid md:grid-cols-3 gap-4">
          <div class="md:col-span-1 border border-white/10 bg-white/5 rounded-3xl p-4">
            <div class="text-sm font-black">Order Summary</div>
            <div class="mt-3 flex gap-3">
              <div class="w-20 flex-none rounded-2xl overflow-hidden border border-white/10 bg-black">
                <div class="aspect-[2/3] bg-black">
                  ${p ? `<img src="${esc(p)}" class="w-full h-full object-cover" />` : ""}
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-bold line-clamp-2">${esc(titleText)}</div>
                <div class="text-xs text-white/60 mt-1">
                  Payment processed securely by PayPal (backend). <br/>
                  You stay on WatchVIM for checkout.
                </div>
              </div>
            </div>

            <div class="mt-4 text-xs text-white/60">
              If you want a fully custom card form with **no PayPal buttons**, we’ll switch to PayPal Hosted Fields / Advanced Card Payments (requires server order APIs).
            </div>
          </div>

          <div class="md:col-span-2 border border-white/10 bg-white/5 rounded-3xl overflow-hidden">
            <div class="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div class="font-black text-sm">VIM Media Checkout</div>
              <div class="text-xs text-white/60">Powered by PayPal</div>
            </div>
            <div class="p-3">
              <iframe
                src="${esc(src)}"
                title="Checkout"
                style="width:100%;height:820px;border:0;border-radius:18px;background:#0a0a0a;"
              ></iframe>
            </div>
          </div>
        </div>
      </main>
    `;
  }

  function notFound(msg) {
    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-10 pb-28 md:pb-10">
        <div class="text-2xl font-black">Not found</div>
        <div class="mt-3 text-white/70">${esc(msg || "Page not found.")}</div>
        <div class="mt-6"><button class="wv-btn" onclick="navTo('#/home')">Go Home</button></div>
      </main>
    `;
  }

  // =========================================================
  // LIVE LOOP CHANNEL (PlutoTV-style Guide under player + Now Playing)
  // (FIX: remove duplicate Up Next rail list; keep only the Guide under player)
  // (UPDATE: force content to resume autoplay after pre-roll finishes)
  // =========================================================
  function ensureLoopState() {
    if (!state.loop || typeof state.loop !== "object") state.loop = {};
    if (!Array.isArray(state.loop.queue)) state.loop.queue = [];
    if (!Number.isFinite(Number(state.loop.index))) state.loop.index = 0;

    if (!("channel" in state.loop)) state.loop.channel = null;
    if (!("adTimer" in state.loop)) state.loop.adTimer = null;
    if (!("rotateTimer" in state.loop)) state.loop.rotateTimer = null;
    if (!("progressTimer" in state.loop)) state.loop.progressTimer = null;
    if (!("playingAd" in state.loop)) state.loop.playingAd = false;
  }

  function getLoopChannelObject() {
    const c = state.catalog || {};
    return (
      c.loopChannel || c.liveChannel || c.channel ||
      c.loop_channel || c.live_channel ||
      c.home?.loopChannel || c.home?.liveChannel || c.home?.channel ||
      c.home?.loop_channel || c.home?.live_channel ||
      null
    );
  }

  function normalizeLoopQueueItem(it) {
    if (!it) return null;

    // CMS rotation items commonly use:
    //   id: "loopItem_xxx" (slot id)
    //   refId: "title_xxx" (actual catalog title id)
    const slotId = String(it.id || it.slotId || it.loopItemId || "");

    const refId =
      it.titleId || it.title_id ||
      it.refId || it.ref_id ||            // ✅ IMPORTANT
      it.contentId || it.content_id ||
      it.slug || it.key || null;

    // Prefer refId/titleId. Only fall back to it.id if it doesn't look like a loop slot id.
    let titleId = refId ? String(refId) : null;
    if (!titleId && slotId && !/^loopitem_/i.test(slotId)) titleId = slotId;

    const fromCatalog = titleId ? state.byId.get(String(titleId)) : null;

    // Resolve playbackId (supports titleId-only items by pulling from catalog)
    const playbackId = pickFirstString(
      it.playbackId, it.playback_id, it.muxPlaybackId, it.mux_playback_id,
      it.contentPlaybackId, it.content_playback_id,
      fromCatalog?.contentPlaybackId,
      fromCatalog?.playbackId,
      fromCatalog?.muxPlaybackId,
      fromCatalog?.stream?.playbackId,
      fromCatalog?.streams?.[0]?.playbackId
    );

    const url = normalizeMediaUrl(pickFirstString(
      it.url, it.src, it.hlsUrl, it.hls_url, it.mp4Url, it.mp4_url,
      fromCatalog?.url, fromCatalog?.src
    ));

    const label = pickFirstString(it.label, it.title, fromCatalog?.title) || "Program";

    const durationSec =
      numOrNull(it.durationSec ?? it.duration_sec) ??
      (numOrNull(fromCatalog?.runtimeMins) ? Number(fromCatalog.runtimeMins) * 60 : null);

    return {
      label,
      titleId: titleId || (fromCatalog?.id ? String(fromCatalog.id) : null),
      playbackId: playbackId || "",
      url: url || "",
      streamType: String(it.streamType || it.stream_type || (it.isLive ? "live" : "on-demand") || "on-demand"),
      durationSec
    };
  }

  function initLoopQueue() {
    ensureLoopState();

    const ch = getLoopChannelObject();
    state.loop.channel = ch || null;

    let queue = [];
    if (Array.isArray(ch)) queue = ch;
    else if (Array.isArray(ch?.rotationItems)) queue = ch.rotationItems; // ✅ supports CMS rotationItems
    else if (Array.isArray(ch?.queue)) queue = ch.queue;
    else if (Array.isArray(ch?.items)) queue = ch.items;

    const norm = (queue || [])
      .map(normalizeLoopQueueItem)
      .filter(Boolean)
      .filter((x) => x.playbackId || x.url);

    state.loop.queue = norm;

    if (state.loop.index >= norm.length) state.loop.index = 0;
    if (state.loop.index < 0) state.loop.index = 0;

    console.log("[WatchVIM LIVE] initLoopQueue:", {
      hasChannel: !!ch,
      rawLen: (queue && queue.length) || 0,
      normalizedLen: norm.length,
      sample: norm[0] || null
    });
  }

  function cleanupLoopTimers() {
    ensureLoopState();
    try { if (state.loop.adTimer) clearInterval(state.loop.adTimer); } catch (_) {}
    try { if (state.loop.rotateTimer) clearTimeout(state.loop.rotateTimer); } catch (_) {}
    try { if (state.loop.progressTimer) clearInterval(state.loop.progressTimer); } catch (_) {}
    state.loop.adTimer = null;
    state.loop.rotateTimer = null;
    state.loop.progressTimer = null;
    state.loop.playingAd = false;
  }

  // ---- NEW: make sure content resumes playback after ads (best-effort) ----
  function pauseLoopContentPlayback(containerEl) {
    try {
      const v = findVideoInContainer(containerEl);
      if (v && !v.paused) v.pause();
    } catch (_) {}
  }

  async function resumeLoopContentPlayback(containerEl, opts = {}) {
    const tries = Number.isFinite(opts.tries) ? opts.tries : 10;
    const delayMs = Number.isFinite(opts.delayMs) ? opts.delayMs : 200;

    const v = findVideoInContainer(containerEl);
    if (!v) return false;

    // Remember mute state so we can restore it.
    const wasMuted = !!v.muted;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    for (let i = 0; i < tries; i++) {
      try {
        // First attempt: play normally
        const p = v.play();
        if (p && typeof p.then === "function") await p;
        if (!v.paused) return true;
      } catch (_) {
        // Autoplay policy fallback: try muted play (still better than a stuck player)
        try {
          v.muted = true;
          const p2 = v.play();
          if (p2 && typeof p2.then === "function") await p2;

          // If it starts, try restoring mute state shortly after.
          if (!v.paused) {
            setTimeout(() => {
              try { v.muted = wasMuted; } catch (_) {}
            }, 250);
            return true;
          }
        } catch (_) {}
      }
      await sleep(delayMs);
    }

    // Last attempt: restore mute state
    try { v.muted = wasMuted; } catch (_) {}
    return !v.paused;
  }

  async function setupLoopAds(containerEl) {
    ensureLoopState();
    cleanupLoopTimers();

    const ch = state.loop.channel || getLoopChannelObject() || {};
    const freq =
      numOrNull(ch.adFrequencyMins) ??
      numOrNull(ch.adEveryMins) ??
      CONFIG.LIVE_AD_FREQUENCY_MINS_FALLBACK;

    // continue inside setupLoopAds(containerEl) right after:
    //   const base = { monetization:{avod:true}, avod:true,

      advertising: {
        preRollVastTag: pickFirstString(
          ch.preRollVastTag, ch.preRollTag, ch.prerollTag, ch.vastTag, ch.vast,
          ch.ads?.preRollVastTag, ch.ads?.preRollTag, ch.ads?.vastTag,
          CONFIG.VAST_TAG
        ),
        midRollVastTag: pickFirstString(
          ch.midRollVastTag, ch.midRollTag, ch.midrollTag,
          ch.ads?.midRollVastTag, ch.ads?.midRollTag,
          CONFIG.VAST_TAG
        ),
        midRollEveryMins: numOrNull(ch.midRollEveryMins) ?? numOrNull(ch.midrollEveryMins) ?? freq
      }
    };

    // Live “break” tag to run on cadence (prefer mid, then pre, then global)
    const liveBreakTag = pickFirstString(
      ch.midRollVastTag, ch.midRollTag, ch.midrollTag,
      ch.preRollVastTag, ch.preRollTag, ch.prerollTag,
      ch.vastTag, ch.vast,
      CONFIG.VAST_TAG
    );

    const adConfig = buildAdConfig(base, { forceAvod: true }) || (liveBreakTag ? { preTag: liveBreakTag, midTag: liveBreakTag, midEveryMins: freq } : null);

    // repeating LIVE breaks (no manual next)
    if (liveBreakTag && freq >= 1) {
      state.loop.adTimer = setInterval(async () => {
        if (location.hash && !location.hash.startsWith("#/loop")) return;
        if (state.loop.playingAd) return;

        state.loop.playingAd = true;
        try {
          pauseLoopContentPlayback(containerEl);

          await new Promise((resolve) => {
            runVastAd(liveBreakTag, containerEl, {
              onBeforeAd: () => {},
              onComplete: async () => {
                try { await resumeLoopContentPlayback(containerEl, { tries: 12, delayMs: 220 }); } catch (_) {}
                resolve(true);
              }
            }).catch(() => resolve(false));

            setTimeout(() => resolve(false), 25000);
          });
        } finally {
          state.loop.playingAd = false;
        }
      }, freq * 60 * 1000);
    }

    return { adConfig, liveBreakTag, freq };
  }

  // =========================================================
  // LIVE UI helpers (Now Playing + Guide)
  // =========================================================
  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (_) {
      return "";
    }
  }

  function ensureLoopNowTimes(durationSecFallback = 1800) {
    ensureLoopState();
    if (!state.loop.nowStartTs || !state.loop.nowEndTs) {
      const now = Date.now();
      const dur = Number(durationSecFallback || 0) || 1800;
      state.loop.nowStartTs = now;
      state.loop.nowEndTs = now + dur * 1000;
    }
  }

  function computeGuide(queue, startIndex, count = 16) {
    const q = Array.isArray(queue) ? queue : [];
    if (!q.length) return [];
    const idx0 = Math.max(0, Math.min(startIndex, q.length - 1));

    const now = Date.now();
    const cur = q[idx0];
    const curDur = Number(cur.durationSec || 0) || 1800;

    // For schedule: treat current as starting “now”
    let t = now;
    const out = [];
    for (let i = 0; i < Math.min(count, q.length); i++) {
      const idx = (idx0 + i) % q.length;
      const it = q[idx];
      const dur = Number(it.durationSec || 0) || (i === 0 ? curDur : 1800);
      const start = t;
      const end = t + dur * 1000;
      out.push({ idx, it, start, end, isNow: i === 0 });
      t = end;
    }
    return out;
  }

  function renderLiveNowAndGuide() {
    ensureLoopState();
    const shell = document.getElementById("livePlayerShell");
    const nowCard = document.getElementById("liveNowCard");
    const guideEl = document.getElementById("liveGuideList");
    const pbar = document.getElementById("liveProgressBar");
    if (!nowCard || !guideEl) return;

    const q = state.loop.queue || [];
    if (!q.length) {
      nowCard.innerHTML = `<div class="text-white/70 text-sm">No LIVE programs configured.</div>`;
      guideEl.innerHTML = `<div class="text-white/60 text-sm p-3">Ask admin to publish a Loop Channel queue in CMS.</div>`;
      if (pbar) pbar.style.width = "0%";
      return;
    }

    const cur = q[state.loop.index] || q[0];
    const title = cur?.titleId ? state.byId.get(String(cur.titleId)) : null;

    const img = title ? poster(title) : "";
    const start = state.loop.nowStartTs || Date.now();
    const end = state.loop.nowEndTs || (Date.now() + (Number(cur.durationSec || 1800) * 1000));

    const type = title?.type || "films";
    const detailsBtn = title?.id
      ? `<button class="wv-btn wv-btn-primary w-full" onclick="openDetails('${esc(title.id)}','${esc(type)}')">View Details</button>`
      : "";

    nowCard.innerHTML = `
      <div class="wv-rail-card p-4">
        <div class="text-[10px] uppercase tracking-[0.2em] text-white/60">Now Playing</div>

        <div class="mt-3 flex gap-3">
          <div class="w-20 flex-none rounded-2xl overflow-hidden border border-white/10 bg-black">
            <div class="aspect-[2/3] bg-black">
              ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover" />` : ""}
            </div>
          </div>

          <div class="min-w-0">
            <div class="text-sm font-black line-clamp-2">${esc(cur.label || title?.title || "Program")}</div>
            <div class="text-xs text-white/60 mt-1">${esc(fmtTime(start))} – ${esc(fmtTime(end))}</div>
            <div class="text-xs text-white/70 mt-2 line-clamp-2">${esc(title?.synopsis || title?.description || "")}</div>
          </div>
        </div>

        <div class="mt-4">${detailsBtn}</div>
      </div>
    `;

    const guide = computeGuide(q, state.loop.index, 18);
    guideEl.innerHTML = guide.map((g) => {
      const t = g.it?.titleId ? state.byId.get(String(g.it.titleId)) : null;
      const img2 = t ? poster(t) : "";
      const isNow = g.isNow;

      return `
        <div class="flex items-center gap-3 p-3 rounded-2xl border ${isNow ? "border-white/25 bg-white/10" : "border-white/10 bg-white/5"}">
          <div class="w-14 h-10 rounded-xl overflow-hidden border border-white/10 bg-black flex-none">
            ${img2 ? `<img src="${esc(img2)}" class="w-full h-full object-cover" />` : ""}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] text-white/60">${esc(fmtTime(g.start))} – ${esc(fmtTime(g.end))}</div>
            <div class="text-sm font-bold line-clamp-1">${esc(g.it.label || t?.title || "Program")}</div>
          </div>
          ${isNow ? `<div class="text-[10px] px-2 py-1 rounded-full bg-[color:var(--watch-accent,#e50914)] text-white font-bold">LIVE</div>` : ""}
        </div>
      `;
    }).join("");
  }

  function startLiveProgressLoop() {
    ensureLoopState();
    try { if (state.loop.progressTimer) clearInterval(state.loop.progressTimer); } catch (_) {}
    state.loop.progressTimer = setInterval(() => {
      const pbar = document.getElementById("liveProgressBar");
      if (!pbar) return;

      const now = Date.now();
      const start = state.loop.nowStartTs || now;
      const end = state.loop.nowEndTs || (now + 1);

      const pct = Math.max(0, Math.min(1, (now - start) / Math.max(1, (end - start))));
      pbar.style.width = `${Math.round(pct * 100)}%`;
    }, 500);
  }

  // =========================================================
  // LIVE playback loop (no manual Next)
  // =========================================================
  async function playLoopIndex(idx) {
    ensureLoopState();
    const q = state.loop.queue || [];
    if (!q.length) return;

    state.loop.index = ((idx % q.length) + q.length) % q.length;

    const cur = q[state.loop.index];
    const shell = document.getElementById("livePlayerShell");
    const wrapId = "livePlayerWrap";
    if (!shell) return;

    // Reset times for schedule/progress
    const dur = Number(cur.durationSec || 0) || 1800;
    state.loop.nowStartTs = Date.now();
    state.loop.nowEndTs = state.loop.nowStartTs + dur * 1000;

    // Mount player (autoplay off if we have a preroll tag to respect “VAST FIRST”)
    const ch = state.loop.channel || getLoopChannelObject() || {};
    const livePrerollTag = pickFirstString(
      ch.preRollVastTag, ch.preRollTag, ch.prerollTag, ch.vastTag, ch.vast,
      CONFIG.VAST_TAG
    );
    const expectAds = !!livePrerollTag;

    mountPlayer({
      playbackId: cur.playbackId || "",
      directUrl: cur.url || "",
      streamType: cur.streamType || "on-demand",
      wrapId,
      autoplay: !expectAds
    });

    // Wire ended → advance
    const v = findVideoInContainer(shell);
    if (v) {
      const onEnded = () => {
        try { v.removeEventListener("ended", onEnded); } catch (_) {}
        advanceLoop();
      };
      try { v.addEventListener("ended", onEnded); } catch (_) {}
    }

    // Time-based rotation fallback (for “live” sources or non-ended streams)
    try { if (state.loop.rotateTimer) clearTimeout(state.loop.rotateTimer); } catch (_) {}
    state.loop.rotateTimer = setTimeout(() => advanceLoop(), Math.max(15_000, dur * 1000));

    // Ads cadence + optional global pod (VAST FIRST)
    const { adConfig } = (await setupLoopAds(shell)) || {};
    await playWithAdsIfNeeded({ containerEl: shell, isAvod: false, isLive: true, adConfig });

    // Best-effort ensure it’s playing after preroll
    try { await resumeLoopContentPlayback(shell, { tries: 12, delayMs: 220 }); } catch (_) {}

    renderLiveNowAndGuide();
    startLiveProgressLoop();
  }

  function advanceLoop() {
    ensureLoopState();
    const q = state.loop.queue || [];
    if (!q.length) return;
    playLoopIndex(state.loop.index + 1);
  }

  function LoopPage() {
    ensureLoopState();
    const hasQueue = (state.loop.queue || []).length > 0;

    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-6 pb-28 md:pb-10">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs uppercase tracking-[0.2em] text-white/60">LIVE</div>
            <div class="text-xl md:text-2xl font-black">WatchVIM LIVE</div>
            <div class="text-sm text-white/60 mt-1">Always-on channel • Pluto-style guide below</div>
          </div>
          <div class="flex gap-2">
            <button class="wv-btn" onclick="goBackToCatalog()">Back</button>
          </div>
        </div>

        <div class="mt-5 wv-live-rail">
          <div id="livePlayerShell" class="wv-player-wrap">
            <div id="livePlayerWrap" class="wv-player-inner"></div>
          </div>

          <div class="mt-4 wv-progress-track">
            <div id="liveProgressBar" class="wv-progress-bar"></div>
          </div>

          <div class="mt-5 grid md:grid-cols-3 gap-4">
            <div id="liveNowCard" class="md:col-span-1"></div>

            <div class="md:col-span-2">
              <div class="flex items-center justify-between mb-2">
                <div class="text-sm font-black">Guide</div>
                <div class="text-xs text-white/60">Schedule updates as the channel plays</div>
              </div>
              <div id="liveGuideList" class="wv-guide-scroll space-y-2 ${hasQueue ? "" : "p-3 border border-white/10 bg-white/5 rounded-2xl"}">
                ${hasQueue ? "" : `<div class="text-white/70 text-sm">No LIVE queue configured.</div>`}
              </div>
            </div>
          </div>
        </div>
      </main>
    `;
  }

  // =========================================================
  // WATCH PAGES (title + episode)
  // =========================================================
  function WatchPage(id, kind = "content") {
    const t = state.byId.get(String(id));
    if (!t) return notFound("Title not found");

    const isTrailer = String(kind || "").toLowerCase() === "trailer";
    const titleText = t.title || "Untitled";
    const p = poster(t);

    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-6 pb-28 md:pb-10">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs uppercase tracking-[0.2em] text-white/60">${esc(isTrailer ? "Trailer" : "Now Playing")}</div>
            <div class="text-xl md:text-2xl font-black line-clamp-1">${esc(titleText)}</div>
          </div>
          <div class="flex gap-2">
            <button class="wv-btn" onclick="navTo(state.playbackReturnHash || '#/title/${esc(t.id)}')">Back</button>
          </div>
        </div>

        <div class="mt-5 grid md:grid-cols-3 gap-4">
          <div class="md:col-span-2">
            <div id="playerShell" class="wv-player-wrap">
              <div id="playerWrap" class="wv-player-inner"></div>
            </div>
          </div>

          <div class="md:col-span-1 border border-white/10 bg-white/5 rounded-3xl p-4">
            <div class="flex gap-3">
              <div class="w-20 flex-none rounded-2xl overflow-hidden border border-white/10 bg-black">
                <div class="aspect-[2/3] bg-black">
                  ${p ? `<img src="${esc(p)}" class="w-full h-full object-cover" />` : ""}
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-black line-clamp-2">${esc(titleText)}</div>
                <div class="text-xs text-white/60 mt-1">${esc(typeLabel(t.type))}${t.releaseYear ? ` • ${esc(t.releaseYear)}` : ""}</div>
                <div class="text-xs text-white/70 mt-2 line-clamp-4">${esc(t.synopsis || t.description || "")}</div>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <button class="wv-btn wv-btn-primary" onclick="openDetails('${esc(t.id)}','${esc(t.type)}')">Details</button>
              ${t.trailerPlaybackId ? `<button class="wv-btn" onclick="startPlayback('${esc(t.id)}','${isTrailer ? "content" : "trailer"}')">${isTrailer ? "Play Movie" : "Play Trailer"}</button>` : ""}
            </div>
          </div>
        </div>
      </main>
    `;
  }

  function EpisodeWatchPage(seriesId, seasonIndex, epIndex, kind = "content") {
    const series = state.byId.get(String(seriesId));
    const sIdx = Number(seasonIndex);
    const eIdx = Number(epIndex);

    const season = series?.seasons?.[sIdx] || null;
    const ep = season?.episodes?.[eIdx] || null;

    if (!series || !ep) return notFound("Episode not found");

    const epTitle = ep.title || `Episode ${eIdx + 1}`;
    const img = episodePoster(ep, series);

    return `
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-6 pb-28 md:pb-10">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs uppercase tracking-[0.2em] text-white/60">Series</div>
            <div class="text-xl md:text-2xl font-black line-clamp-1">${esc(series.title || "Series")}</div>
            <div class="text-sm text-white/70 line-clamp-1 mt-1">S${sIdx + 1} • E${eIdx + 1} — ${esc(epTitle)}</div>
          </div>
          <div class="flex gap-2">
            <button class="wv-btn" onclick="navTo(state.playbackReturnHash || '#/series/${esc(series.id)}?season=${sIdx}')">Back</button>
          </div>
        </div>

        <div class="mt-5 grid md:grid-cols-3 gap-4">
          <div class="md:col-span-2">
            <div id="epPlayerShell" class="wv-player-wrap">
              <div id="epPlayerWrap" class="wv-player-inner"></div>
            </div>
          </div>

          <div class="md:col-span-1 border border-white/10 bg-white/5 rounded-3xl p-4">
            <div class="flex gap-3">
              <div class="w-24 flex-none rounded-2xl overflow-hidden border border-white/10 bg-black">
                <div class="aspect-[16/9] bg-black">
                  ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover" />` : ""}
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-black line-clamp-2">${esc(epTitle)}</div>
                <div class="text-xs text-white/60 mt-1">S${sIdx + 1} • E${eIdx + 1}</div>
                <div class="text-xs text-white/70 mt-2 line-clamp-4">${esc(ep.synopsis || ep.description || "")}</div>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <button class="wv-btn wv-btn-primary" onclick="openDetails('${esc(series.id)}','series')">Series Details</button>
            </div>
          </div>
        </div>
      </main>
    `;
  }

  // =========================================================
  // ACTIONS: Playback + TVOD checkout
  // =========================================================
  async function startTVODCheckout(titleId) {
    const tid = String(titleId || "").trim();
    if (!tid) return;
    state.playbackReturnHash = location.hash || `#/title/${encodeURIComponent(tid)}`;
    navTo(`#/checkout?titleId=${encodeURIComponent(tid)}`);
  }

  async function startPlayback(id, kind = "content") {
    const t = state.byId.get(String(id));
    if (!t) return;

    // Gate only for main content (trailers are always allowed)
    if (String(kind).toLowerCase() !== "trailer") {
      const access = checkAccessForPlayback(t);
      if (access.allowed === false) {
        const actions = [{ label: "Not now", primary: false, onClick: () => {} }];

        if (access.reason === "login") {
          actions.unshift({ label: "Log in", primary: true, onClick: () => navTo("#/login?mode=login") });
          actions.unshift({ label: "Create account", primary: false, onClick: () => navTo("#/login?mode=signup") });
        } else if (access.reason === "upgrade") {
          actions.unshift({ label: "Become a Member", primary: true, onClick: () => navTo("#/login?mode=signup") });
        } else if (access.reason === "tvod") {
          actions.unshift({ label: "Rent / Buy", primary: true, onClick: () => startTVODCheckout(t.id) });
        }

        showPaywallModal({ title: "Access Required", message: access.message || "This content is restricted.", actions });
        return;
      }
    }

    state.playbackReturnHash = location.hash || `#/title/${encodeURIComponent(id)}`;
    navTo(`#/watch/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind || "content")}`);
  }

  function startEpisode(seriesId, seasonIndex, epIndex) {
    const sid = String(seriesId || "");
    if (!sid) return;

    const series = state.byId.get(sid);
    const ep = series?.seasons?.[seasonIndex]?.episodes?.[epIndex] || null;
    const access = checkAccessForPlayback(ep || series);

    if (access.allowed === false) {
      const actions = [{ label: "Not now", primary: false, onClick: () => {} }];

      if (access.reason === "login") {
        actions.unshift({ label: "Log in", primary: true, onClick: () => navTo("#/login?mode=login") });
        actions.unshift({ label: "Create account", primary: false, onClick: () => navTo("#/login?mode=signup") });
      } else if (access.reason === "upgrade") {
        actions.unshift({ label: "Become a Member", primary: true, onClick: () => navTo("#/login?mode=signup") });
      } else if (access.reason === "tvod") {
        actions.unshift({ label: "Rent / Buy", primary: true, onClick: () => startTVODCheckout(series?.id || sid) });
      }

      showPaywallModal({ title: "Access Required", message: access.message || "This content is restricted.", actions });
      return;
    }

    state.playbackReturnHash = location.hash || `#/series/${encodeURIComponent(sid)}?season=${seasonIndex}`;
    navTo(`#/episode/${encodeURIComponent(sid)}/${encodeURIComponent(seasonIndex)}/${encodeURIComponent(epIndex)}?kind=content`);
  }

  // =========================================================
  // RENDER + WIRES
  // =========================================================
  function renderLoading(msg = "Loading…") {
    app.innerHTML = `
      ${Header()}
      <main class="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <div class="text-2xl font-black">${esc(msg)}</div>
        <div class="mt-3 text-white/60 text-sm">Please wait…</div>
      </main>
      ${MobileTabBar()}
      ${SiteFooter()}
    `;
  }

  async function wireWatchPlayback() {
    const { id, kind } = state.route.params || {};
    const t = state.byId.get(String(id));
    if (!t) return;

    const isTrailer = String(kind || "").toLowerCase() === "trailer";
    const pb = isTrailer
      ? pickFirstString(t.trailerPlaybackId, t.trailer_playback_id, t.trailer?.playbackId)
      : pickFirstString(
          t.contentPlaybackId, t.content_playback_id,
          t.playbackId, t.playback_id, t.muxPlaybackId, t.mux_playback_id,
          t.stream?.playbackId, t.streams?.[0]?.playbackId
        );

    const directUrl = normalizeMediaUrl(pickFirstString(t.url, t.src, t.hlsUrl, t.mp4Url));
    const shell = document.getElementById("playerShell");
    if (!shell) return;

    const access = !isTrailer ? checkAccessForPlayback(t) : { allowed: true, adMode: "none" };
    const adConfig = !isTrailer ? buildAdConfig(t) : null;
    const expectPreroll = !!(adConfig?.preTag);

    mountPlayer({
      playbackId: pb || "",
      directUrl: pb ? "" : directUrl,
      streamType: "on-demand",
      wrapId: "playerWrap",
      autoplay: !expectPreroll
    });

    await playWithAdsIfNeeded({
      containerEl: shell,
      isAvod: access.adMode === "avod",
      isLive: false,
      adConfig
    });
  }

  async function wireEpisodePlayback() {
    const { seriesId, seasonIndex, epIndex } = state.route.params || {};
    const series = state.byId.get(String(seriesId));
    const sIdx = Number(seasonIndex);
    const eIdx = Number(epIndex);
    const ep = series?.seasons?.[sIdx]?.episodes?.[eIdx] || null;
    if (!series || !ep) return;

    const pb = pickFirstString(
      ep.playbackId, ep.playback_id,
      ep.contentPlaybackId, ep.content_playback_id,
      ep.muxPlaybackId, ep.mux_playback_id,
      ep.stream?.playbackId, ep.streams?.[0]?.playbackId
    );

    const directUrl = normalizeMediaUrl(pickFirstString(ep.url, ep.src, ep.hlsUrl, ep.mp4Url));
    const shell = document.getElementById("epPlayerShell");
    if (!shell) return;

    const access = checkAccessForPlayback(ep || series);
    const adConfig = buildAdConfig(ep || series) || null;
    const expectPreroll = !!(adConfig?.preTag);

    mountPlayer({
      playbackId: pb || "",
      directUrl: pb ? "" : directUrl,
      streamType: "on-demand",
      wrapId: "epPlayerWrap",
      autoplay: !expectPreroll
    });

    await playWithAdsIfNeeded({
      containerEl: shell,
      isAvod: access.adMode === "avod",
      isLive: false,
      adConfig
    });
  }

  async function wireLoopPlayback() {
    ensureLoopState();
    initLoopQueue();
    renderLiveNowAndGuide();
    startLiveProgressLoop();
    if ((state.loop.queue || []).length) await playLoopIndex(state.loop.index || 0);
  }

  function wirePostRenderCommon() {
    wireRowScrolling();
    if (document.querySelectorAll(".hero-slide").length) {
      setupHeroCarousel(document.querySelectorAll(".hero-slide").length);
      wireHeroHover();
    }
  }

  async function render() {
    injectGlobalStyles();

    state.route = parseHash();

    // cleanup LIVE timers when leaving
    if (state.route.name !== "loop") cleanupLoopTimers();

    let page = "";

    switch (state.route.name) {
      case "landing":
        page = LandingPage();
        break;

      case "home":
        page = HomePage();
        break;

      case "title":
        page = TitleDetailPage(state.route.params.id);
        break;

      case "series":
        page = SeriesDetailPage(state.route.params.id, state.route.params.season);
        break;

      case "search":
        page = SearchPage();
        break;

      case "login":
        page = LoginPage(state.route.params.mode || "login");
        break;

      case "profile":
        page = ProfilePage();
        break;

      case "checkout":
        page = CheckoutPage(state.route.params.titleId);
        break;

      case "watch":
        page = WatchPage(state.route.params.id, state.route.params.kind);
        break;

      case "episode":
        page = EpisodeWatchPage(
          state.route.params.seriesId,
          Number(state.route.params.seasonIndex),
          Number(state.route.params.epIndex),
          state.route.params.kind
        );
        break;

      case "loop":
        state.activeTab = "LIVE";
        page = LoopPage();
        break;

      default:
        page = HomePage();
        break;
    }

    app.innerHTML = `
      ${Header()}
      ${page}
      ${MobileTabBar()}
      ${SiteFooter()}
    `;

    wirePostRenderCommon();

    if (state.route.name === "search") wireSearch();

    if (state.route.name === "loop") {
      await ensureMuxPlayerLoaded();
      await wireLoopPlayback();
    }

    if (state.route.name === "watch") {
      await ensureMuxPlayerLoaded();
      await wireWatchPlayback();
    }

    if (state.route.name === "episode") {
      await ensureMuxPlayerLoaded();
      await wireEpisodePlayback();
    }
  }

  // =========================================================
  // AUTH UI HANDLERS
  // =========================================================
  function selectAuthAvatar(id) {
    const safe = (id && AVATAR_PRESETS.includes(id)) ? id : "ember";
    const input = document.getElementById("authAvatar");
    if (input) input.value = safe;

    document.querySelectorAll(".wv-avatar-grid button").forEach((b) => {
      const v = b.getAttribute("data-avatar");
      if (v === safe) b.classList.add("wv-selected");
      else b.classList.remove("wv-selected");
    });
  }

  function selectProfileAvatar(id) {
    const safe = (id && AVATAR_PRESETS.includes(id)) ? id : "ember";
    const input = document.getElementById("profileAvatar");
    if (input) input.value = safe;

    document.querySelectorAll(".wv-avatar-grid button").forEach((b) => {
      const v = b.getAttribute("data-avatar");
      if (v === safe) b.classList.add("wv-selected");
      else b.classList.remove("wv-selected");
    });
  }

  async function saveProfileAvatar() {
    const id = document.getElementById("profileAvatar")?.value || "ember";
    await updateProfileAvatar(id);
  }

  async function doLogin() {
    const email = document.getElementById("authEmail")?.value || "";
    const pass = document.getElementById("authPass")?.value || "";
    if (!email || !pass) return alert("Please enter email + password.");
    await signIn(email.trim(), pass);
  }

  async function doSignup() {
    const name = document.getElementById("authName")?.value || "";
    const email = document.getElementById("authEmail")?.value || "";
    const pass = document.getElementById("authPass")?.value || "";
    const plan = document.getElementById("authPlan")?.value || "tvod-only";
    const avatarId = document.getElementById("authAvatar")?.value || "ember";

    if (!email || !pass) return alert("Please enter email + password.");
    const { error } = await signUp(email.trim(), pass, name.trim(), plan.trim(), avatarId);
    if (!error) {
      alert("Account created! If email confirmation is enabled, check your inbox.");
      navTo("#/home");
    }
  }

  // =========================================================
  // EXPOSE GLOBALS (for onclick handlers)
  // =========================================================
  Object.assign(window, {
    navTo,
    setTab,
    openDetails,
    goBackToCatalog,
    startPlayback,
    startEpisode,
    startTVODCheckout,

    // Auth
    doLogin,
    doSignup,
    signOut,

    // Avatar UI
    selectAuthAvatar,
    selectProfileAvatar,
    saveProfileAvatar
  });

  // =========================================================
  // BOOT
  // =========================================================
  (async function boot() {
    injectGlobalStyles();
    await loadConfigJSON();
    injectGlobalStyles();

    try {
      await ensureMuxPlayerLoaded();
      await loadData();
      await initSupabaseIfPossible();

      // default to landing when no hash
      if (!location.hash) state.route = { name: "landing", params: {} };

      await render();
    } catch (e) {
      console.error(e);
      app.innerHTML = `
        ${Header()}
        <main class="max-w-6xl mx-auto px-4 md:px-8 py-16">
          <div class="text-2xl font-black">Something went wrong</div>
          <div class="mt-3 text-white/70 text-sm">${esc(e?.message || String(e))}</div>
          <div class="mt-6">
            <button class="wv-btn wv-btn-primary" onclick="location.reload()">Reload</button>
          </div>
        </main>
        ${MobileTabBar()}
        ${SiteFooter()}
      `;
    }
  })();
})();
