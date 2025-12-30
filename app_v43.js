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

   Core goals (do NOT redesign layout):
   - Landing page at root (no hash) → “Enter WatchVIM” → #/home
   - Landing page includes Mux promo playback (PROMO_PLAYBACK_ID)
   - Manifest -> Catalog loading
   - Logo + theme from /config.json (overrides defaults)
   - Hero carousel for featured titles
   - Tabs + title/series drilldowns
   - Mux playback pages
   - Optional Supabase auth (login + signup + membership)
   - Paywall logic for AVOD / SVOD / TVOD (supports hybrids)
   - Ads: AVOD ONLY. SVOD must be ad-free.

   Notes:
   - This file is self-contained and expects index.html to have:
       <div id="app"></div>
   - You can keep your existing HTML/CSS. This JS uses minimal inline styling
     and classNames you can map to Tailwind or your CSS file.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------------------
     1) Defaults + Config
  --------------------------- */
  const DEFAULTS = {
    BRAND_NAME: 'WatchVIM',
    LOGO_URL: '',
    THEME: {
      watchBlack: '#0a0a0a',
      watchRed: '#e50914',
      watchGold: '#d4af37',
      text: '#ffffff',
      muted: 'rgba(255,255,255,0.72)',
      card: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.12)'
    },

    // Your stable endpoints should live in config.json
    MANIFEST_URL: '',
    CATALOG_URL_FALLBACK: '',

    // Mux
    PROMO_PLAYBACK_ID: '',

    // Ads (AVOD only)
    AVOD_ADS_ENABLED: true,
    // If you have a VAST tag, place it in config.json
    VAST_TAG_URL: '',

    // Optional auth
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',

    // Membership tiers / labels
    MEMBERSHIP: {
      AVOD: 'AVOD',
      SVOD: 'SVOD',
      TVOD: 'TVOD'
    },

    // Playback rules
    PAYWALL: {
      // If true, restrict certain titles to paid tiers
      enabled: true
    }
  };

  const state = {
    config: structuredClone(DEFAULTS),
    manifest: null,
    catalog: null,

    // Session / user
    user: null,
    membership: 'AVOD', // default: free with ads
    purchased: new Set(),

    // UI
    route: '',
    isTV: false,
    lastFocusEl: null
  };

  const elApp = document.getElementById('app');
  if (!elApp) {
    console.error('[WatchVIM] Missing #app container in index.html');
    return;
  }

  /* ---------------------------
     2) Utilities
  --------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function safeText(s) {
    return (s == null) ? '' : String(s);
  }

  function setCSSVars(theme) {
    const r = document.documentElement;
    r.style.setProperty('--watchBlack', theme.watchBlack);
    r.style.setProperty('--watchRed', theme.watchRed);
    r.style.setProperty('--watchGold', theme.watchGold);
    r.style.setProperty('--watchText', theme.text);
    r.style.setProperty('--watchMuted', theme.muted);
    r.style.setProperty('--watchCard', theme.card);
    r.style.setProperty('--watchBorder', theme.border);
  }

  function isProbablyTV() {
    // Basic heuristic: TV devices / webviews often expose coarse pointer + large screens.
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const w = Math.max(window.innerWidth, window.innerHeight);
    return coarse && w >= 900;
  }

  function hashRoute() {
    // Default route is landing (no hash)
    const h = window.location.hash || '';
    if (!h || h === '#') return '';
    return h.replace(/^#/, '');
  }

  function navTo(path) {
    if (!path.startsWith('/')) path = '/' + path;
    window.location.hash = '#' + path;
  }

  function saveLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function loadLocal(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  }

  function fmtTime(mins) {
    if (!Number.isFinite(mins)) return '';
    const m = Math.max(0, Math.floor(mins));
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? `${h}h ${r}m` : `${r}m`;
  }

  function uniqBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const x of (arr || [])) {
      const k = keyFn(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  /* ---------------------------
     3) Data Loading (config/manifest/catalog)
  --------------------------- */
  async function loadConfig() {
    try {
      const res = await fetch('/config.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('config.json not found');
      const cfg = await res.json();

      // Merge shallowly with defaults; theme merges deeply
      state.config = {
        ...DEFAULTS,
        ...cfg,
        THEME: { ...DEFAULTS.THEME, ...(cfg.THEME || {}) },
        MEMBERSHIP: { ...DEFAULTS.MEMBERSHIP, ...(cfg.MEMBERSHIP || {}) },
        PAYWALL: { ...DEFAULTS.PAYWALL, ...(cfg.PAYWALL || {}) }
      };

      setCSSVars(state.config.THEME);
      document.title = state.config.BRAND_NAME || DEFAULTS.BRAND_NAME;
    } catch (e) {
      console.warn('[WatchVIM] Using default config (config.json missing or invalid).', e);
      state.config = structuredClone(DEFAULTS);
      setCSSVars(state.config.THEME);
    }

    // Restore membership selection (if you allow user to choose)
    const savedTier = loadLocal('wv_membership', null);
    if (savedTier && typeof savedTier === 'string') state.membership = savedTier;

    const savedPurchased = loadLocal('wv_purchased', []);
    if (Array.isArray(savedPurchased)) state.purchased = new Set(savedPurchased);

    state.isTV = isProbablyTV();
  }

  async function loadManifestAndCatalog() {
    const { MANIFEST_URL, CATALOG_URL_FALLBACK } = state.config;

    // Load manifest
    if (MANIFEST_URL) {
      try {
        const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error('manifest fetch failed');
        state.manifest = await r.json();
      } catch (e) {
        console.warn('[WatchVIM] Manifest failed to load:', e);
        state.manifest = null;
      }
    }

    // Determine catalog URL
    let catalogUrl = '';
    if (state.manifest?.catalogUrl) catalogUrl = state.manifest.catalogUrl;
    if (!catalogUrl && CATALOG_URL_FALLBACK) catalogUrl = CATALOG_URL_FALLBACK;

    if (!catalogUrl) {
      console.warn('[WatchVIM] Missing catalog URL. Set manifest.catalogUrl or CATALOG_URL_FALLBACK in config.json');
      state.catalog = { featured: [], rows: [], titles: [] };
      return;
    }

    // Load catalog
    try {
      const r = await fetch(catalogUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error('catalog fetch failed');
      state.catalog = await r.json();
    } catch (e) {
      console.warn('[WatchVIM] Catalog failed to load:', e);
      state.catalog = { featured: [], rows: [], titles: [] };
    }
  }

  /* ---------------------------
     4) Optional Supabase Auth
  --------------------------- */
  let supabase = null;

  async function initSupabase() {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = state.config;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    // Expect @supabase/supabase-js loaded via index.html OR fall back to ESM import
    if (window.supabase?.createClient) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
      console.warn('[WatchVIM] Supabase client not found on window. Add supabase-js script to index.html to enable auth.');
      return;
    }

    try {
      const { data } = await supabase.auth.getSession();
      state.user = data?.session?.user || null;
    } catch {
      state.user = null;
    }

    // Listen for auth changes
    try {
      supabase.auth.onAuthStateChange((_event, session) => {
        state.user = session?.user || null;
        // If your membership is stored in Supabase, refresh it here:
        refreshMembershipFromProfile().catch(() => {});
        render();
      });
    } catch {}
  }

  async function refreshMembershipFromProfile() {
    if (!supabase || !state.user) return;

    // Example: you store tier on a "profiles" table as "membership_tier"
    // Adjust table/column names to match your DB
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('membership_tier,purchased_titles')
        .eq('id', state.user.id)
        .maybeSingle();

      if (!error && data) {
        if (data.membership_tier) {
          state.membership = String(data.membership_tier);
          saveLocal('wv_membership', state.membership);
        }
        if (Array.isArray(data.purchased_titles)) {
          state.purchased = new Set(data.purchased_titles.map(String));
          saveLocal('wv_purchased', Array.from(state.purchased));
        }
      }
    } catch {}
  }

  /* ---------------------------
     5) Membership + Paywall helpers
  --------------------------- */
  function isSVOD() {
    return String(state.membership).toUpperCase() === String(state.config.MEMBERSHIP.SVOD).toUpperCase();
  }
  function isAVOD() {
    return String(state.membership).toUpperCase() === String(state.config.MEMBERSHIP.AVOD).toUpperCase();
  }
  function isTVOD() {
    return String(state.membership).toUpperCase() === String(state.config.MEMBERSHIP.TVOD).toUpperCase();
  }

  function titleRequiresPayment(title) {
    // Convention: title.access can be "free" | "svod" | "tvod" | "hybrid"
    // If not present, default to free.
    const access = (title?.access || 'free').toLowerCase();

    if (!state.config.PAYWALL?.enabled) return false;

    if (access === 'free') return false;
    if (access === 'svod') return !isSVOD();
    if (access === 'tvod') {
      // TVOD: either purchased OR SVOD (optional hybrid)
      return !(state.purchased.has(String(title.id)) || isSVOD());
    }
    if (access === 'hybrid') {
      // Paid content: SVOD OR purchased
      return !(isSVOD() || state.purchased.has(String(title.id)));
    }
    return false;
  }

  function ensureCanPlay(title) {
    if (!title) return { ok: false, reason: 'Missing title' };
    if (!title.playbackId) return { ok: false, reason: 'Missing playback' };
    if (titleRequiresPayment(title)) return { ok: false, reason: 'PAYWALL' };
    return { ok: true };
  }

  function goToCheckout(mode, titleId = '') {
    // checkout.html should read query params and drive PayPal
    const u = new URL('/checkout.html', window.location.origin);
    if (mode) u.searchParams.set('mode', mode);
    if (titleId) u.searchParams.set('titleId', titleId);
    window.location.href = u.toString();
  }

  /* ---------------------------
     6) Rendering Helpers
  --------------------------- */
  function mount(html) {
    elApp.innerHTML = html;
  }

  function appShell({ contentHtml, showNav = true }) {
    const { BRAND_NAME, LOGO_URL } = state.config;

    return `
      <div class="wv-root" style="min-height:100vh;background:var(--watchBlack);color:var(--watchText);">
        ${showNav ? topNav(BRAND_NAME, LOGO_URL) : ''}
        <main class="wv-main" style="padding: 12px 16px 48px 16px;">
          ${contentHtml}
        </main>
        ${showNav ? bottomNav() : ''}
      </div>
    `;
  }

  function topNav(brand, logoUrl) {
    const isAuthed = !!state.user;
    const tier = safeText(state.membership || 'AVOD');

    return `
      <header class="wv-top" style="position:sticky;top:0;z-index:20;background:linear-gradient(to bottom, rgba(10,10,10,0.92), rgba(10,10,10,0.65));backdrop-filter: blur(10px);padding: 12px 16px;border-bottom:1px solid var(--watchBorder);">
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;min-width:180px;">
            ${logoUrl ? `<img src="${logoUrl}" alt="${safeText(brand)}" style="height:28px;width:auto;object-fit:contain;">`
                      : `<div style="font-weight:800;letter-spacing:0.5px;">${safeText(brand)}</div>`}
          </div>

          <div style="display:flex;align-items:center;gap:10px;">
            <button class="wv-pill" data-focus="1" id="wvTierBtn"
              style="border:1px solid var(--watchBorder);background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:999px;color:var(--watchText);font-size:12px;">
              ${isSVOD() ? 'SVOD (Ad‑Free)' : isAVOD() ? 'AVOD (With Ads)' : 'TVOD'}
              <span style="opacity:0.8;margin-left:6px;">▾</span>
            </button>

            <button class="wv-icon" data-focus="1" id="wvProfileBtn"
              style="border:1px solid var(--watchBorder);background:rgba(255,255,255,0.06);width:38px;height:38px;border-radius:999px;color:var(--watchText);display:flex;align-items:center;justify-content:center;">
              👤
            </button>
          </div>
        </div>

        <div id="wvTierMenu" style="display:none;margin-top:10px;">
          ${tierMenu()}
        </div>
      </header>
    `;
  }

  function tierMenu() {
    // Keep simple; this does NOT process payments. It just routes to profile/checkout.
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="wv-btn" data-tier="AVOD" style="${btnStyle()}">Watch Free (AVOD)</button>
        <button class="wv-btn" data-tier="SVOD" style="${btnStyle(true)}">Go Ad‑Free (SVOD)</button>
        <button class="wv-btn" data-tier="TVOD" style="${btnStyle()}">Rent/Buy (TVOD)</button>
      </div>
      <div style="margin-top:8px;color:var(--watchMuted);font-size:12px;">
        Tip: SVOD is ad‑free. Ads will only appear on AVOD content.
      </div>
    `;
  }

  function bottomNav() {
    // Minimal; adjust to match your approved layout
    return `
      <nav style="position:fixed;left:0;right:0;bottom:0;z-index:20;background:rgba(10,10,10,0.92);border-top:1px solid var(--watchBorder);padding:10px 16px;">
        <div style="display:flex;justify-content:space-around;gap:12px;">
          <button class="wv-nav" data-route="/home" style="${navBtnStyle()}">Home</button>
          <button class="wv-nav" data-route="/search" style="${navBtnStyle()}">Search</button>
          <button class="wv-nav" data-route="/library" style="${navBtnStyle()}">My List</button>
        </div>
      </nav>
    `;
  }

  function btnStyle(primary=false) {
    return [
      'border:1px solid ' + (primary ? 'var(--watchRed)' : 'var(--watchBorder)'),
      'background:' + (primary ? 'var(--watchRed)' : 'rgba(255,255,255,0.06)'),
      'color:' + (primary ? '#fff' : 'var(--watchText)'),
      'padding:10px 12px',
      'border-radius:12px',
      'font-weight:700',
      'font-size:13px',
      'cursor:pointer'
    ].join(';');
  }

  function navBtnStyle() {
    return [
      'border:1px solid var(--watchBorder)',
      'background:rgba(255,255,255,0.06)',
      'color:var(--watchText)',
      'padding:10px 12px',
      'border-radius:999px',
      'font-weight:700',
      'font-size:13px',
      'cursor:pointer',
      'min-width:84px'
    ].join(';');
  }

  function cardStyle() {
    return 'background:var(--watchCard);border:1px solid var(--watchBorder);border-radius:16px;padding:14px;';
  }

  /* ---------------------------
     7) Pages
  --------------------------- */
  function pageLanding() {
    const { PROMO_PLAYBACK_ID } = state.config;

    // Landing page (no hash)
    const promo = PROMO_PLAYBACK_ID
      ? `
        <div style="${cardStyle()}">
          <div style="font-weight:800;margin-bottom:10px;">Now Streaming on WatchVIM</div>
          <div style="border-radius:14px;overflow:hidden;border:1px solid var(--watchBorder);">
            <mux-player
              playback-id="${PROMO_PLAYBACK_ID}"
              stream-type="on-demand"
              controls
              style="width:100%;aspect-ratio:16/9;background:#000;"
            ></mux-player>
          </div>
        </div>
      `
      : `
        <div style="${cardStyle()}">
          <div style="font-weight:800;">Welcome to WatchVIM</div>
          <div style="color:var(--watchMuted);margin-top:6px;">Set PROMO_PLAYBACK_ID in config.json to show a promo trailer here.</div>
        </div>
      `;

    mount(appShell({
      showNav: false,
      contentHtml: `
        <section style="max-width:980px;margin:0 auto;padding:28px 0;">
          ${promo}

          <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <button id="enterBtn" style="${btnStyle(true)}">Enter WatchVIM</button>
            <a href="/privacy.html" style="color:var(--watchMuted);text-decoration:none;font-size:13px;">Privacy</a>
            <a href="/terms.html" style="color:var(--watchMuted);text-decoration:none;font-size:13px;">Terms</a>
          </div>

          <div style="margin-top:14px;color:var(--watchMuted);font-size:13px;">
            Free viewing is supported by ads. Upgrade to SVOD for ad‑free streaming.
          </div>
        </section>
      `
    }));

    $('#enterBtn')?.addEventListener('click', () => navTo('/home'));
  }

  function pageHome() {
    const featured = normalizeFeatured(state.catalog);
    const rows = normalizeRows(state.catalog);

    const hero = featured.length
      ? heroCarousel(featured)
      : `<div style="${cardStyle()}">No featured titles yet. Add "featured" to your catalog JSON.</div>`;

    const rowHtml = rows.map(renderRow).join('');

    mount(appShell({
      contentHtml: `
        <section style="max-width:1120px;margin:0 auto;">
          ${hero}
          <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;">
            ${tabs()}
          </div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:16px;">
            ${rowHtml || `<div style="${cardStyle()}">No rows found in catalog.</div>`}
          </div>
        </section>
      `
    }));

    bindCommonShellHandlers();
    bindHeroHandlers(featured);
    bindRowHandlers();
    markActiveNav('/home');
    setupTVFocus();
  }

  function pageSearch() {
    mount(appShell({
      contentHtml: `
        <section style="max-width:980px;margin:0 auto;">
          <div style="${cardStyle()}">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <input id="wvSearchInput" placeholder="Search titles..."
                style="flex:1;min-width:220px;padding:12px;border-radius:12px;border:1px solid var(--watchBorder);background:rgba(255,255,255,0.06);color:var(--watchText);"/>
              <button id="wvSearchBtn" style="${btnStyle(true)}">Search</button>
            </div>
          </div>
          <div id="wvSearchResults" style="margin-top:14px;display:flex;flex-direction:column;gap:12px;"></div>
        </section>
      `
    }));

    bindCommonShellHandlers();
    markActiveNav('/search');
    setupTVFocus();

    const input = $('#wvSearchInput');
    const results = $('#wvSearchResults');
    const go = () => {
      const q = (input?.value || '').trim().toLowerCase();
      const all = normalizeTitles(state.catalog);
      const hit = q ? all.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.synopsis || '').toLowerCase().includes(q) ||
        (t.genre || '').toLowerCase().includes(q)
      ) : [];
      results.innerHTML = hit.length ? hit.map(renderSearchHit).join('') : `<div style="${cardStyle()}">No results.</div>`;
      bindRowHandlers(results);
      setupTVFocus();
    };

    $('#wvSearchBtn')?.addEventListener('click', go);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function pageLibrary() {
    const all = normalizeTitles(state.catalog);
    const listIds = new Set(loadLocal('wv_mylist', []));
    const myList = all.filter(t => listIds.has(String(t.id)));

    mount(appShell({
      contentHtml: `
        <section style="max-width:980px;margin:0 auto;">
          <div style="${cardStyle()}">
            <div style="font-weight:900;">My List</div>
            <div style="color:var(--watchMuted);margin-top:6px;">Save titles to watch later.</div>
          </div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:12px;">
            ${myList.length ? myList.map(renderSearchHit).join('') : `<div style="${cardStyle()}">No saved titles yet.</div>`}
          </div>
        </section>
      `
    }));

    bindCommonShellHandlers();
    bindRowHandlers();
    markActiveNav('/library');
    setupTVFocus();
  }

  function pageTitle(id) {
    const title = normalizeTitles(state.catalog).find(t => String(t.id) === String(id));
    if (!title) {
      mount(appShell({ contentHtml: `<div style="${cardStyle()}">Title not found.</div>` }));
      bindCommonShellHandlers();
      setupTVFocus();
      return;
    }

    const paywall = ensureCanPlay(title);

    mount(appShell({
      contentHtml: `
        <section style="max-width:980px;margin:0 auto;">
          <div style="${cardStyle()}">
            <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div>
                <div style="font-weight:900;font-size:20px;">${safeText(title.title)}</div>
                <div style="color:var(--watchMuted);margin-top:6px;">${safeText(title.genre || '')}${title.runtime ? ` • ${fmtTime(title.runtime)}` : ''}</div>
              </div>
              <div style="display:flex;gap:10px;align-items:center;">
                <button id="wvMyListBtn" style="${btnStyle()}">${isInMyList(title.id) ? 'Saved' : 'Save'}</button>
                <button id="wvBackBtn" style="${btnStyle()}">Back</button>
              </div>
            </div>

            <div style="margin-top:12px;color:var(--watchMuted);line-height:1.5;">
              ${safeText(title.synopsis || '')}
            </div>

            <div style="margin-top:14px;">
              ${paywall.ok
                ? `<button id="wvPlayBtn" style="${btnStyle(true)}">Play</button>`
                : paywall.reason === 'PAYWALL'
                  ? `
                    <div style="margin-top:10px;color:var(--watchMuted);">
                      This title requires access. Upgrade or purchase to watch.
                    </div>
                    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
                      <button id="wvUpgradeBtn" style="${btnStyle(true)}">Go Ad‑Free (SVOD)</button>
                      <button id="wvBuyBtn" style="${btnStyle()}">Purchase (TVOD)</button>
                    </div>
                  `
                  : `<div style="margin-top:10px;color:var(--watchMuted);">Playback not available.</div>`
              }
            </div>
          </div>
        </section>
      `
    }));

    bindCommonShellHandlers();
    setupTVFocus();

    $('#wvBackBtn')?.addEventListener('click', () => history.back());
    $('#wvMyListBtn')?.addEventListener('click', () => toggleMyList(title.id));

    $('#wvUpgradeBtn')?.addEventListener('click', () => goToCheckout('svod'));
    $('#wvBuyBtn')?.addEventListener('click', () => goToCheckout('tvod', title.id));

    $('#wvPlayBtn')?.addEventListener('click', async () => {
      navTo(`/play/${encodeURIComponent(title.id)}`);
    });
  }

  function pagePlay(id) {
    const title = normalizeTitles(state.catalog).find(t => String(t.id) === String(id));
    if (!title) {
      mount(appShell({ contentHtml: `<div style="${cardStyle()}">Title not found.</div>` }));
      bindCommonShellHandlers();
      setupTVFocus();
      return;
    }

    const can = ensureCanPlay(title);
    if (!can.ok) {
      // Redirect back to title page for paywall actions
      navTo(`/title/${encodeURIComponent(title.id)}`);
      return;
    }

    const showAds = state.config.AVOD_ADS_ENABLED && isAVOD();
    const adNote = showAds
      ? `<div style="color:var(--watchMuted);font-size:12px;margin-top:8px;">Ads enabled (AVOD).</div>`
      : `<div style="color:var(--watchMuted);font-size:12px;margin-top:8px;">Ad‑free playback.</div>`;

    mount(appShell({
      contentHtml: `
        <section style="max-width:1100px;margin:0 auto;">
          <div style="${cardStyle()}">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <div style="font-weight:900;font-size:18px;">${safeText(title.title)}</div>
                ${adNote}
              </div>
              <div style="display:flex;gap:10px;">
                <button id="wvBackBtn" style="${btnStyle()}">Back</button>
              </div>
            </div>

            <div id="wvPlayerWrap" style="margin-top:12px;border-radius:14px;overflow:hidden;border:1px solid var(--watchBorder);background:#000;">
              <!-- Player mounts here -->
            </div>
          </div>
        </section>
      `
    }));

    bindCommonShellHandlers();
    setupTVFocus();

    $('#wvBackBtn')?.addEventListener('click', () => history.back());

    // Mount player (with AVOD pre-roll ads only)
    const wrap = $('#wvPlayerWrap');
    if (!wrap) return;

    (async () => {
      if (showAds) {
        await playPrerollAd(wrap);
      }
      mountMuxPlayer(wrap, title.playbackId);
    })();
  }

  function pageProfile() {
    const tierLabel = isSVOD() ? 'SVOD (Ad‑Free)' : isAVOD() ? 'AVOD (With Ads)' : 'TVOD';

    mount(appShell({
      contentHtml: `
        <section style="max-width:980px;margin:0 auto;">
          <div style="${cardStyle()}">
            <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div>
                <div style="font-weight:900;font-size:18px;">Profile</div>
                <div style="color:var(--watchMuted);margin-top:6px;">
                  Current access: <span style="color:var(--watchText);font-weight:800;">${tierLabel}</span>
                </div>
              </div>
              <div style="display:flex;gap:10px;align-items:center;">
                <button id="wvLogoutBtn" style="${btnStyle()}">${state.user ? 'Log out' : 'Log in'}</button>
              </div>
            </div>

            <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">
              <button id="wvGoSVOD" style="${btnStyle(true)}">Manage SVOD</button>
              <button id="wvGoTVOD" style="${btnStyle()}">Manage TVOD</button>
              <button id="wvSetAVOD" style="${btnStyle()}">Use AVOD</button>
            </div>

            <div style="margin-top:14px;color:var(--watchMuted);font-size:12px;">
              SVOD is ad‑free. AVOD includes ads. TVOD requires purchase per title unless included in SVOD.
            </div>

            <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;">
              ${avatarPicker()}
            </div>
          </div>
        </section>
      `
    }));

    bindCommonShellHandlers();
    markActiveNav(null);
    setupTVFocus();

    $('#wvGoSVOD')?.addEventListener('click', () => goToCheckout('svod'));
    $('#wvGoTVOD')?.addEventListener('click', () => goToCheckout('tvod'));
    $('#wvSetAVOD')?.addEventListener('click', () => {
      state.membership = state.config.MEMBERSHIP.AVOD;
      saveLocal('wv_membership', state.membership);
      render();
    });

    $('#wvLogoutBtn')?.addEventListener('click', async () => {
      if (!supabase) {
        // If you aren't using Supabase, treat this as a local toggle
        navTo('/home');
        return;
      }
      if (state.user) {
        await supabase.auth.signOut();
      } else {
        navTo('/auth');
      }
    });

    $$('#wvAvatarGrid button').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.getAttribute('data-avatar');
        if (!a) return;
        saveLocal('wv_avatar', a);
        render();
      });
    });
  }

  function pageAuth() {
    // Minimal auth stub. If you want full auth UI, keep it in your approved HTML and call it here.
    if (!supabase) {
      mount(appShell({ contentHtml: `<div style="${cardStyle()}">Auth is not configured. Add Supabase keys in config.json.</div>` }));
      bindCommonShellHandlers();
      setupTVFocus();
      return;
    }

    mount(appShell({
      contentHtml: `
        <section style="max-width:520px;margin:0 auto;">
          <div style="${cardStyle()}">
            <div style="font-weight:900;font-size:18px;">Log In</div>
            <div style="color:var(--watchMuted);margin-top:6px;">Use your email and password.</div>

            <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px;">
              <input id="wvEmail" placeholder="Email" type="email"
                style="padding:12px;border-radius:12px;border:1px solid var(--watchBorder);background:rgba(255,255,255,0.06);color:var(--watchText);" />
              <input id="wvPass" placeholder="Password" type="password"
                style="padding:12px;border-radius:12px;border:1px solid var(--watchBorder);background:rgba(255,255,255,0.06);color:var(--watchText);" />
              <button id="wvLoginBtn" style="${btnStyle(true)}">Log In</button>
              <button id="wvSignupBtn" style="${btnStyle()}">Sign Up</button>
              <div id="wvAuthMsg" style="color:var(--watchMuted);font-size:12px;"></div>
            </div>
          </div>
        </section>
      `
    }));

    bindCommonShellHandlers();
    setupTVFocus();

    const msg = $('#wvAuthMsg');
    const email = () => ($('#wvEmail')?.value || '').trim();
    const pass = () => ($('#wvPass')?.value || '').trim();

    $('#wvLoginBtn')?.addEventListener('click', async () => {
      msg.textContent = 'Signing in...';
      const { error } = await supabase.auth.signInWithPassword({ email: email(), password: pass() });
      msg.textContent = error ? error.message : 'Signed in!';
      if (!error) navTo('/profile');
    });

    $('#wvSignupBtn')?.addEventListener('click', async () => {
      msg.textContent = 'Creating account...';
      const { error } = await supabase.auth.signUp({ email: email(), password: pass() });
      msg.textContent = error ? error.message : 'Check your email to confirm.';
    });
  }

  /* ---------------------------
     8) Catalog Normalization + UI components
  --------------------------- */
  function normalizeTitles(catalog) {
    const titles = catalog?.titles || catalog?.items || [];
    return (Array.isArray(titles) ? titles : []).map((t, idx) => ({
      id: t.id ?? t.slug ?? idx,
      title: t.title ?? t.name ?? 'Untitled',
      synopsis: t.synopsis ?? t.description ?? '',
      genre: t.genre ?? '',
      runtime: t.runtime ?? t.minutes ?? null,
      year: t.year ?? '',
      poster: t.poster ?? t.image ?? '',
      backdrop: t.backdrop ?? t.hero ?? t.poster ?? '',
      playbackId: t.playbackId ?? t.muxPlaybackId ?? t.playback_id ?? '',
      access: t.access ?? 'free', // free | svod | tvod | hybrid
      isSeries: !!t.isSeries,
      seasons: t.seasons ?? [],
      featured: !!t.featured
    }));
  }

  function normalizeFeatured(catalog) {
    const titles = normalizeTitles(catalog);
    const featured = catalog?.featured || titles.filter(t => t.featured);
    const arr = Array.isArray(featured) ? featured : [];
    // If catalog.featured is list of ids, map them
    if (arr.length && typeof arr[0] !== 'object') {
      const set = new Set(arr.map(String));
      return titles.filter(t => set.has(String(t.id)));
    }
    return arr.map((x) => (typeof x === 'object' ? x : null)).filter(Boolean);
  }

  function normalizeRows(catalog) {
    const rows = catalog?.rows || catalog?.categories || [];
    if (Array.isArray(rows) && rows.length) return rows;

    // If not provided, derive a simple row by genre
    const titles = normalizeTitles(catalog);
    const byGenre = new Map();
    for (const t of titles) {
      const g = (t.genre || 'More').split(',')[0].trim() || 'More';
      if (!byGenre.has(g)) byGenre.set(g, []);
      byGenre.get(g).push(t);
    }
    return Array.from(byGenre.entries()).map(([name, items]) => ({ name, items }));
  }

  function tabs() {
    // Placeholder tabs – keep minimal to avoid redesigning your approved layout
    const arr = [
      { key: 'featured', label: 'Featured' },
      { key: 'movies', label: 'Movies' },
      { key: 'series', label: 'Series' },
      { key: 'new', label: 'New' }
    ];
    return arr.map(t => `<button class="wv-tab" data-tab="${t.key}" style="${btnStyle()}">${t.label}</button>`).join('');
  }

  function heroCarousel(items) {
    const slides = items.slice(0, 8).map((t, i) => `
      <div class="wv-hero-slide" data-hero-index="${i}"
        style="min-width:100%;border-radius:18px;overflow:hidden;border:1px solid var(--watchBorder);background:#000;position:relative;">
        ${t.backdrop
          ? `<img src="${t.backdrop}" alt="" style="width:100%;height:340px;object-fit:cover;display:block;opacity:0.90;">`
          : `<div style="height:340px;display:flex;align-items:center;justify-content:center;color:var(--watchMuted);">No hero image</div>`
        }
        <div style="position:absolute;left:0;right:0;bottom:0;padding:16px;background:linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0));">
          <div style="font-weight:900;font-size:20px;">${safeText(t.title)}</div>
          <div style="color:var(--watchMuted);margin-top:6px;max-width:680px;line-height:1.4;">
            ${safeText(t.synopsis).slice(0, 160)}${safeText(t.synopsis).length > 160 ? '…' : ''}
          </div>
          <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
            <button class="wv-hero-play" data-title-id="${encodeURIComponent(t.id)}" style="${btnStyle(true)}">Play</button>
            <button class="wv-hero-more" data-title-id="${encodeURIComponent(t.id)}" style="${btnStyle()}">Details</button>
          </div>
        </div>
      </div>
    `).join('');

    return `
      <div class="wv-hero" style="position:relative;">
        <div class="wv-hero-track" style="display:flex;overflow:hidden;scroll-behavior:smooth;">
          ${slides}
        </div>
        <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <button id="wvHeroPrev" style="${btnStyle()}">◀</button>
          <div style="color:var(--watchMuted);font-size:12px;">Use arrows to browse • Select to play</div>
          <button id="wvHeroNext" style="${btnStyle()}">▶</button>
        </div>
      </div>
    `;
  }

  function renderRow(row) {
    const name = safeText(row.name || row.title || 'More');
    const items = (row.items || row.titles || []).map((x) => (typeof x === 'object' ? x : null)).filter(Boolean);

    // If items are IDs, map them
    const all = normalizeTitles(state.catalog);
    const resolved = items.length && (typeof items[0] !== 'object')
      ? all.filter(t => items.map(String).includes(String(t.id)))
      : items;

    const cards = (resolved.length ? resolved : all.slice(0, 12)).slice(0, 18).map(renderPosterCard).join('');

    return `
      <div class="wv-row" style="${cardStyle()}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-weight:900;">${name}</div>
          <div style="color:var(--watchMuted);font-size:12px;">${resolved.length ? resolved.length : ''}</div>
        </div>
        <div class="wv-row-strip" style="margin-top:12px;display:flex;gap:10px;overflow:auto;padding-bottom:6px;">
          ${cards}
        </div>
      </div>
    `;
  }

  function renderPosterCard(t) {
    const poster = t.poster || t.backdrop || '';
    const id = encodeURIComponent(t.id);
    return `
      <button class="wv-card" data-title-id="${id}"
        style="border:1px solid var(--watchBorder);background:rgba(255,255,255,0.04);border-radius:14px;overflow:hidden;min-width:140px;max-width:140px;cursor:pointer;padding:0;">
        <div style="width:140px;height:200px;background:#000;display:flex;align-items:center;justify-content:center;">
          ${poster ? `<img src="${poster}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">`
                  : `<div style="color:var(--watchMuted);font-size:12px;padding:8px;">No poster</div>`}
        </div>
        <div style="padding:10px;text-align:left;">
          <div style="font-weight:800;font-size:12px;line-height:1.2;">${safeText(t.title)}</div>
          <div style="color:var(--watchMuted);font-size:11px;margin-top:6px;">
            ${safeText(t.genre).split(',')[0] || ' '}
          </div>
        </div>
      </button>
    `;
  }

  function renderSearchHit(t) {
    const poster = t.poster || t.backdrop || '';
    const id = encodeURIComponent(t.id);
    return `
      <div style="${cardStyle()}">
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <button class="wv-card" data-title-id="${id}"
            style="border:1px solid var(--watchBorder);background:rgba(255,255,255,0.04);border-radius:14px;overflow:hidden;width:110px;height:150px;cursor:pointer;padding:0;">
            ${poster ? `<img src="${poster}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">`
                    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--watchMuted);font-size:12px;">No poster</div>`}
          </button>
          <div style="flex:1;">
            <div style="font-weight:900;">${safeText(t.title)}</div>
            <div style="color:var(--watchMuted);margin-top:6px;line-height:1.4;">${safeText(t.synopsis).slice(0, 180)}${safeText(t.synopsis).length > 180 ? '…' : ''}</div>
            <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
              <button class="wv-play" data-title-id="${id}" style="${btnStyle(true)}">Play</button>
              <button class="wv-details" data-title-id="${id}" style="${btnStyle()}">Details</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------------------
     9) Player + Ads
  --------------------------- */
  function mountMuxPlayer(container, playbackId) {
    container.innerHTML = `
      <mux-player
        playback-id="${playbackId}"
        stream-type="on-demand"
        controls
        autoplay
        style="width:100%;aspect-ratio:16/9;background:#000;"
      ></mux-player>
    `;
  }

  async function playPrerollAd(container) {
    // Simple pre-roll placeholder. Replace with your real VAST/IMA solution if desired.
    // IMPORTANT: This runs ONLY when membership is AVOD.
    const vast = state.config.VAST_TAG_URL;

    container.innerHTML = `
      <div style="width:100%;aspect-ratio:16/9;background:#000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;">
        <div style="color:#fff;font-weight:900;">Ad is playing…</div>
        <div id="wvAdCountdown" style="color:rgba(255,255,255,0.75);font-size:13px;">5</div>
        <div style="color:rgba(255,255,255,0.55);font-size:11px;max-width:520px;text-align:center;padding:0 12px;">
          ${vast ? 'VAST tag configured. Swap this placeholder with your ad player integration.' : 'Set VAST_TAG_URL in config.json to integrate ads.'}
        </div>
      </div>
    `;

    const cd = $('#wvAdCountdown', container);
    for (let i = 5; i >= 1; i--) {
      if (cd) cd.textContent = String(i);
      await sleep(700);
    }
  }

  /* ---------------------------
     10) Event Binding
  --------------------------- */
  function bindCommonShellHandlers() {
    // Tier dropdown
    const tierBtn = $('#wvTierBtn');
    const menu = $('#wvTierMenu');
    if (tierBtn && menu) {
      tierBtn.onclick = () => {
        const open = menu.style.display !== 'none';
        menu.style.display = open ? 'none' : 'block';
      };

      // Menu buttons
      $$('#wvTierMenu .wv-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tier = btn.getAttribute('data-tier');
          if (!tier) return;

          if (tier === 'SVOD') {
            // Don’t silently switch to SVOD; route to checkout
            goToCheckout('svod');
            return;
          }
          if (tier === 'TVOD') {
            goToCheckout('tvod');
            return;
          }

          state.membership = state.config.MEMBERSHIP.AVOD;
          saveLocal('wv_membership', state.membership);
          menu.style.display = 'none';
          render();
        });
      });
    }

    // Profile
    $('#wvProfileBtn')?.addEventListener('click', () => navTo('/profile'));

    // Bottom nav
    $$('.wv-nav').forEach(b => {
      b.addEventListener('click', () => {
        const r = b.getAttribute('data-route');
        if (r) navTo(r);
      });
    });
  }

  function bindHeroHandlers(featured) {
    const track = $('.wv-hero-track');
    if (!track) return;

    let idx = 0;
    const go = (d) => {
      idx = Math.max(0, Math.min(featured.length - 1, idx + d));
      track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' });
    };
    $('#wvHeroPrev')?.addEventListener('click', () => go(-1));
    $('#wvHeroNext')?.addEventListener('click', () => go(1));

    $$('.wv-hero-play').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-title-id');
        if (id) navTo(`/play/${id}`);
      });
    });
    $$('.wv-hero-more').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-title-id');
        if (id) navTo(`/title/${id}`);
      });
    });
  }

  function bindRowHandlers(root = document) {
    $$('.wv-card', root).forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-title-id');
        if (id) navTo(`/title/${id}`);
      });
    });

    $$('.wv-play', root).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-title-id');
        if (id) navTo(`/play/${id}`);
      });
    });

    $$('.wv-details', root).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-title-id');
        if (id) navTo(`/title/${id}`);
      });
    });
  }

  function bindRowHandlersForHome() {
    bindRowHandlers(document);
  }

  function markActiveNav(route) {
    $$('.wv-nav').forEach(b => {
      const r = b.getAttribute('data-route');
      b.style.outline = (route && r === route) ? '2px solid var(--watchGold)' : 'none';
    });
  }

  function isInMyList(id) {
    const listIds = new Set(loadLocal('wv_mylist', []));
    return listIds.has(String(id));
  }

  function toggleMyList(id) {
    const list = loadLocal('wv_mylist', []);
    const set = new Set(Array.isArray(list) ? list.map(String) : []);
    const key = String(id);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    saveLocal('wv_mylist', Array.from(set));
    render();
  }

  function avatarPicker() {
    const selected = loadLocal('wv_avatar', 'A');
    const avatars = ['A','B','C','D','E','F'];
    const grid = avatars.map(a => `
      <button data-avatar="${a}" style="${btnStyle(a===selected)}">${a}</button>
    `).join('');
    return `
      <div style="width:100%;">
        <div style="font-weight:900;margin-bottom:8px;">Avatar</div>
        <div id="wvAvatarGrid" style="display:flex;gap:10px;flex-wrap:wrap;">${grid}</div>
      </div>
    `;
  }

  /* ---------------------------
     11) TV Focus Navigation (optional)
  --------------------------- */
  function setupTVFocus() {
    if (!state.isTV) return;

    const focusables = getFocusableElements();
    if (!focusables.length) return;

    // Restore focus if possible
    if (state.lastFocusEl && document.contains(state.lastFocusEl)) {
      state.lastFocusEl.focus();
      return;
    }

    focusables[0].focus();

    // Arrow-key navigation
    window.onkeydown = (e) => {
      const key = e.key;
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(key)) return;

      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;

      if (key === 'Enter') {
        active.click?.();
        return;
      }

      e.preventDefault();

      const list = getFocusableElements();
      const i = list.indexOf(active);
      if (i === -1) return;

      // Simple next/prev — good enough and non-invasive
      const next = (key === 'ArrowRight' || key === 'ArrowDown') ? i + 1 : i - 1;
      const clamped = Math.max(0, Math.min(list.length - 1, next));
      list[clamped].focus();
    };

    // Remember last focus
    focusables.forEach(el => {
      el.addEventListener('focus', () => { state.lastFocusEl = el; });
      el.style.scrollMargin = '100px';
    });
  }

  function getFocusableElements() {
    return $$('.wv-nav, button, a, input, select, textarea')
      .filter(el => !el.disabled && el.offsetParent !== null);
  }

  /* ---------------------------
     12) Router + Render
  --------------------------- */
  function render() {
    state.route = hashRoute();

    // Landing (no hash)
    if (!state.route) {
      pageLanding();
      return;
    }

    // Routes
    const parts = state.route.split('/').filter(Boolean);
    const [head, arg] = parts;

    switch (head) {
      case 'home': pageHome(); break;
      case 'search': pageSearch(); break;
      case 'library': pageLibrary(); break;
      case 'title': pageTitle(decodeURIComponent(arg || '')); break;
      case 'play': pagePlay(decodeURIComponent(arg || '')); break;
      case 'profile': pageProfile(); break;
      case 'auth': pageAuth(); break;
      default:
        mount(appShell({ contentHtml: `<div style="${cardStyle()}">Page not found.</div>` }));
        bindCommonShellHandlers();
        setupTVFocus();
    }

    // Close tier menu on navigation
    const menu = $('#wvTierMenu');
    if (menu) menu.style.display = 'none';
  }

  /* ---------------------------
     13) Boot
  --------------------------- */
  async function boot() {
    await loadConfig();
    await initSupabase();
    await refreshMembershipFromProfile();
    await loadManifestAndCatalog();

    // Ensure mux-player is available; you can also place this script in index.html
    if (!customElements.get('mux-player')) {
      // best effort: load mux-player from CDN
      const s = document.createElement('script');
      s.type = 'module';
      s.src = 'https://cdn.jsdelivr.net/npm/@mux/mux-player';
      document.head.appendChild(s);
    }

    window.addEventListener('hashchange', render);
    window.addEventListener('resize', () => { state.isTV = isProbablyTV(); });

    render();
  }

  boot().catch(err => {
    console.error('[WatchVIM] Boot error:', err);
    mount(`<div style="padding:24px;color:white;background:#000;">Boot error. Check console.</div>`);
  });

})();
