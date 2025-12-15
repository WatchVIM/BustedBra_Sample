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
   - TV D-pad focus navigation
   - LIVE loop channel (no manual Next)
   - VAST pre-roll + repeating mid-roll via Google IMA SDK (titles + episodes + LIVE)
   - Optional Global Ads Pod (mux/url) before content (AVOD + LIVE)
   - Mobile:
       • Top nav tabs only on desktop (md+)
       • Bottom tab bar on mobile only
============================================================ */

(() => {
  // =========================================================
  // CONSTANTS
  // =========================================================
  const PROMO_PLAYBACK_ID = "sJQ12hEfeyDCR4gtKbhIXzzGpzHU71BQB8GTIU1pklY";

  const DEFAULT_CONFIG = {
    MANIFEST_URL: "https://t6ht6kdwnezp05ut.public.blob.vercel-storage.com/manifest.json",
    CATALOG_URL_FALLBACK: "https://t6ht6kdwnezp05ut.public.blob.vercel-storage.com/catalog-stable.json",

    LOGO_URL: "./WatchVIM_New_OTT_Logo.png",

    THEME: {
      accent: "#e50914",
      background: "#0a0a0a",
      gold: "#d4af37"
    },

    SUPABASE_URL: "https://oxqneksxmwopepchkatv.supabase.co",
    SUPABASE_ANON_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cW5la3N4bXdvcGVwY2hrYXR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MzA1NTEsImV4cCI6MjA3OTIwNjU1MX0.CPdAIY-9QthHnbg3yTwJ_10PYp1CBTIV_o4x4qO6EJE",

    PAYPAL_CLIENT_ID: "",
    TVOD_API_BASE: "",
    TVOD_CHECKOUT_URL_BASE: "/checkout.html",

    // Global fallback VAST tag (set your GAM tag here OR via config.json)
    VAST_TAG: "",

    // Global Ads Pod
    GLOBAL_ADS: [],
    PLAY_GLOBAL_ADS_ON_AVOD: false,
    PLAY_GLOBAL_ADS_ON_LIVE: false,

    ADS_DEBUG: false,

    AVATAR_BUCKET: "avatars",

    // If your CMS doesn’t provide it, LIVE mid-roll fallback:
    LIVE_AD_FREQUENCY_MINS_FALLBACK: 10,

    // If your CMS doesn’t provide it, VOD repeating mid-roll fallback for AVOD:
    AVOD_MIDROLL_EVERY_MINS_FALLBACK: 10
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
    loop: {
      queue: [],
      index: 0,
      lastAdAt: 0,
      shuffle: true,
      playingAd: false
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
        background:#0a0a0a;
        color:#fff;
        font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }

      .tile{ width:140px; flex:0 0 auto; }
      @media(min-width:768px){ .tile{ width:170px; } }
      .tile-poster{ aspect-ratio:2/3; }

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

      /* Simple debug chip */
      .ads-debug-chip{
        position:fixed; bottom:12px; right:12px; z-index:99999;
        background:rgba(0,0,0,.75); border:1px solid rgba(255,255,255,.2);
        padding:8px 10px; border-radius:12px; font-size:11px; color:#fff;
        max-width:320px; line-height:1.25;
      }
    `;
    document.head.appendChild(s);
  }

  // =========================================================
  // HELPERS
  // =========================================================
  function esc(str = "") {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
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
    return normalizeMediaUrl(
      firstUrl(
        t.posterUrl,
        t.poster_url,
        t.appImages?.tvPosterUrl,
        t.appImages?.mobilePosterUrl,
        t.appImages?.posterUrl,
        t.images?.poster,
        t.images?.posterUrl,
        t.poster,
        t.cover,
        t.thumbnailUrl
      )
    );
  }

  function hero(t) {
    return normalizeMediaUrl(
      firstUrl(
        t.featureHeroUrl,
        t.featuredHeroUrl,
        t.featureHeroImageUrl,
        t.featureImageUrl,
        t.heroUrl,
        t.hero_url,
        t.appImages?.tvHeroUrl,
        t.appImages?.mobileHeroUrl,
        t.appImages?.heroUrl,
        t.appImages?.hero,
        t.images?.hero,
        t.images?.heroUrl,
        t.heroImage,
        t.hero,
        poster(t)
      )
    );
  }

  function typeLabel(type) {
    const map = { films: "Movie", documentaries: "Documentary", series: "Series", shorts: "Short", foreign: "Foreign" };
    return map[type] || type || "Title";
  }

  function muxIdFor(t, kind = "content") {
    return kind === "trailer" ? t.trailerPlaybackId : t.contentPlaybackId;
  }

  function isTV() {
    const ua = navigator.userAgent.toLowerCase();
    return (
      ua.includes("aft") ||
      ua.includes("smarttv") ||
      ua.includes("tizen") ||
      ua.includes("webos") ||
      ua.includes("android tv") ||
      window.innerWidth >= 1024
    );
  }

  function numOrNull(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
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

  // =========================================================
  // CONFIG LOADING
  // =========================================================
  function mergeConfigSafe(base, incoming) {
    const out = { ...base, ...(incoming || {}) };
    out.THEME = { ...(base.THEME || {}), ...(incoming?.THEME || {}) };

    if (!out.SUPABASE_URL) out.SUPABASE_URL = base.SUPABASE_URL;
    if (!out.SUPABASE_ANON_KEY) out.SUPABASE_ANON_KEY = base.SUPABASE_ANON_KEY;
    if (!out.MANIFEST_URL) out.MANIFEST_URL = base.MANIFEST_URL;
    if (!out.CATALOG_URL_FALLBACK) out.CATALOG_URL_FALLBACK = base.CATALOG_URL_FALLBACK;

    // Safety defaults
    if (!Array.isArray(out.GLOBAL_ADS)) out.GLOBAL_ADS = [];

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

      if (!catalogUrl) throw new Error("No catalog URL in manifest or fallback config.");

      const cRes = await fetch(catalogUrl + "?t=" + Date.now(), { cache: "no-store" });
      if (!cRes.ok) throw new Error("Catalog fetch failed");
      return await cRes.json();
    } catch (e) {
      const url = directCatalog || CONFIG.CATALOG_URL_FALLBACK;
      if (!url) throw e;
      const cRes = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
      if (!cRes.ok) throw e;
      return await cRes.json();
    }
  }

  function normalizeCatalog(catalog) {
    const titles = catalog.titles || catalog.publishedTitles || catalog.items || [];
    const byId = new Map();

    titles.forEach((t) => {
      if (!t || !t.id) return;
      byId.set(t.id, t);

      if (t.type === "series") {
        (t.seasons || []).forEach((s, si) => {
          (s.episodes || []).forEach((ep, ei) => {
            if (!ep.id) ep.id = `${t.id}_s${si + 1}e${ei + 1}`;
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

  async function loadData() {
    renderLoading();
    state.catalog = await fetchCatalogFromManifest();
    const norm = normalizeCatalog(state.catalog);
    state.titles = norm.titles;
    state.byId = norm.byId;
    initLoopQueue();
  }

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
      um.membership_plan ||
      um.subscription_plan ||
      um.plan ||
      um.tier ||
      am.membership_plan ||
      am.subscription_plan ||
      am.plan ||
      am.tier ||
      null;

    const status =
      um.membership_status ||
      um.subscription_status ||
      um.status ||
      am.membership_status ||
      am.subscription_status ||
      am.status ||
      null;

    const expiresAt =
      um.membership_expires_at ||
      um.current_period_end ||
      um.expires_at ||
      am.membership_expires_at ||
      am.current_period_end ||
      am.expires_at ||
      null;

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

  async function signUp(email, password, fullName, membershipPlan) {
    const client = await initSupabaseIfPossible();
    if (!client) {
      const error = new Error("Auth not configured.");
      alert(error.message);
      return { error };
    }

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || "",
          membership_plan: membershipPlan || "tvod-only"
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
    try {
      localStorage.setItem("watchvim_svod_active", "false");
    } catch (_) {}
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
    if (parts[0] === "series" && parts[1]) return { name: "series", params: { id: parts[1] } };

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

    if (parts[0] === "watch" && parts[1]) {
      return { name: "watch", params: { id: parts[1], kind: query.kind || "content" } };
    }

    if (parts[0] === "loop") return { name: "loop", params: {} };
    if (parts[0] === "search") return { name: "search", params: {} };
    if (parts[0] === "login") return { name: "login", params: { mode: query.mode || "login" } };
    if (parts[0] === "profile") return { name: "profile", params: {} };

    return { name: "home", params: { tab: query.tab || null } };
  }

  function navTo(hash) {
    location.hash = hash;
  }
  window.addEventListener("hashchange", render);

  // =========================================================
  // FEATURED + HERO
  // =========================================================
  function featuredItems() {
    const c = state.catalog || {};
    const direct =
      c.heroCarousel?.items ||
      c.heroCarousel ||
      c.featureCarousel?.items ||
      c.featureCarousel ||
      c.featuredCarousel?.items ||
      c.featuredCarousel ||
      c.heroTitles ||
      c.heroItems ||
      c.featuredTitles ||
      c.featured ||
      c.featuredItems ||
      c.featuredList ||
      c.homepage?.hero ||
      c.homepage?.featured ||
      null;

    const resolveRef = (it) => {
      if (!it) return null;
      if (typeof it === "string") return state.byId.get(it) || null;

      const id =
        it.id ||
        it.refId ||
        it.titleId ||
        it.contentId ||
        it?.ref?.id ||
        it?.ref?.refId ||
        it?.title?.id ||
        it?.title?.refId ||
        it?.itemId ||
        null;

      if (id) return state.byId.get(String(id)) || it;
      if (it.refType && it.refId) return state.byId.get(String(it.refId)) || it;

      return it?.id ? it : null;
    };

    let items = [];
    if (Array.isArray(direct) && direct.length) items = direct.map(resolveRef).filter(Boolean);

    if (!items.length) {
      items = state.titles.filter(
        (t) =>
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
  // ACCESS MODES + PAYWALL
  // =========================================================
  const ACCESS = Object.freeze({ AVOD: "AVOD", SVOD: "SVOD", TVOD: "TVOD", FREE: "FREE" });

  function isAvodTitle(t) {
    // Robust across schemas (this is important)
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
    const hasTVOD = !!tvod.enabled || hasTvod(t);

    if (!isAVOD && !isSVOD && !hasTVOD) return { allowed: true, adMode: "none" };

    if (isAVOD) {
      if (isSVOD && isActiveSvodMember()) return { allowed: true, adMode: "none" };
      return { allowed: true, adMode: "avod" };
    }

    if (isSVOD) {
      if (!state.user) {
        return {
          allowed: false,
          adMode: "none",
          reason: "login",
          message:
            "This title is available with a WatchVIM membership. Please log in or create an account to continue."
        };
      }
      if (!isActiveSvodMember()) {
        return {
          allowed: false,
          adMode: "none",
          reason: "upgrade",
          message: "Your account does not have an active streaming membership. Upgrade your plan to watch this title."
        };
      }
      return { allowed: true, adMode: "none" };
    }

    if (hasTVOD) {
      if (!state.user) {
        return { allowed: false, adMode: "none", reason: "login", message: "Please log in to rent or buy this title." };
      }
      if (isTVODUnlockedForTitle(t)) return { allowed: true, adMode: "none" };
      return {
        allowed: false,
        adMode: "none",
        reason: "tvod",
        message: "This title is available as a rental or purchase. Rent or buy it to unlock playback."
      };
    }

    return { allowed: true, adMode: "none" };
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
      try {
        const v = mux.shadowRoot?.querySelector("video");
        if (v) return v;
      } catch (_) {}
      // Some mux-player builds expose .media
      try {
        if (mux.media) return mux.media;
      } catch (_) {}
    }
    return container.querySelector("video") || null;
  }

function pauseContentAudio(containerEl) {
  const mux = containerEl?.querySelector?.("mux-player") || null;
  const video = findVideoInContainer(containerEl);

  const snap = {
    hadMux: !!mux,
    hadVideo: !!video,
    wasPaused: true,
    muted: null,
    volume: null
  };

  // Pause mux-player if possible
  try {
    if (mux && typeof mux.pause === "function") mux.pause();
  } catch (_) {}

  // Pause the underlying <video> and mute it hard
  if (video) {
    try { snap.wasPaused = !!video.paused; } catch (_) {}
    try { snap.muted = video.muted; } catch (_) {}
    try { snap.volume = video.volume; } catch (_) {}

    try { video.muted = true; } catch (_) {}
    try { video.volume = 0; } catch (_) {}
    try { video.pause(); } catch (_) {}
  }

  // Restore function
  return function restore() {
    const mux2 = containerEl?.querySelector?.("mux-player") || null;
    const v2 = findVideoInContainer(containerEl);

    if (v2) {
      try { if (snap.muted !== null) v2.muted = snap.muted; } catch (_) {}
      try { if (snap.volume !== null) v2.volume = snap.volume; } catch (_) {}

      // Only resume if it was playing before
      if (snap.wasPaused === false) {
        try { v2.play().catch(() => {}); } catch (_) {}
      }
    }

    // Resume mux-player too (some builds prefer this)
    if (mux2 && snap.wasPaused === false && typeof mux2.play === "function") {
      try { mux2.play().catch(() => {}); } catch (_) {}
    }
  };
}

  function pickFirstString(...vals) {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
    return "";
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
      adv.preRollVastTag,
      adv.preRollTag,
      adv.prerollTag,
      adv.preroll_vast,
      base.preRollVastTag,
      base.preRollTag,
      base.vastTag,
      base.vast,
      globalAdv.preRollVastTag,
      globalAdv.preRollTag,
      globalAdv.prerollTag,
      globalAdv.vastTag,
      globalAdv.vast,
      CONFIG.VAST_TAG
    );

    const midTag = pickFirstString(
      adv.midRollVastTag,
      adv.midRollTag,
      adv.midrollTag,
      adv.midroll_vast,
      base.midRollVastTag,
      base.midRollTag,
      globalAdv.midRollVastTag,
      globalAdv.midRollVastTag,
      globalAdv.midRollTag,
      globalAdv.midrollTag,
      CONFIG.VAST_TAG // if you want midroll to use same tag, this keeps it alive
    );

    // repeating mid-roll interval minutes (supports multiple schema names)
    const midEveryMins =
      numOrNull(adv.midRollEveryMins) ??
      numOrNull(adv.midrollEveryMins) ??
      numOrNull(adv.midRollIntervalMins) ??
      numOrNull(adv.midrollIntervalMins) ??
      numOrNull(globalAdv.midRollEveryMins) ??
      numOrNull(globalAdv.midRollIntervalMins) ??
      null;

    // fallback: midpoint single shot if interval not provided
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

    return {
      preTag,
      midTag,
      midSeconds,
      midEveryMins: midEveryMins || null,
      midDurationSec
    };
  }

  function adConfigForTitle(t, adMode = "none") {
    return buildAdConfig(t, { forceAvod: adMode === "avod" });
  }

  function adConfigForEpisode(series, ep, adMode = "none") {
    const monet = ep?.monetization || series?.monetization || {};
    const base = {
      ...(ep || series),
      monetization: monet,
      runtimeMins: ep?.runtimeMins || series?.runtimeMins,
      advertising: ep?.advertising || series?.advertising
    };
    return buildAdConfig(base, { forceAvod: adMode === "avod" });
  }

  // ---------- Global Ads Pod (mux/url) ----------
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

      // mux ad
      if (ad.type === "mux" && ad.playbackId) {
        el = document.createElement("mux-player");
        el.setAttribute("playback-id", ad.playbackId);
        el.setAttribute("stream-type", "on-demand");
        el.setAttribute("playsinline", "");
        el.setAttribute("autoplay", "");
        el.setAttribute("muted", "");
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.objectFit = "contain";
      }
      // url ad
      else if (ad.type === "url" && ad.src) {
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

      // failsafe
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
async function playWithAdsIfNeeded({ containerEl, isAvod, isLive, adConfig }) {
  const shouldPlayGlobal =
    (isAvod && CONFIG.PLAY_GLOBAL_ADS_ON_AVOD) || (isLive && CONFIG.PLAY_GLOBAL_ADS_ON_LIVE);

  // Pause/mute content while global pod runs to prevent double audio
  let restore = null;

  if (shouldPlayGlobal && Array.isArray(CONFIG.GLOBAL_ADS) && CONFIG.GLOBAL_ADS.length) {
    restore = pauseContentAudio(containerEl);
    logAds("Playing GLOBAL_ADS pod");
    try {
      await playGlobalAdPod(CONFIG.GLOBAL_ADS, { mountEl: containerEl });
    } catch (_) {
    } finally {
      try { restore && restore(); } catch (_) {}
      restore = null;
    }
  }

  // Ensure IMA ready before any VAST use
  const ok = await ensureImaLoaded();
  if (!ok) return;

  // VOD: setup pre-roll + mid-roll
  if (adConfig && (adConfig.preTag || adConfig.midTag)) {
    setupVodAds(adConfig, containerEl);
  }
}

    ensureRelativePosition(containerEl);

    const adDiv = document.createElement("div");
    adDiv.className = "absolute inset-0 z-[99999] bg-black/90 flex items-center justify-center";
    containerEl.appendChild(adDiv);

    let cleanupCalled = false;
    const cleanup = (ok) => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      try { adDiv.remove(); } catch (_) {}
      try { onComplete && onComplete(!!ok); } catch (_) {}
    };

    let tries = 0;
    const maxTries = 12;

    const initIMA = () => {
      tries++;
      const videoEl = findVideoInContainer(containerEl);

      if (!videoEl) {
        if (tries < maxTries) return setTimeout(initIMA, 250);
        logAds("No video element found for ad.");
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

            // IMPORTANT: initialize() needs a user gesture in some browsers.
            // We try it; if autoplay blocks, user click will happen soon anyway.
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

        // fail-safe so ads never hang playback
        setTimeout(() => cleanup(false), 15000);
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

    // Pre-roll
    if (preTag) {
      getVideo((video) => {
        runVastAd(preTag, containerEl, {
          onBeforeAd: () => { try { video.pause(); } catch (_) {} },
          onComplete: () => { try { video.play().catch(() => {}); } catch (_) {} }
        });
      });
    }

    // Mid-roll: repeating interval OR single midpoint fallback
    if (midTag) {
      getVideo((video) => {
        let lastFire = 0;
        let firedOnce = false;

        // repeating every N mins
        const every = Number(midEveryMins || 0);
        if (every >= 1) {
          const handler = () => {
            const now = Date.now();
            if (now - lastFire < every * 60 * 1000) return;

            // don’t fire too early (must have actually started playback)
            if (!video.currentTime || video.currentTime < 15) return;

            lastFire = now;
            logAds(`VOD mid-roll firing every ${every} mins`);

            runVastAd(midTag, containerEl, {
              onBeforeAd: () => { try { video.pause(); } catch (_) {} },
              onComplete: () => { try { video.play().catch(() => {}); } catch (_) {} }
            });
          };

          // check about once per second
          const intervalId = setInterval(handler, 1000);

          // cleanup when leaving page (hash changes / re-render)
          video.addEventListener("ended", () => clearInterval(intervalId), { once: true });
          window.addEventListener("hashchange", () => clearInterval(intervalId), { once: true });
          return;
        }

        // fallback: single midpoint shot
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
              onComplete: () => { try { video.play().catch(() => {}); } catch (_) {} }
            });
          }
        };
        video.addEventListener("timeupdate", handler);
      });
    }
  }

  // ---------- LIVE: pre-roll + repeating mid-roll using CMS adFrequencyMins ----------
  function setupLiveAds({ containerEl, vastTag, frequencyMins }) {
    if (!containerEl || !vastTag) return;
    const mins = Number(frequencyMins || CONFIG.LIVE_AD_FREQUENCY_MINS_FALLBACK || 10);
    if (!mins || mins < 1) return;

    const getVideo = (cb, attempt = 0) => {
      const v = findVideoInContainer(containerEl);
      if (v) return cb(v);
      if (attempt < 12) return setTimeout(() => getVideo(cb, attempt + 1), 250);
    };

    // repeating mid-roll while LIVE item is playing
    getVideo((video) => {
      let lastFire = Date.now();

      const tick = () => {
        if (document.hidden) return;
        if (!video || video.paused) return;

        const now = Date.now();
        if (now - lastFire < mins * 60 * 1000) return;

        // avoid firing immediately on start
        if (!video.currentTime || video.currentTime < 10) return;

        lastFire = now;
        logAds(`LIVE mid-roll firing every ${mins} mins`);

        runVastAd(vastTag, containerEl, {
          onBeforeAd: () => { try { video.pause(); } catch (_) {} },
          onComplete: () => { try { video.play().catch(() => {}); } catch (_) {} }
        });
      };

      const intervalId = setInterval(tick, 1000);

      // cleanup
      window.addEventListener("hashchange", () => clearInterval(intervalId), { once: true });
      video.addEventListener("ended", () => clearInterval(intervalId), { once: true });
    });
  }

  // ---------- Global Ads + VAST orchestration ----------
   // ---------- IMA VAST runner ----------
  async function runVastAd(vastTag, containerEl, { onBeforeAd, onComplete } = {}) {
    if (!containerEl || !vastTag) return false;

    // Make sure container is positioned so overlay can be absolute
    ensureRelativePosition(containerEl);

    // Kill any Tap-to-Play button while ads run
    removeTapToPlay(containerEl);

    const adDiv = document.createElement("div");
    // IMPORTANT: Tailwind arbitrary value syntax (z-[99999]) — NOT z-99999
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

        // fail-safe so ads never hang playback
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

    // Pre-roll
    if (preTag) {
      getVideo((video) => {
        runVastAd(preTag, containerEl, {
          onBeforeAd: () => { try { video.pause(); } catch (_) {} },
          onComplete: () => { try { video.play().catch(() => {}); } catch (_) { addTapToPlayFallback(containerEl); } }
        });
      });
    }

    // Mid-roll: repeating interval OR single midpoint fallback
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

        // fallback: single midpoint shot
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

  // ---------- Global Ads + VAST orchestration ----------
  async function playWithAdsIfNeeded({ containerEl, isAvod, isLive, adConfig }) {
    if (!containerEl) return;

    const shouldPlayGlobal =
      (isAvod && CONFIG.PLAY_GLOBAL_ADS_ON_AVOD) || (isLive && CONFIG.PLAY_GLOBAL_ADS_ON_LIVE);

    // Global pod first (optional) — pause content so no double audio
    if (shouldPlayGlobal && Array.isArray(CONFIG.GLOBAL_ADS) && CONFIG.GLOBAL_ADS.length) {
      let restore = null;
      try {
        restore = pauseContentAudio(containerEl);
        logAds("Playing GLOBAL_ADS pod (in-player)");
        await playGlobalAdPod(CONFIG.GLOBAL_ADS, { mountEl: containerEl });
      } catch (_) {
      } finally {
        try { restore && restore(); } catch (_) {}
      }
    }

    // Now wire up VAST ads for VOD
    if (adConfig && (adConfig.preTag || adConfig.midTag)) {
      setupVodAds(adConfig, containerEl);
    }
  }

  // =========================================================
  // PLAYER MOUNT
  // =========================================================
  function mountPlayer({ playbackId, directUrl, wrapId = "playerWrap" }) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;

    ensureRelativePosition(wrap);

    const muxId = wrapId === "playerWrap" ? "muxPlayer" : `muxPlayer_${wrapId}`;
    const htmlId = wrapId === "playerWrap" ? "html5Player" : `html5Player_${wrapId}`;

    wrap.innerHTML = playbackId
      ? `
        <mux-player
          id="${muxId}"
          class="w-full h-full"
          stream-type="on-demand"
          playback-id="${esc(playbackId)}"
          metadata-video-title="WatchVIM"
          controls
          autoplay
          playsinline
        ></mux-player>
      `
      : `
        <video
          id="${htmlId}"
          class="w-full h-full"
          controls
          autoplay
          playsinline
          webkit-playsinline
        >
          <source src="${esc(directUrl || "")}" type="video/mp4" />
        </video>
      `;
  }

  function removeTapToPlay(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll(".wv-tap-to-play").forEach((x) => x.remove());
}

function addTapToPlayFallback(containerEl) {
  if (!containerEl) return;

  // If an ad overlay is active (VAST or Global Pod), do not show tap button.
  if (containerEl.querySelector(".wv-ad-overlay")) return;

  const muxEl = containerEl.querySelector("mux-player");
  const vid = findVideoInContainer(containerEl);
  if (!muxEl && !vid) return;

  // Don’t stack multiple
  removeTapToPlay(containerEl);

  const btn = document.createElement("button");
  btn.className =
    "wv-tap-to-play absolute inset-x-0 bottom-6 mx-auto w-fit px-4 py-2 rounded-full bg-watchRed text-white text-sm z-[10000]";
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

  // =========================================================
  // LAST WATCHED
  // =========================================================
  function readLastWatched() {
    try {
      return JSON.parse(localStorage.getItem("watchvim_last_watched") || "[]");
    } catch {
      return [];
    }
  }
  function saveLastWatched(items) {
    localStorage.setItem("watchvim_last_watched", JSON.stringify(items.slice(0, 20)));
  }
  function markWatched(titleId, progress = 0) {
    const items = readLastWatched().filter((x) => x.titleId !== titleId);
    items.unshift({ titleId, progress, at: Date.now() });
    saveLastWatched(items);
  }

  // =========================================================
  // SHELL
  // =========================================================
  function Header() {
    const tabs = ["Home", "Movies", "Series", "Shorts", "Foreign", "LIVE", "Search"];
    const loggedIn = !!state.user;

    return `
      <header class="sticky top-0 z-30 bg-watchBlack/95 backdrop-blur border-b border-white/10">
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
            ${tabs
              .map(
                (tab) => `
              <button
                class="tv-focus px-3 py-1.5 rounded-full ${
                  state.activeTab === tab ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10"
                }"
                onclick="${tab === "Search" ? "navTo('#/search')" : `setTab('${tab}')`}"
              >${tab}</button>
            `
              )
              .join("")}
          </nav>

          <div class="ml-auto flex gap-2 text-xs md:text-sm">
            ${
              loggedIn
                ? `
                  <button class="tv-focus px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="navTo('#/profile')">Profile</button>
                  <button class="tv-focus px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="signOut()">Log out</button>
                `
                : `
                  <button class="tv-focus px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="navTo('#/login?mode=login')">Log in</button>
                `
            }
          </div>
        </div>
      </header>
    `;
  }

  function MobileTabBar() {
    if (isTV()) return "";
    const items = ["Home", "Movies", "Series", "Shorts", "Foreign", "LIVE"];
    return `
      <footer class="fixed bottom-0 left-0 right-0 bg-watchBlack/95 border-t border-white/10">
        <div class="max-w-6xl mx-auto flex justify-around px-2 py-2">
          ${items
            .map(
              (tab) => `
            <button
              class="tv-focus flex-1 mx-1 py-2 rounded-lg text-[11px] ${
                state.activeTab === tab ? "bg-white text-black font-semibold" : "bg-white/10 text-white/80"
              }"
              onclick="setTab('${tab}')"
            >${tab}</button>
          `
            )
            .join("")}
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

    const slidesHtml = items
      .map((t, idx) => {
        const img = hero(t);
        const hasTrailer = !!t.trailerPlaybackId;

        return `
        <div class="hero-slide absolute inset-0 ${idx === 0 ? "" : "hidden"}" data-hero-slide="${idx}">
          <div class="w-full h-full relative">
            <div class="w-full h-full">
              ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover" />` : ""}
              <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-watchBlack via-watchBlack/40 to-transparent"></div>
              <div class="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-watchBlack/70 via-transparent to-transparent"></div>
            </div>

            ${
              hasTrailer
                ? `
                  <button
                    class="tv-focus absolute inset-0 flex items-center justify-center group"
                    onclick="navTo('#/watch/${t.id}?kind=trailer')"
                    data-hero-hover="${esc(t.trailerPlaybackId)}"
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
                <div class="text-[10px] md:text-xs uppercase tracking-[0.2em] text-watchGold/90">
                  ${typeLabel(t.type)}
                </div>
                <h1 class="text-xl md:text-4xl font-black leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  ${esc(t.title || "Untitled")}
                </h1>
                <p class="text-xs md:text-sm text-white/80 line-clamp-3 md:line-clamp-4">
                  ${esc(t.synopsis || t.description || "")}
                </p>

                <div class="flex flex-wrap gap-2 text-[10px] md:text-xs text-white/70">
                  ${t.releaseYear ? `<span class="px-2 py-1 rounded bg-black/60 border border-white/10">${esc(t.releaseYear)}</span>` : ""}
                  ${toMins(t.runtimeMins) ? `<span class="px-2 py-1 rounded bg-black/60 border border-white/10">${toMins(t.runtimeMins)} mins</span>` : ""}
                  ${(t.genre || []).slice(0, 4).map((g) => `<span class="px-2 py-1 rounded bg-black/60 border border-white/10">${esc(g)}</span>`).join("")}
                </div>

                <div class="pt-1 md:pt-2 flex flex-wrap gap-2">
                  <button
                    class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold text-xs md:text-sm hover:opacity-90"
                    onclick="navTo('#/${t.type === "series" ? "series" : "title"}/${t.id}')"
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
      })
      .join("");

    const dotsHtml =
      items.length > 1
        ? `
          <div class="absolute bottom-3 right-4 flex gap-1">
            ${items
              .map(
                (_t, idx) => `
              <button
                class="hero-dot w-2.5 h-2.5 rounded-full border border-white/40 ${idx === 0 ? "bg-white" : "bg-transparent"}"
                data-hero-dot="${idx}"
                aria-label="Go to slide ${idx + 1}"
              ></button>
            `
              )
              .join("")}
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
    if (heroCarouselTimer) {
      clearInterval(heroCarouselTimer);
      heroCarouselTimer = null;
    }
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

  function wireHeroHover() {
    if (isTV()) return;

    document.querySelectorAll("[data-hero-hover]").forEach((btn) => {
      const pb = btn.getAttribute("data-hero-hover");
      const container = btn.closest(".hero-slide") || btn.parentElement || btn;
      if (!pb || !container) return;

      let previewEl = null;
      let timer = null;

      btn.addEventListener("mouseenter", () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (previewEl) return;

          const imgEl = container.querySelector("img");
          if (imgEl) imgEl.classList.add("hidden");

          previewEl = document.createElement("mux-player");
          previewEl.setAttribute("stream-type", "on-demand");
          previewEl.setAttribute("playback-id", pb);
          previewEl.setAttribute("muted", "");
          previewEl.setAttribute("autoplay", "");
          previewEl.setAttribute("loop", "");
          previewEl.setAttribute("playsinline", "");
          previewEl.className = "absolute inset-0 w-full h-full object-cover";

          container.insertBefore(previewEl, container.firstChild);
        }, 250);
      });

      btn.addEventListener("mouseleave", () => {
        if (timer) clearTimeout(timer);
        if (previewEl) {
          previewEl.remove();
          previewEl = null;
          const imgEl = container.querySelector("img");
          if (imgEl) imgEl.classList.remove("hidden");
        }
      });
    });
  }

  // =========================================================
  // UI BLOCKS
  // =========================================================
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

  function LandingPage() {
    return `
      <section class="min-h-[calc(100vh-64px)] flex items-center justify-center bg-watchBlack px-4 md:px-8">
        <div class="max-w-6xl mx-auto grid md:grid-cols-2 gap-8 items-center">
          <div class="space-y-5 text-center md:text-left">
            <div class="inline-flex items-center gap-3">
              <img src="${esc(CONFIG.LOGO_URL)}" alt="WatchVIM" class="h-10 md:h-12 w-auto object-contain mx-auto md:mx-0"
                onerror="this.onerror=null;this.style.display='none';" />
              <span class="hidden md:inline text-[11px] uppercase tracking-[0.25em] text-watchGold/80">Streaming Platform</span>
            </div>

            <h1 class="text-3xl md:text-5xl font-black leading-tight">
              Cinema. Culture. <br><span class="text-watchGold">On Demand.</span>
            </h1>

            <p class="text-white/70 text-sm md:text-base max-w-xl mx-auto md:mx-0">
              WatchVIM brings films, series, and original stories together in one sleek destination.
              Stream free with ads, subscribe for ad-free access, or rent selected titles.
            </p>

            <div class="flex flex-col sm:flex-row gap-3 pt-1 justify-center md:justify-start">
              <button class="tv-focus px-6 py-3 rounded-full bg-watchRed font-bold text-sm md:text-base hover:opacity-90" onclick="navTo('#/home')">
                Enter WatchVIM
              </button>
              <button class="tv-focus px-6 py-3 rounded-full bg-white/5 border border-white/15 text-xs md:text-sm hover:bg-white/10" onclick="navTo('#/login?mode=signup')">
                Become a Member
              </button>
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
                playback-id="${PROMO_PLAYBACK_ID}"
                muted
                autoplay
                loop
                playsinline
                primary-color="#e50914"
              ></mux-player>
              <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function Card(t) {
    const img = poster(t);
    const href = t.type === "series" ? `#/series/${t.id}` : `#/title/${t.id}`;
    return `
      <button class="tile tv-focus text-left" onclick="navTo('${href}')">
        <div class="tile-poster rounded-xl overflow-hidden bg-white/5 border border-white/10">
          ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover" />` : ""}
        </div>
        <div class="mt-2 text-sm font-semibold line-clamp-2">${esc(t.title || "Untitled")}</div>
        <div class="text-xs text-white/60">${esc(typeLabel(t.type))}</div>
      </button>
    `;
  }

  function Row(name, items, viewAllTab = null) {
    if (!items.length) return "";
    const tabTarget = viewAllTab || name;
    return `
      <section class="mt-6 px-4 md:px-8">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-bold">${esc(name)}</h3>
          ${
            viewAllTab
              ? `<button class="tv-focus text-xs text-white/60 hover:text-white" onclick="setTab('${esc(tabTarget)}')">View all</button>`
              : ``
          }
        </div>
        <div class="row-scroll flex gap-3 overflow-x-auto pb-2">
          ${items.map(Card).join("")}
        </div>
      </section>
    `;
  }

  function HomePage() {
    const all = state.titles.slice();

    if (state.activeTab === "Home") {
      const featured = sortFeatured(featuredItems());
      const heroItems = (featured.length ? featured : all).slice(0, 6);

      const lastWatched = readLastWatched()
        .map((x) => state.byId.get(x.titleId))
        .filter(Boolean);

      const movies = all.filter(TAB_FILTERS.Movies);
      const series = all.filter(TAB_FILTERS.Series);
      const shorts = all.filter(TAB_FILTERS.Shorts);
      const foreign = all.filter(TAB_FILTERS.Foreign);

      return `
        ${HeroSection(heroItems)}
        <div class="py-6 space-y-2">
          ${lastWatched.length ? Row("Continue Watching", lastWatched.slice(0, 12)) : ""}
          ${Row("Top Movies & Docs", movies.slice(0, 20), "Movies")}
          ${Row("Top Series", series.slice(0, 20), "Series")}
          ${Row("Top Shorts", shorts.slice(0, 20), "Shorts")}
          ${Row("Top Foreign", foreign.slice(0, 20), "Foreign")}
        </div>
      `;
    }

    const filterFn = TAB_FILTERS[state.activeTab] || (() => true);
    const filtered = all.filter(filterFn);
    const heroItems = filtered.slice(0, 3);

    const byGenre = {};
    filtered.forEach((t) => {
      (t.genre || ["Featured"]).forEach((g) => {
        const key = g || "Featured";
        byGenre[key] = byGenre[key] || [];
        byGenre[key].push(t);
      });
    });

    const genreRows = Object.entries(byGenre)
      .slice(0, 8)
      .map(([g, items]) => Row(g, items.slice(0, 20)))
      .join("");

    return `
      ${HeroSection(heroItems)}
      <div class="py-6 space-y-6">
        ${Row(`Top ${state.activeTab}`, filtered.slice(0, 20))}
        ${genreRows}
      </div>
    `;
  }

  // =========================================================
  // CTA RENDERING
  // =========================================================
  function renderWatchCTA(t, kind = "content") {
    const isAVOD = isAvodTitle(t);
    const isSVOD = isSvodTitle(t);
    const hasTVODFlag = hasTvod(t);

    const isMember = isActiveSvodMember();
    const unlocked = isTVODUnlockedForTitle(t);

    const ctas = [];

    if (isAVOD && isSVOD) {
      ctas.push(`
        <button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
          onclick="navTo('#/watch/${t.id}?kind=content')">Watch with Ads</button>
      `);

      if (isMember) {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="navTo('#/watch/${t.id}?kind=content')">Watch Ad-Free</button>
        `);
      } else {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="${state.user ? `startMembershipCheckout('svod-monthly')` : `navTo('#/login?mode=signup')`}">Subscribe for Ad-Free</button>
        `);
      }

      return ctas.join("\n");
    }

    if (isAVOD) {
      ctas.push(`
        <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
          onclick="navTo('#/watch/${t.id}?kind=${encodeURIComponent(kind)}')">Watch with Ads</button>
      `);
      return ctas.join("\n");
    }

    if (isSVOD) {
      if (!state.user) {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="navTo('#/login?mode=login')">Log In to Watch</button>
        `);
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
            onclick="navTo('#/login?mode=signup')">Create Account</button>
        `);
      } else if (!isMember) {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="startMembershipCheckout('svod-monthly')">Unlock with Membership</button>
        `);
      } else {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="navTo('#/watch/${t.id}?kind=${encodeURIComponent(kind)}')">Watch Now</button>
        `);
      }
      return ctas.join("\n");
    }

    if (hasTVODFlag) {
      if (!state.user) {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="navTo('#/login?mode=login')">Log In to Rent/Buy</button>
        `);
      } else if (unlocked) {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="navTo('#/watch/${t.id}?kind=${encodeURIComponent(kind)}')">Watch Now</button>
        `);
      } else {
        ctas.push(`
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
            onclick="startTVODCheckout('${t.id}')">Rent / Buy</button>
        `);
      }
      return ctas.join("\n");
    }

    ctas.push(`
      <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
        onclick="navTo('#/watch/${t.id}?kind=${encodeURIComponent(kind)}')">Watch Free</button>
    `);
    return ctas.join("\n");
  }

  function PaywallPage(t, gate) {
    const reason = gate?.reason || "upgrade";
    const message = gate?.message || "This content requires access. Please log in or upgrade your membership.";

    const isLogin = reason === "login";
    const isTVOD = reason === "tvod";

    return `
      <div class="p-6 md:p-10 max-w-3xl mx-auto space-y-4">
        <div class="text-2xl md:text-3xl font-black">Access Required</div>
        <div class="text-white/70">${esc(message)}</div>

        <div class="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
          <div class="text-sm text-white/60">Title</div>
          <div class="text-lg font-semibold">${esc(t?.title || "Untitled")}</div>

          <div class="flex flex-wrap gap-2 pt-2">
            ${
              isLogin
                ? `
                  <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90" onclick="navTo('#/login?mode=login')">Log In</button>
                  <button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20" onclick="navTo('#/login?mode=signup')">Create Account</button>
                `
                : ""
            }
            ${
              isTVOD
                ? `<button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90" onclick="startTVODCheckout('${esc(t?.id || "")}')">Rent / Buy</button>`
                : ""
            }
            ${
              !isLogin && !isTVOD
                ? `<button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90" onclick="navTo('#/login?mode=signup')">Become a Member</button>`
                : ""
            }
            <button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20" onclick="history.length > 1 ? history.back() : navTo('#/home')">Go Back</button>
          </div>
        </div>
      </div>
    `;
  }

  function TitlePage(id) {
    const t = state.byId.get(id);
    if (!t) return NotFound("Title not found");

    const img = hero(t);

    const accessBadge = [
      isSvodTitle(t) ? "SVOD" : null,
      isAvodTitle(t) ? "AVOD" : null,
      hasTvod(t) ? "TVOD" : null
    ].filter(Boolean).join(" • ");

    return `
      <section class="relative">
        <div class="aspect-video bg-black">
          ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover opacity-90"/>` : ""}
          <div class="absolute inset-0 bg-gradient-to-t from-watchBlack via-watchBlack/40 to-transparent"></div>
        </div>

        <div class="p-4 md:p-8 -mt-12 md:-mt-20 relative z-10">
          <div class="max-w-4xl space-y-3">
            <button class="tv-focus text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>

            <div class="flex flex-wrap gap-2 text-xs text-white/70">
              <span class="px-2 py-1 rounded bg-white/10">${typeLabel(t.type)}</span>
              ${t.releaseYear ? `<span class="px-2 py-1 rounded bg-white/10">${esc(t.releaseYear)}</span>` : ""}
              ${toMins(t.runtimeMins) ? `<span class="px-2 py-1 rounded bg-white/10">${toMins(t.runtimeMins)} mins</span>` : ""}
              ${accessBadge ? `<span class="px-2 py-1 rounded bg-watchGold/20 text-watchGold">${accessBadge}</span>` : ""}
            </div>

            <h1 class="text-2xl md:text-4xl font-black">${esc(t.title || "Untitled")}</h1>
            <p class="text-white/80">${esc(t.synopsis || t.description || "")}</p>

            ${CreditsBlock(t)}

            <div class="flex flex-wrap gap-2 pt-2">
              ${t.trailerPlaybackId ? `<button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20" onclick="navTo('#/watch/${t.id}?kind=trailer')">Play Trailer</button>` : ""}
              ${renderWatchCTA(t, "content")}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function SeriesPage(id) {
    const s = state.byId.get(id);
    if (!s || s.type !== "series") return NotFound("Series not found");
    const img = hero(s);

    return `
      <section class="relative">
        <div class="aspect-video bg-black">
          ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover opacity-90"/>` : ""}
          <div class="absolute inset-0 bg-gradient-to-t from-watchBlack via-watchBlack/40 to-transparent"></div>
        </div>

        <div class="p-4 md:p-8 -mt-12 md:-mt-20 relative z-10">
          <div class="max-w-5xl space-y-3">
            <button class="tv-focus text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
            <div class="text-xs uppercase tracking-widest text-watchGold/90">Series</div>
            <h1 class="text-2xl md:text-4xl font-black">${esc(s.title || "Untitled")}</h1>
            <p class="text-white/80">${esc(s.synopsis || s.description || "")}</p>

            ${CreditsBlock(s)}

            <div class="pt-6 space-y-5">
              ${
                (s.seasons || []).map((season, si) => SeasonBlock(s, season, si)).join("") ||
                `<div class="text-white/60 text-sm">No seasons published yet.</div>`
              }
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function SeasonBlock(series, season, seasonIndex) {
    const episodes = season.episodes || [];
    return `
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">Season ${season.seasonNumber || seasonIndex + 1}</h2>
          <div class="text-xs text-white/60">${episodes.length} episodes</div>
        </div>
        <div class="space-y-2">
          ${episodes.map((ep, ei) => EpisodeRow(series, ep, seasonIndex, ei)).join("")}
        </div>
      </div>
    `;
  }

  function EpisodeRow(series, ep, seasonIndex, epIndex) {
    const img = ep.thumbnailUrl || series.posterUrl || "";
    return `
      <div class="flex gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
        <img src="${esc(img)}" class="w-20 h-28 object-cover rounded-md bg-black/40"/>
        <div class="flex-1 space-y-1">
          <div class="text-sm font-semibold">
            E${ep.episodeNumber || epIndex + 1} — ${esc(ep.title || "Untitled")}
          </div>
          <div class="text-xs text-white/60 line-clamp-2">${esc(ep.synopsis || ep.description || "")}</div>

          <div class="flex gap-2 pt-1">
            ${ep.trailerPlaybackId ? `<button class="tv-focus px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20" onclick="navTo('#/episode/${series.id}/${seasonIndex}/${epIndex}?kind=trailer')">Trailer</button>` : ""}
            <button class="tv-focus px-3 py-1.5 text-xs rounded bg-watchRed font-bold" onclick="navTo('#/episode/${series.id}/${seasonIndex}/${epIndex}?kind=content')">Watch</button>
          </div>
        </div>
      </div>
    `;
  }

  function MoreLikeThisBlock(current) {
    if (!current) return "";

    const all = state.titles || [];
    const currentGenres = (current.genre || []).map((g) => String(g).toLowerCase());
    const currentType = current.type;

    const recs = all
      .filter((t) => t && t.id !== current.id)
      .filter((t) => (!currentType || !t.type || t.type === currentType))
      .filter((t) => {
        if (!currentGenres.length) return true;
        const g2 = (t.genre || []).map((g) => String(g).toLowerCase());
        return g2.some((g) => currentGenres.includes(g));
      })
      .slice(0, 8);

    if (!recs.length) return "";

    const itemsHtml = recs.map((t) => {
      const img = poster(t) || hero(t) || "";
      const href = t.type === "series" ? "#/series/" + t.id : "#/title/" + t.id;
      return `
        <button class="tv-focus w-full text-left" onclick="navTo('${href}')">
          <div class="flex gap-2 items-center rounded-lg hover:bg-white/5 p-1.5">
            <div class="w-14 h-20 rounded-md overflow-hidden bg-black/40 border border-white/10 flex-shrink-0">
              ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover"/>` : ""}
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-semibold line-clamp-2">${esc(t.title || "Untitled")}</div>
              <div class="text-[11px] text-white/60 mt-0.5">
                ${esc(typeLabel(t.type))}
                ${t.releaseYear ? " • " + esc(t.releaseYear) : ""}
                ${toMins(t.runtimeMins) ? " • " + toMins(t.runtimeMins) + " mins" : ""}
              </div>
            </div>
          </div>
        </button>
      `;
    }).join("");

    return `
      <div class="bg-white/5 border border-white/10 rounded-2xl p-3 space-y-3">
        <div class="flex items-center justify-between mb-1">
          <div class="text-sm font-semibold">More like this</div>
        </div>
        <div class="space-y-2 max-h-[400px] overflow-y-auto pr-1">${itemsHtml}</div>
      </div>
    `;
  }

  function WatchPage(id, kind = "content") {
    const t = state.byId.get(id);
    if (!t) return NotFound("Title not found");

    const isTrailer = kind === "trailer";
    const gate = isTrailer ? { allowed: true, adMode: "none" } : checkAccessForPlayback(t);
    if (!gate.allowed) return PaywallPage(t, gate);

    const img = hero(t);

    const accessBadge = [
      isSvodTitle(t) ? "SVOD" : null,
      isAvodTitle(t) ? "AVOD" : null,
      hasTvod(t) ? "TVOD" : null
    ].filter(Boolean).join(" • ");

    return `
      <section class="p-4 md:p-8 space-y-4">
        <button class="tv-focus text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>

        <div class="grid lg:grid-cols-[2fr,1fr] gap-6 items-start mt-2">
          <div class="space-y-4">
            <div class="relative rounded-2xl overflow-hidden border border-white/10 bg-black">
              ${img ? `<img src="${esc(img)}" class="pointer-events-none absolute inset-0 w-full h-full object-cover opacity-20" alt=""/>` : ""}
              <div id="playerWrap" class="relative z-10 aspect-video w-full bg-black"></div>
              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
            </div>
          </div>

          <aside class="space-y-4">
            <div class="space-y-2">
              <div class="flex flex-wrap gap-2 text-[10px] md:text-xs text-white/70">
                <span class="px-2 py-1 rounded bg-white/10">${typeLabel(t.type)}</span>
                ${t.releaseYear ? `<span class="px-2 py-1 rounded bg-white/10">${esc(t.releaseYear)}</span>` : ""}
                ${toMins(t.runtimeMins) ? `<span class="px-2 py-1 rounded bg-white/10">${toMins(t.runtimeMins)} mins</span>` : ""}
                ${accessBadge ? `<span class="px-2 py-1 rounded bg-watchGold/20 text-watchGold">${accessBadge}</span>` : ""}
              </div>

              <h1 class="text-2xl md:text-4xl font-black">${esc(t.title || "Untitled")}</h1>
              <p class="text-sm md:text-base text-white/80">${esc(t.synopsis || t.description || "")}</p>
            </div>

            <div class="flex flex-wrap gap-2">
              ${t.trailerPlaybackId ? `<button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs md:text-sm" onclick="navTo('#/watch/${t.id}?kind=trailer')">Play Trailer</button>` : ""}
              ${renderWatchCTA(t, kind)}
            </div>

            ${CreditsBlock(t)}
            ${MoreLikeThisBlock(t)}
          </aside>
        </div>
      </section>
    `;
  }

  function EpisodeWatchPage(seriesId, seasonIndex, epIndex, kind = "content") {
    const s = state.byId.get(seriesId);
    const season = s?.seasons?.[Number(seasonIndex)];
    const ep = season?.episodes?.[Number(epIndex)];
    if (!s || !ep) return NotFound("Episode not found");

    const isTrailer = kind === "trailer";
    const monet = ep.monetization || s.monetization || {};
    const gate = isTrailer ? { allowed: true, adMode: "none" } : checkAccessForPlayback({ ...s, monetization: monet, id: s.id });
    if (!gate.allowed) return PaywallPage({ ...s, monetization: monet }, gate);

    const img = hero(s);
    const titleLine = `${s.title || "Series"} — S${season.seasonNumber || Number(seasonIndex) + 1}E${ep.episodeNumber || Number(epIndex) + 1} • ${ep.title || "Untitled"}`;

    return `
      <section class="p-4 md:p-8 space-y-4">
        <button class="tv-focus text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>

        <div class="grid lg:grid-cols-[2fr,1fr] gap-6 items-start mt-2">
          <div class="space-y-4">
            <div class="relative rounded-2xl overflow-hidden border border-white/10 bg-black">
              ${img ? `<img src="${esc(img)}" class="pointer-events-none absolute inset-0 w-full h-full object-cover opacity-20" alt=""/>` : ""}
              <div id="playerWrap" class="relative z-10 aspect-video w-full bg-black"></div>
              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
            </div>
          </div>

          <aside class="space-y-4">
            <div class="space-y-2">
              <div class="text-[11px] uppercase tracking-[0.2em] text-watchGold/80">Series • Episode</div>
              <h1 class="text-xl md:text-2xl font-black">${esc(titleLine)}</h1>
              <p class="text-sm md:text-base text-white/80">${esc(ep.synopsis || ep.description || "")}</p>
            </div>

            <div class="flex flex-wrap gap-2">
              ${ep.trailerPlaybackId ? `<button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs md:text-sm" onclick="navTo('#/episode/${seriesId}/${seasonIndex}/${epIndex}?kind=trailer')">Play Trailer</button>` : ""}
              <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90 text-xs md:text-sm" onclick="navTo('#/episode/${seriesId}/${seasonIndex}/${epIndex}?kind=content')">Play Episode</button>
            </div>

            ${CreditsBlock(ep)}
          </aside>
        </div>
      </section>
    `;
  }

  function SearchPage() {
    return `
      <div class="p-4 md:p-8 space-y-4">
        <div class="text-2xl font-bold">Search</div>
        <input id="searchInput" class="w-full px-4 py-3 rounded-xl bg-white/10 outline-none" placeholder="Search titles..." />
        <div id="searchResults" class="grid grid-cols-2 md:grid-cols-6 gap-3 mt-2"></div>
      </div>
    `;
  }

  function wireSearch() {
    const input = document.getElementById("searchInput");
    const results = document.getElementById("searchResults");
    if (!input || !results) return;

    const all = state.titles.slice();
    const show = (q) => {
      const qq = (q || "").toLowerCase();
      const f = all.filter((t) => (t.title || "").toLowerCase().includes(qq));
      results.innerHTML = f.map((t) => `
        <button class="tv-focus text-left group" onclick="navTo('#/${t.type === "series" ? "series" : "title"}/${t.id}')">
          <div class="tile-poster rounded-xl overflow-hidden bg-white/5">
            <img src="${esc(poster(t) || hero(t) || "")}" class="w-full h-full object-cover"/>
          </div>
          <div class="mt-2 text-sm line-clamp-1">${esc(t.title || "Untitled")}</div>
        </button>
      `).join("");
      if (isTV()) tvFocusReset();
    };

    input.addEventListener("input", (e) => show(e.target.value || ""));
    show("");
  }

  let loginView = "login";
  function setLoginView(view) {
    loginView = view === "signup" ? "signup" : "login";
    navTo(`#/login?mode=${loginView}`);
  }

  function LoginPage() {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return `
        <div class="p-6 max-w-md mx-auto space-y-3">
          <div class="text-2xl font-bold">Login</div>
          <div class="text-white/70 text-sm">Supabase isn’t configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to /config.json.</div>
        </div>
      `;
    }

    const isLogin = loginView === "login";
    return `
      <div class="p-6 max-w-md mx-auto space-y-5">
        <div class="text-2xl font-black">Welcome to WatchVIM</div>

        <div class="flex rounded-xl bg-white/5 border border-white/10 p-1 text-sm">
          <button class="tv-focus flex-1 py-2 rounded-lg ${isLogin ? "bg-white/15" : "hover:bg-white/10 text-white/70"}" onclick="setLoginView('login')">Log In</button>
          <button class="tv-focus flex-1 py-2 rounded-lg ${!isLogin ? "bg-white/15" : "hover:bg-white/10 text-white/70"}" onclick="setLoginView('signup')">Become a Member</button>
        </div>

        ${
          !isLogin
            ? `
              <div class="space-y-2">
                <div class="text-xs text-white/60">Full Name</div>
                <input id="signupName" class="w-full px-3 py-2 rounded bg-white/5 border border-white/10" placeholder="Your name"/>
              </div>
              <div class="space-y-2 mt-2">
                <div class="text-xs text-white/60">Choose Membership Plan</div>
                <div class="space-y-1 text-xs">
                  <label class="flex items-center gap-2"><input type="radio" name="membershipPlan" value="svod-monthly" checked /><span>Monthly — $5.99 / month</span></label>
                  <label class="flex items-center gap-2"><input type="radio" name="membershipPlan" value="svod-annual" /><span>Annual — $45.99 / year</span></label>
                </div>
              </div>
            `
            : ""
        }

        <div class="space-y-2">
          <div class="text-xs text-white/60">Email</div>
          <input id="loginEmail" class="w-full px-3 py-2 rounded bg-white/5 border border-white/10" placeholder="you@email.com"/>
        </div>

        <div class="space-y-2">
          <div class="text-xs text-white/60">Password</div>
          <input id="loginPass" type="password" class="w-full px-3 py-2 rounded bg-white/5 border border-white/10" placeholder="••••••••"/>
        </div>

        ${
          isLogin
            ? `<div class="text-right">
                <button class="tv-focus text-xs text-white/60 hover:text-white" onclick="handleForgotPassword()">Forgot Password?</button>
              </div>`
            : `
              <div class="space-y-2">
                <div class="text-xs text-white/60">Confirm Password</div>
                <input id="signupPass2" type="password" class="w-full px-3 py-2 rounded bg-white/5 border border-white/10" placeholder="••••••••"/>
              </div>
            `
        }

        <button class="tv-focus w-full px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90" onclick="${isLogin ? "handleSignIn()" : "handleSignUp()"}">
          ${isLogin ? "Log In" : "Create Account"}
        </button>
      </div>
    `;
  }

  // =========================================================
  // LOGIN HANDLERS
  // =========================================================
  async function handleSignIn() {
    const email = (document.getElementById("loginEmail")?.value || "").trim();
    const pass = (document.getElementById("loginPass")?.value || "").trim();
    if (!email || !pass) return alert("Enter email + password.");
    await signIn(email, pass);
  }

  async function handleSignUp() {
    const name = (document.getElementById("signupName")?.value || "").trim();
    const email = (document.getElementById("loginEmail")?.value || "").trim();
    const pass = (document.getElementById("loginPass")?.value || "").trim();
    const pass2 = (document.getElementById("signupPass2")?.value || "").trim();

    const planEl = document.querySelector('input[name="membershipPlan"]:checked');
    const plan = (planEl?.value || "svod-monthly").trim();

    if (!email || !pass) return alert("Enter email + password.");
    if (pass.length < 6) return alert("Password must be at least 6 characters.");
    if (pass !== pass2) return alert("Passwords do not match.");

    const { error } = await signUp(email, pass, name, plan);
    if (error) return;

    // If email confirmation is enabled in Supabase, user might need to confirm.
    // If you disabled confirmation, they should be logged in immediately.
    alert("Account created. If you see a confirmation email, please confirm it, then log in.");
    navTo("#/login?mode=login");
  }

  async function handleForgotPassword() {
    const client = await initSupabaseIfPossible();
    if (!client) return alert("Auth not configured.");
    const email = prompt("Enter your email to reset password:");
    if (!email) return;

    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/#/login?mode=login"
      });
      if (error) return alert(error.message);
      alert("Password reset email sent (if the email exists).");
    } catch (e) {
      alert("Could not send reset email.");
    }
  }

  // =========================================================
  // CHECKOUT HELPERS (SVOD / TVOD)
  // =========================================================
  function startMembershipCheckout(plan = "svod-monthly") {
    // Your checkout.html can read these params and build PayPal accordingly
    const url = `${CONFIG.TVOD_CHECKOUT_URL_BASE || "/checkout.html"}?product=svod&plan=${encodeURIComponent(plan)}`;
    window.location.href = url;
  }

  function startTVODCheckout(titleId) {
    const url = `${CONFIG.TVOD_CHECKOUT_URL_BASE || "/checkout.html"}?product=tvod&titleId=${encodeURIComponent(titleId || "")}`;
    window.location.href = url;
  }

  // =========================================================
  // PROFILE
  // =========================================================
  function ProfilePage() {
    const u = state.user || state.session?.user;
    if (!u) {
      return `
        <div class="p-6 max-w-xl mx-auto space-y-4">
          <div class="text-2xl font-black">Profile</div>
          <div class="text-white/70">You’re not logged in.</div>
          <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90" onclick="navTo('#/login?mode=login')">Log In</button>
        </div>
      `;
    }

    const info = currentMembershipInfo();
    const isMember = isActiveSvodMember();

    return `
      <div class="p-6 max-w-2xl mx-auto space-y-5">
        <div class="text-2xl font-black">Profile</div>

        <div class="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
          <div class="text-xs text-white/60">Email</div>
          <div class="text-lg font-semibold">${esc(u.email || "")}</div>

          <div class="grid md:grid-cols-2 gap-3 pt-3 text-sm">
            <div class="bg-white/5 border border-white/10 rounded-xl p-3">
              <div class="text-xs text-white/60">Membership Plan</div>
              <div class="font-semibold">${esc(info.plan || currentMembershipPlan() || "—")}</div>
            </div>
            <div class="bg-white/5 border border-white/10 rounded-xl p-3">
              <div class="text-xs text-white/60">Status</div>
              <div class="font-semibold">${esc(info.status || (isMember ? "ACTIVE" : "INACTIVE"))}</div>
            </div>
          </div>

          ${info.expiresAt ? `<div class="pt-2 text-xs text-white/60">Expires: ${esc(info.expiresAt)}</div>` : ""}
        </div>

        <div class="flex flex-wrap gap-2">
          ${isMember ? "" : `
            <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90" onclick="startMembershipCheckout('svod-monthly')">
              Subscribe (Monthly $5.99)
            </button>
            <button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20" onclick="startMembershipCheckout('svod-annual')">
              Subscribe (Annual $45.99)
            </button>
          `}
          <button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20" onclick="signOut(); navTo('#/home')">Log out</button>
        </div>
      </div>
    `;
  }

  // =========================================================
  // LIVE (LOOP CHANNEL)
  // =========================================================
  function pickLiveChannelBlock() {
    const c = state.catalog || {};
    return (
      c.loopChannel ||
      c.liveChannel ||
      c.channels?.live ||
      c.channels?.LIVE ||
      c.live ||
      c.LIVE ||
      null
    );
  }

  function buildLiveAdsSettings() {
    const ch = pickLiveChannelBlock() || {};
    const adv = ch.advertising || ch.ads || state.catalog?.advertising || state.catalog?.ads || {};

    // Vast tag priority: channel -> catalog -> config
    const vastTag = pickFirstString(
      adv.vastTag,
      adv.prerollTag,
      adv.preRollVastTag,
      adv.preRollTag,
      ch.vastTag,
      ch.prerollTag,
      ch.preRollVastTag,
      CONFIG.VAST_TAG
    );

    // frequency range support (7-12)
    const min =
      numOrNull(adv.adFrequencyMinsMin) ??
      numOrNull(adv.midRollEveryMinsMin) ??
      numOrNull(ch.adFrequencyMinsMin) ??
      numOrNull(ch.midRollEveryMinsMin) ??
      null;

    const max =
      numOrNull(adv.adFrequencyMinsMax) ??
      numOrNull(adv.midRollEveryMinsMax) ??
      numOrNull(ch.adFrequencyMinsMax) ??
      numOrNull(ch.midRollEveryMinsMax) ??
      null;

    // single value fallback
    const single =
      numOrNull(adv.adFrequencyMins) ??
      numOrNull(adv.midRollEveryMins) ??
      numOrNull(ch.adFrequencyMins) ??
      numOrNull(ch.midRollEveryMins) ??
      null;

    return {
      vastTag,
      minMins: min,
      maxMins: max,
      fallbackMins: single || CONFIG.LIVE_AD_FREQUENCY_MINS_FALLBACK || 10
    };
  }

  function randomBetween(min, max) {
    const a = Number(min), b = Number(max);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return lo + Math.random() * (hi - lo);
  }

  // Override LIVE ads to support random range + preroll
  function setupLiveAds({ containerEl, vastTag, frequencyMins, frequencyMinsMin, frequencyMinsMax, doPreroll = true }) {
    if (!containerEl || !vastTag) return;

    const v = () => findVideoInContainer(containerEl);

    const getMin = Number(frequencyMinsMin || 0);
    const getMax = Number(frequencyMinsMax || 0);
    const fixed = Number(frequencyMins || 0);

    const nextDelayMins = () => {
      if (getMin > 0 && getMax > 0) return randomBetween(getMin, getMax) || CONFIG.LIVE_AD_FREQUENCY_MINS_FALLBACK;
      if (fixed > 0) return fixed;
      return CONFIG.LIVE_AD_FREQUENCY_MINS_FALLBACK || 10;
    };

    let nextAt = Date.now() + nextDelayMins() * 60 * 1000;

    const ensureStartPlayback = async () => {
      const video = v();
      if (!video) return;
      try { await video.play(); } catch (_) {}
    };

    const fireAd = () => {
      const video = v();
      if (!video) return;

      runVastAd(vastTag, containerEl, {
        onBeforeAd: () => { try { video.pause(); } catch (_) {} },
        onComplete: () => {
          try { video.play().catch(() => {}); } catch (_) {}
          nextAt = Date.now() + nextDelayMins() * 60 * 1000;
        }
      });
    };

    // Pre-roll once
    if (doPreroll) {
      setTimeout(() => {
        const video = v();
        if (!video) return;
        fireAd();
      }, 350);
    }

    // Repeating mid-roll timer
    const intervalId = setInterval(() => {
      const video = v();
      if (!video) return;
      if (document.hidden) return;
      if (video.paused) return;
      if (!video.currentTime || video.currentTime < 10) return;

      if (Date.now() >= nextAt) {
        logAds(`LIVE mid-roll firing (next window reached)`);
        fireAd();
      }
    }, 1000);

    // cleanup
    window.addEventListener("hashchange", () => clearInterval(intervalId), { once: true });
    const video0 = v();
    if (video0) video0.addEventListener("ended", () => clearInterval(intervalId), { once: true });

    // Make sure playback starts (autoplay can be blocked on some devices)
    ensureStartPlayback();
  }

  function getLoopQueueFromCatalog() {
    const c = state.catalog || {};
    const ch = pickLiveChannelBlock() || {};

    const raw =
      ch.queue ||
      ch.items ||
      ch.titles ||
      ch.playlist ||
      c.loopQueue ||
      c.liveQueue ||
      [];

    const resolveItem = (it) => {
      if (!it) return null;

      // id ref
      if (typeof it === "string") {
        const t = state.byId.get(it);
        if (!t) return null;
        return { ref: t, ...t };
      }

      const id =
        it.id || it.refId || it.titleId || it.contentId || it?.ref?.id || it?.ref?.refId || null;

      const t = id ? (state.byId.get(String(id)) || it) : it;

      return { ref: t, ...t };
    };

    let items = Array.isArray(raw) ? raw.map(resolveItem).filter(Boolean) : [];

    // fallback: any title tagged live / channel
    if (!items.length) {
      items = state.titles
        .filter((t) => t && (t.isLive === true || (t.tags || []).some((x) => /live/i.test(String(x)))))
        .map((t) => ({ ref: t, ...t }));
    }

    // must have playable asset
    items = items
      .map((t) => {
        const playbackId =
          t.livePlaybackId ||
          t.playbackId ||
          t.contentPlaybackId ||
          t.muxPlaybackId ||
          null;

        const directUrl =
          firstUrl(t.streamUrl, t.videoUrl, t.src, t.url) || null;

        return {
          ...t,
          __playbackId: playbackId,
          __directUrl: directUrl
        };
      })
      .filter((t) => t.__playbackId || t.__directUrl);

    return items;
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function initLoopQueue() {
    const q = getLoopQueueFromCatalog();
    const ch = pickLiveChannelBlock() || {};
    const shouldShuffle = ch.shuffle !== false; // default true

    state.loop.queue = shouldShuffle ? shuffleInPlace(q.slice()) : q.slice();
    state.loop.index = 0;
    state.loop.playingAd = false;
  }

  function currentLoopItem() {
    const q = state.loop.queue || [];
    if (!q.length) return null;
    const i = Math.max(0, Math.min(state.loop.index || 0, q.length - 1));
    return q[i] || null;
  }

  function advanceLoop() {
    const q = state.loop.queue || [];
    if (!q.length) return;
    state.loop.index = (state.loop.index + 1) % q.length;
    render();
  }

  function LoopPage() {
    const item = currentLoopItem();
    if (!item) {
      return `
        <div class="p-6 max-w-3xl mx-auto space-y-3">
          <div class="text-2xl font-black">LIVE</div>
          <div class="text-white/70">No LIVE items found in your catalog/channel.</div>
          <div class="text-xs text-white/60">Tip: publish a loopChannel queue in your CMS (ids or items with playbackId).</div>
        </div>
      `;
    }

    return `
      <section class="p-4 md:p-8 space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs uppercase tracking-[0.25em] text-watchGold/80">LIVE</div>
            <div class="text-xl md:text-2xl font-black">${esc(item.title || item.name || "Now Playing")}</div>
          </div>
        </div>

        <div class="relative rounded-2xl overflow-hidden border border-white/10 bg-black">
          <div id="playerWrap" class="relative aspect-video w-full bg-black"></div>
        </div>

        <div class="text-xs text-white/60">
          LIVE plays continuously (no manual next). Ads should run pre-roll + repeating mid-roll on AVOD.
        </div>
      </section>
    `;
  }

  // =========================================================
  // TV FOCUS (D-PAD)
  // =========================================================
  function tvFocusableElements() {
    return Array.from(document.querySelectorAll(".tv-focus"))
      .filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  }

  function tvFindNearest(fromEl, dir) {
    const all = tvFocusableElements();
    if (!fromEl || !all.length) return null;

    const from = centerOf(fromEl);
    let best = null;
    let bestScore = Infinity;

    for (const el of all) {
      if (el === fromEl) continue;
      const to = centerOf(el);

      const dx = to.x - from.x;
      const dy = to.y - from.y;

      // directional filter
      if (dir === "left" && dx >= -5) continue;
      if (dir === "right" && dx <= 5) continue;
      if (dir === "up" && dy >= -5) continue;
      if (dir === "down" && dy <= 5) continue;

      // score: favor closer + more aligned
      const dist = Math.hypot(dx, dy);
      const align = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = dist + align * 1.5;

      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function tvFocusReset() {
    if (!isTV()) return;
    const all = tvFocusableElements();
    if (!all.length) return;
    const active = document.activeElement;
    if (!active || !active.classList?.contains("tv-focus")) {
      all[0].focus();
      all[0].classList?.add("focus-ring");
    }
  }

  function tvFocusMove(dir) {
    if (!isTV()) return;
    const active = document.activeElement;
    const target = tvFindNearest(active, dir);
    if (target) {
      document.querySelectorAll(".tv-focus").forEach((x) => x.classList.remove("focus-ring"));
      target.focus();
      target.classList.add("focus-ring");
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  window.addEventListener("keydown", (e) => {
    if (!isTV()) return;

    const key = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
      e.preventDefault();
      tvFocusMove(
        key === "ArrowLeft" ? "left" :
        key === "ArrowRight" ? "right" :
        key === "ArrowUp" ? "up" : "down"
      );
    }
  });

  // =========================================================
  // MISC RENDER HELPERS
  // =========================================================
  function NotFound(msg = "Not found") {
    return `
      <div class="p-8 max-w-2xl mx-auto space-y-3">
        <div class="text-2xl font-black">Oops</div>
        <div class="text-white/70">${esc(msg)}</div>
        <button class="tv-focus px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90" onclick="navTo('#/home')">Go Home</button>
      </div>
    `;
  }

  function renderLoading() {
    app.innerHTML = `
      <div class="min-h-screen bg-watchBlack">
        ${Header()}
        <div class="p-8 max-w-5xl mx-auto">
          <div class="animate-pulse space-y-4">
            <div class="h-8 w-56 bg-white/10 rounded"></div>
            <div class="h-4 w-96 bg-white/10 rounded"></div>
            <div class="h-64 w-full bg-white/10 rounded-2xl"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderError(err) {
    app.innerHTML = `
      <div class="min-h-screen bg-watchBlack">
        ${Header()}
        <div class="p-8 max-w-3xl mx-auto space-y-3">
          <div class="text-2xl font-black">Error</div>
          <div class="text-white/70">${esc(err?.message || String(err || "Unknown error"))}</div>
          <button class="tv-focus px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20" onclick="location.reload()">Reload</button>
        </div>
      </div>
    `;
  }

  // =========================================================
  // MAIN RENDER
  // =========================================================
  async function afterRender() {
    // keep loginView in sync with route
    if (state.route?.name === "login") {
      loginView = (state.route.params?.mode || "login") === "signup" ? "signup" : "login";
    }

    // HERO
    if (state.route?.name === "home") {
      const featured = sortFeatured(featuredItems());
      const heroItems = (featured.length ? featured : state.titles).slice(0, 6);
      setupHeroCarousel(heroItems.length);
      wireHeroHover();
    }

    // SEARCH
    if (state.route?.name === "search") {
      wireSearch();
    }

    // WATCH TITLE
    if (state.route?.name === "watch") {
      const id = state.route.params?.id;
      const kind = state.route.params?.kind || "content";
      const t = state.byId.get(id);
      if (!t) return;

      const isTrailer = kind === "trailer";
      const gate = isTrailer ? { allowed: true, adMode: "none" } : checkAccessForPlayback(t);
      if (!gate.allowed) return;

      const pb = muxIdFor(t, kind) || t.contentPlaybackId || t.playbackId;
      mountPlayer({ playbackId: pb, wrapId: "playerWrap" });

      const wrap = document.getElementById("playerWrap");
      addTapToPlayFallback(wrap);

      if (!isTrailer) {
        const adConfig = adConfigForTitle(t, gate.adMode);
        await playWithAdsIfNeeded({
          containerEl: wrap,
          isAvod: gate.adMode === "avod",
          isLive: false,
          adConfig
        });
      }

      // mark last watched when possible
      try {
        const v = findVideoInContainer(wrap);
        if (v) {
          v.addEventListener("timeupdate", () => {
            const p = v.duration ? (v.currentTime / v.duration) : 0;
            markWatched(t.id, p);
          });
        }
      } catch (_) {}
    }

    // WATCH EPISODE
    if (state.route?.name === "episode") {
      const { seriesId, seasonIndex, epIndex, kind } = state.route.params || {};
      const s = state.byId.get(seriesId);
      const season = s?.seasons?.[Number(seasonIndex)];
      const ep = season?.episodes?.[Number(epIndex)];
      if (!s || !ep) return;

      const isTrailer = (kind || "content") === "trailer";
      const monet = ep.monetization || s.monetization || {};
      const gate = isTrailer ? { allowed: true, adMode: "none" } : checkAccessForPlayback({ ...s, monetization: monet, id: s.id });
      if (!gate.allowed) return;

      const pb = (kind === "trailer" ? ep.trailerPlaybackId : ep.contentPlaybackId) || ep.playbackId;
      mountPlayer({ playbackId: pb, wrapId: "playerWrap" });

      const wrap = document.getElementById("playerWrap");
      addTapToPlayFallback(wrap);

      if (!isTrailer) {
        const adConfig = adConfigForEpisode(s, ep, gate.adMode);
        await playWithAdsIfNeeded({
          containerEl: wrap,
          isAvod: gate.adMode === "avod",
          isLive: false,
          adConfig
        });
      }
    }

    // LIVE LOOP (THIS IS WHAT WAS MISSING FOR YOUR ADS)
    if (state.route?.name === "loop") {
      const item = currentLoopItem();
      const wrap = document.getElementById("playerWrap");
      if (!item || !wrap) return;

      // mount content
      mountPlayer({
        playbackId: item.__playbackId,
        directUrl: item.__directUrl,
        wrapId: "playerWrap"
      });

      addTapToPlayFallback(wrap);

      // auto advance when finished
      setTimeout(() => {
        const v = findVideoInContainer(wrap);
        if (!v) return;
        v.addEventListener("ended", () => advanceLoop(), { once: true });
      }, 250);

      // GLOBAL POD (optional)
      if (CONFIG.PLAY_GLOBAL_ADS_ON_LIVE && Array.isArray(CONFIG.GLOBAL_ADS) && CONFIG.GLOBAL_ADS.length) {
        try { await playGlobalAdPod(CONFIG.GLOBAL_ADS); } catch (_) {}
      }

      // VAST LIVE ADS (pre + repeating)
      const ok = await ensureImaLoaded();
      if (!ok) return;

      const liveAds = buildLiveAdsSettings();
      if (!liveAds.vastTag) {
        logAds("LIVE: No VAST tag found (channel/catalog/config).");
        return;
      }

      // Treat LIVE channel as AVOD: always run ads here
      setupLiveAds({
        containerEl: wrap,
        vastTag: liveAds.vastTag,
        frequencyMins: liveAds.fallbackMins,
        frequencyMinsMin: liveAds.minMins,
        frequencyMinsMax: liveAds.maxMins,
        doPreroll: true
      });
    }

    // TV focus
    setTimeout(() => tvFocusReset(), 50);
  }

  function render() {
    state.route = parseHash();

    // sync active tab from route when applicable
    if (state.route.name === "home") {
      const tab = state.route.params?.tab;
      if (tab && TAB_FILTERS[tab]) state.activeTab = tab;
      else if (!state.activeTab) state.activeTab = "Home";
    }

    // pages
    let body = "";
    switch (state.route.name) {
      case "landing":
        body = LandingPage();
        break;
      case "home":
        body = HomePage();
        break;
      case "title":
        body = TitlePage(state.route.params.id);
        break;
      case "series":
        body = SeriesPage(state.route.params.id);
        break;
      case "watch":
        body = WatchPage(state.route.params.id, state.route.params.kind || "content");
        break;
      case "episode":
        body = EpisodeWatchPage(
          state.route.params.seriesId,
          state.route.params.seasonIndex,
          state.route.params.epIndex,
          state.route.params.kind || "content"
        );
        break;
      case "loop":
        state.activeTab = "LIVE";
        body = LoopPage();
        break;
      case "search":
        body = SearchPage();
        break;
      case "login":
        body = LoginPage();
        break;
      case "profile":
        body = ProfilePage();
        break;
      default:
        body = NotFound("Page not found");
    }

    app.innerHTML = `
      <div class="min-h-screen bg-watchBlack">
        ${Header()}
        <main class="${isTV() ? "" : "pb-20"}">
          ${body}
        </main>
        ${MobileTabBar()}
      </div>
    `;

    // expose focus ring styling on click too
    document.querySelectorAll(".tv-focus").forEach((el) => {
      el.addEventListener("focus", () => el.classList.add("focus-ring"));
      el.addEventListener("blur", () => el.classList.remove("focus-ring"));
    });

    // run post-render hooks
    afterRender().catch((e) => console.warn("[WatchVIM] afterRender error", e));
  }

  // =========================================================
  // EXPOSE GLOBALS FOR INLINE onclick=""
  // =========================================================
  window.navTo = navTo;
  window.setTab = setTab;
  window.signOut = signOut;
  window.signIn = signIn;
  window.signUp = signUp;

  window.handleSignIn = handleSignIn;
  window.handleSignUp = handleSignUp;
  window.handleForgotPassword = handleForgotPassword;

  window.startMembershipCheckout = startMembershipCheckout;
  window.startTVODCheckout = startTVODCheckout;

  // =========================================================
  // BOOT
  // =========================================================
  (async function boot() {
    try {
      injectGlobalStyles();
      await loadConfigJSON();
      await initSupabaseIfPossible();
      await loadData();

      // If no hash, show landing. Otherwise render route.
      if (!window.location.hash) {
        state.route = { name: "landing", params: {} };
        render();
      } else {
        render();
      }
    } catch (e) {
      console.error(e);
      renderError(e);
    }
  })();
})();
