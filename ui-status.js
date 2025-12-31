(() => {
  function whenWebbleReady(fn){
    if (window.webble && window.webble.__ready) { fn(); return; }
    const iv = setInterval(() => {
      if (window.webble && window.webble.__ready) { clearInterval(iv); fn(); }
    }, 50);
    setTimeout(() => clearInterval(iv), 5000);
  }

  // -------------------- Latest firmware check (Info Card) --------------------
  const LATEST_BOARD_FW_URL =
    'https://raw.githubusercontent.com/LukasT03/LTS-Respooler/main/Firmware/latest_board_firmware.txt';

  let latestBoardFw = null;
  let latestBoardFwPromise = null;

  function normalizeVersion(v){
    return String(v || '')
      .trim()
      .replace(/^v/i, '')
      .replace(/[^0-9.]/g, '');
  }

  function parseVersionParts(v){
    const s = normalizeVersion(v);
    if (!s) return null;
    return s.split('.').map(x => {
      const n = parseInt(x, 10);
      return Number.isFinite(n) ? n : 0;
    });
  }

  function compareVersions(a, b){
    const pa = parseVersionParts(a);
    const pb = parseVersionParts(b);
    if (!pa || !pb) return 0;
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const av = pa[i] ?? 0;
      const bv = pb[i] ?? 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function fetchLatestBoardFw(){
    if (latestBoardFwPromise) return latestBoardFwPromise;
    latestBoardFwPromise = fetch(LATEST_BOARD_FW_URL, { cache: 'no-store' })
      .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(t => {
        const v = normalizeVersion(t);
        latestBoardFw = v || null;
        return latestBoardFw;
      })
      .catch(err => {
        console.warn('Latest firmware check failed:', err);
        latestBoardFw = null;
        return null;
      });
    return latestBoardFwPromise;
  }

  // -------------------- Mapping helpers --------------------
  function inferBoardVersion(s){
    const raw = String(s?.name || '').trim();
    const name = raw.toLowerCase();

    if (name === 'esp32 pcb') return 'Driver Board';
    if (name === 'lts db') return 'Driver Board';
    if (name === 'ctrboard v4') return 'Control Board';
    if (name === 'lts cb') return 'Control Board';
    if (name === 'ctrboard v3') return 'Control Board V3';

    return raw ? `Unknown (${raw})` : 'Unknown';
  }

  function mapRespoolerVersion(s){
    const did = (s && Object.prototype.hasOwnProperty.call(s, 'didReceiveBoardVariant')) ? !!s.didReceiveBoardVariant : false;
    const raw = String(s?.boardVariant || '').trim();
    const v = raw.toUpperCase();

    if (!did || !raw) return 'Respooler V4';
    if (v === 'PRO') return 'Respooler Pro';
    if (v === 'STD') return 'Respooler V4';
    return 'Unknown';
  }

  function coerceBool(v){
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (v === 1) return true;
      if (v === 0) return false;
    }
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      if (t === 'true' || t === '1' || t === 'yes' || t === 'ok') return true;
      if (t === 'false' || t === '0' || t === 'no') return false;
    }
    return null;
  }

  function getWifiOk(st){
    const v1 = coerceBool(st?.wifiConnected);
    if (v1 != null) return v1;

    const v2 = coerceBool(st?.WIFI_OK);
    if (v2 != null) return v2;

    const v3 = coerceBool(st?.wifiConnectionResult);
    if (v3 != null) return v3;

    const v4 = coerceBool(st?.wifiLastResult);
    if (v4 != null) return v4;

    return null;
  }

  // IMPORTANT: avoids stale state across device switches
  // - while we haven't received a fresh status payload in this connection,
  //   we treat Wi-Fi as unknown and render "Not connected" (never '-') once connected.
  let haveFreshStatusThisConnection = false;
  let connEpoch = 0;

  function mapWifiStatus(st){
    // Prefer explicit boolean if present, otherwise rely on our connection lifecycle flag.
    const isConn = (typeof st?.connected === 'boolean')
      ? st.connected
      : (window.webble?.getState?.().connected === true);

    if (!isConn) return 'Not Connected';

    // Connected to Board: never show "—" or "-"
    if (!haveFreshStatusThisConnection) return 'Not Connected';

    const ok = getWifiOk(st);
    if (ok === true) return 'Connected';
    if (ok === false) return 'Not Connected';

    // Missing/unknown wifi fields on connected boards => show Not connected (never "—")
    return 'Not Connected';
  }


  // -------------------- DOM refs (Status UI) --------------------
  const infoBoard = document.getElementById('infoBoard');
  const infoRespooler = document.getElementById('infoRespooler');
  const infoFw = document.getElementById('infoFw');
  const infoWifi = document.getElementById('infoWifi');

  // -------------------- Layout: sync Info Card height to right column (desktop, 2-column layout) --------------------
  // Goal: top + bottom aligned across Safari/Chrome without guessing a fixed px value.
  // Formula (desktop): infoH = settingsH - pillsH - controlH - speedH - 3*gap
  const mqTwoColDesktop = window.matchMedia('(min-width: 871px)');
  let infoHeightSyncRAF = 0;
  let infoHeightRO = null;

  // Safari-only: keep the Respooler image frame from collapsing too narrow.
  // We only apply this in the 2-column desktop layout; stacked layout uses its own sizing.
  const ua = navigator.userAgent;
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua);
  let safariFrameSyncRAF = 0;

  function qsFirst(selectors){
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getGapPx(container){
    try {
      const cs = getComputedStyle(container);
      // gap can be like "16px" or "16px 16px"; pick the row gap.
      const g = String(cs.gap || cs.rowGap || '0').trim();
      const first = g.split(/\s+/)[0] || '0';
      const n = parseFloat(first);
      return Number.isFinite(n) ? n : 0;
    } catch(_) { return 0; }
  }

  function pxNum(v){
    const n = parseFloat(String(v || '0'));
    return Number.isFinite(n) ? n : 0;
  }

  function computeAndApplySafariInfoFrameWidth(){
    if (!isSafari) return;

    const infoCard = document.querySelector('.info-card');
    const infoFrame = infoCard?.querySelector('.info-frame');
    if (!infoCard || !infoFrame) return;

    // Only enforce this in the 2-column desktop layout.
    if (!mqTwoColDesktop.matches) {
      // Remove inline sizing when leaving desktop so stacked rules behave normally.
      infoFrame.style.removeProperty('width');
      infoFrame.style.removeProperty('max-width');
      infoFrame.style.removeProperty('justify-self');
      return;
    }

    // Use the already-computed frame height as the source of truth (height is correct).
    const frameH = infoFrame.getBoundingClientRect().height;
    if (!Number.isFinite(frameH) || frameH <= 0) return;

    const cs = getComputedStyle(infoCard);
    const padL = pxNum(cs.paddingLeft);
    const padR = pxNum(cs.paddingRight);
    const colGap = pxNum(cs.columnGap);

    const cardW = infoCard.getBoundingClientRect().width;
    const innerW = Math.max(0, cardW - padL - padR);

    // Keep enough space for the meta column so it doesn’t get squeezed.
    const minMetaW = 170;
    const maxFrameW = Math.max(0, innerW - colGap - minMetaW);

    // Desired: square based on height, but never exceed available width.
    let w = Math.min(frameH, maxFrameW);

    // Guard rail: if there is no room, don't force a width that would break layout.
    if (!Number.isFinite(w) || w <= 0) return;

    w = Math.round(w);

    // Pin to the left edge of the card padding (user requirement: ~1rem left padding stays intact).
    infoFrame.style.justifySelf = 'start';
    infoFrame.style.width = `${w}px`;
    infoFrame.style.maxWidth = `${w}px`;
  }

  function scheduleSafariInfoFrameWidthSync(){
    if (!isSafari) return;
    if (safariFrameSyncRAF) return;
    safariFrameSyncRAF = requestAnimationFrame(() => {
      safariFrameSyncRAF = 0;
      computeAndApplySafariInfoFrameWidth();
    });
  }

  function computeAndApplyInfoCardHeight(){
    // Only do this in the 2-column layout. Stacked layout uses explicit @media heights.
    if (!mqTwoColDesktop.matches) return;

    const infoCard = document.querySelector('.info-card');
    if (!infoCard) return;

    // IMPORTANT: there are TWO .card-stack columns; we want the LEFT one that contains the Info Card.
    const stack = infoCard.closest('.card-stack');
    if (!stack) return;

    // Left stack children in your HTML:
    // status-pills, info-card, control-card, speed-card  => 3 gaps
    const pills = stack.querySelector('.status-pills');

    // Measure the actual CARD containers, not the inner <section> elements.
    const settingsSection = document.getElementById('lts-settings');
    const settingsCard = (settingsSection && settingsSection.closest('.card')) || qsFirst(['.settings-card', '.card.settings-card']);

    const controlCard = stack.querySelector('.card.control-card')
      || stack.querySelector('.control-card')
      || (document.getElementById('lts-control')?.closest('.card') || null);

    const speedCard = stack.querySelector('.card.speed-card')
      || stack.querySelector('.speed-card')
      || (document.getElementById('lts-speed')?.closest('.card') || null);

    if (!settingsCard || !controlCard || !speedCard || !pills) return;

    const gap = getGapPx(stack);
    const settingsH = settingsCard.getBoundingClientRect().height;
    const pillsH    = pills.getBoundingClientRect().height;
    const controlH  = controlCard.getBoundingClientRect().height;
    const speedH    = speedCard.getBoundingClientRect().height;

    // There are 3 gaps between 4 children (pills, info, control, speed).
    let infoH = settingsH - pillsH - controlH - speedH - (3 * gap);

    // Guard rails to avoid negative / silly values during initial layout.
    if (!Number.isFinite(infoH)) return;

    // Keep a minimum so the internal grid doesn't collapse; don't artificially cap the max,
    // otherwise the bottom alignment can never be exact.
    infoH = Math.max(160, infoH);

    const px = Math.round(infoH);
    document.documentElement.style.setProperty('--info-card-h-desktop', `${px}px`);
    scheduleSafariInfoFrameWidthSync();
  }

  function scheduleInfoCardHeightSync(){
    if (infoHeightSyncRAF) return;
    infoHeightSyncRAF = requestAnimationFrame(() => {
      infoHeightSyncRAF = 0;
      computeAndApplyInfoCardHeight();
      scheduleSafariInfoFrameWidthSync();
    });
  }

  function initInfoCardHeightSync(){
    if (infoHeightRO) return;
    infoHeightRO = new ResizeObserver(() => scheduleInfoCardHeightSync());

    // Observe cards that influence the formula. If some aren't in the DOM yet, we'll still
    // re-measure on resize/status updates via scheduleInfoCardHeightSync().
    const toObs = [
      '.card-stack',
      '.info-card',
      '.status-pills',
      '#lts-settings', '.settings-card', '.card.settings-card',
      '.card.control-card', '.control-card', '#lts-control',
      '#lts-speed', '.speed-card', '.card.speed-card'
    ];
    for (const sel of toObs) {
      const el = document.querySelector(sel);
      if (el) {
        try { infoHeightRO.observe(el); } catch(_) {}
      }
    }

    window.addEventListener('resize', scheduleInfoCardHeightSync, { passive: true });
    window.addEventListener('resize', scheduleSafariInfoFrameWidthSync, { passive: true });
    try {
      mqTwoColDesktop.addEventListener('change', scheduleInfoCardHeightSync);
    } catch(_) {
      // Safari < 14 fallback
      try { mqTwoColDesktop.addListener(scheduleInfoCardHeightSync); } catch(_) {}
    }
    scheduleSafariInfoFrameWidthSync();
  }

  function applyDisconnectedDefaults(){
    // User-requested defaults when NOT connected (including first load):
    // - Board version: Unknown
    // - Board Firmware: Unknown
    // - Wifi status: Not Connected
    // - Respooler Variant: Respooler V4
    if (infoBoard) infoBoard.textContent = 'Unknown';
    if (infoFw) infoFw.textContent = 'Unknown';
    if (infoWifi) infoWifi.textContent = 'Not Connected';
    if (infoRespooler) infoRespooler.textContent = 'Respooler V4';

    // Hide variant quick-switch button while disconnected
    try {
      const btn = document.getElementById('infoVariantBtn');
      if (btn) {
        btn.style.display = 'none';
        btn.disabled = true;
      }
    } catch(_) {}

    // Reset respooler image to default
    try {
      const card = document.querySelector('.info-card');
      if (card) card.style.setProperty('--respooler-img', 'url("Respooler.png")');
    } catch(_) {}
  }

  const pillConnSub = document.getElementById('pillConnSub');
  const pillFilSub  = document.getElementById('pillFilSub');
  const pillConnIcon = document.getElementById('pillConnIcon');
  const pillFilIcon  = document.getElementById('pillFilIcon');

  // Wi-Fi modal
  const wifiScanBtn  = document.getElementById('wifiScanBtn');
  const wifiSsid     = document.getElementById('wifiSsid');
  const wifiPass     = document.getElementById('wifiPass');
  const wifiSendBtn  = document.getElementById('wifiSendBtn');
  const wifiStatus   = document.getElementById('wifiStatus');
  const wifiModalBackdrop = document.getElementById('wifiModalBackdrop');
  const wifiModalClose = document.getElementById('wifiModalClose');

  // Legacy button (should no longer be used; keep hidden if still present in HTML)
  const wifiModalBtnLegacy = document.getElementById('wifiModalBtn');
  if (wifiModalBtnLegacy) wifiModalBtnLegacy.style.display = 'none';

  // Variant modal (status-driven UX, writes a setting)
  const variantModalBackdrop = document.getElementById('variantModalBackdrop');
  const variantModalClose    = document.getElementById('variantModalClose');
  const variantV4            = document.getElementById('variantV4');
  const variantPro           = document.getElementById('variantPro');
  const infoVariantBtn       = document.getElementById('infoVariantBtn');
  const variantDesc          = document.getElementById('variantDesc');
  const variantSaveBtn       = document.getElementById('variantSaveBtn');

  const VARIANT_DESC_AUTO =
    'Your Board reported an unknown Respooler variant. Please select the correct one and press Save.';
  const VARIANT_DESC_MANUAL =
    'Select the Respooler variant that this Board is connected to.';

  let variantModalWasShownThisConnection = false;
  let variantModalAutoOpen = false;
  let variantModalManualOpen = false;
  let pendingVariant = null;

  // Info FW update button (rendered inline inside #infoFw)
  let infoFwUpdateBtn = null;
  let infoFwLastRenderKey = null;

  // Info Wi-Fi action button (rendered inline inside #infoWifi)
  let infoWifiActionBtn = null;
  let infoWifiLastRenderKey = null;

  // Local OTA UI state
  let otaLocalPendingUntil = 0;
  let otaUserInitiatedThisConnection = false;

  // Dark mode detection for icon variants
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let isDarkMode = darkQuery.matches;
  darkQuery.addEventListener('change', e => {
    isDarkMode = e.matches;
    try { updateStatusPills(window.webble.getState()); } catch(_) {}
  });

  function setWifiStatusText(t){
    if (!wifiStatus) return;
    const s = (t == null) ? '' : String(t);
    wifiStatus.textContent = s.length ? s : '\u00A0';
  }
  // Wi‑Fi modal UI state (separate from info card Wi‑Fi row)
  let wifiModalPhase = 'idle'; // 'idle' | 'scanning' | 'ready' | 'connecting' | 'success' | 'failed' | 'connected'
  let wifiModalPendingSSID = '';
  let wifiModalLastConnectedSSID = '';
  let wifiModalSuccessTimer = 0;
  let wifiModalConnectStartedAt = 0;
  let wifiModalWasScanning = false;

  function isRecentConnectAttempt(){
    return !!wifiModalConnectStartedAt && (Date.now() - wifiModalConnectStartedAt) < 30000;
  }

  function getWifiSSIDFromStatus(s){
    try {
      const a = String(s?.wifiSSID ?? '').trimEnd();
      const b = String(s?.WIFI_SSID ?? '').trimEnd();
      // prefer explicit fields; fall back to WebBLE cached Wi‑Fi object; then picker selection
      const w = window.webble?.getWiFi?.();
      const c = String(w?.ssid ?? '').trimEnd();
      const d = String(wifiSsid?.value ?? '').trimEnd();
      return (a || b || c || d || '').replace(/^\s+/, '');
    } catch(_) {
      return '';
    }
  }

  function clearWifiModalSuccessTimer(){
    if (wifiModalSuccessTimer) {
      try { clearTimeout(wifiModalSuccessTimer); } catch(_) {}
      wifiModalSuccessTimer = 0;
    }
  }

  let wifiModalLastScanning = false;

  function refreshWifiConnectEnabled(){
    try {
      if (!wifiSendBtn) return;
      const isConn = (window.webble?.getState?.().connected === true);
      const scanning = !!wifiModalLastScanning;
      const ssid = String(wifiSsid?.value || '');
      const pass = String(wifiPass?.value || '');
      const hasCreds = (ssid.length > 0) && (pass.length > 0);
      const can = isConn && !scanning && hasCreds && (wifiModalPhase !== 'connecting');
      wifiSendBtn.disabled = !can;
    } catch(_) {}
  }

  let lastWifiSsidRenderKey = null;
  function populateSsids(ssids, selected){
    if (!wifiSsid) return;

    const listRaw = (Array.isArray(ssids) ? ssids : []).map(s => String(s));

    // While the modal is open, preserve whatever the user picked (even if the board doesn't report wifiSSID).
    const modalOpen = !!wifiModalBackdrop && wifiModalBackdrop.classList.contains('show');
    const keep = modalOpen
      ? String(wifiSsid.value || '')
      : ((selected != null) ? String(selected) : String(wifiSsid.value || ''));

    // If the user has already selected something and a subsequent scan no longer contains it,
    // keep it visible/selected while the modal is open.
    const list = (modalOpen && keep && !listRaw.includes(keep))
      ? [keep, ...listRaw]
      : listRaw;

    // Don't rebuild while user is interacting.
    if (document.activeElement === wifiSsid) return;

    const key = list.join('\u0000') + '|' + keep;
    if (key === lastWifiSsidRenderKey) return;
    lastWifiSsidRenderKey = key;

    const count = listRaw.length;
    wifiSsid.innerHTML = '<option value="" ' + (keep ? '' : 'selected') + '>Select (' + count + ')</option>';
    list.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === keep) opt.selected = true;
      wifiSsid.appendChild(opt);
    });
  }

  function updateStatusPills(s){
    try {
      const isConn = !!(s && s.connected);

      if (pillConnSub) pillConnSub.textContent = isConn ? 'Connected' : 'Disconnected';
      if (pillConnIcon) {
        pillConnIcon.src = isConn
          ? 'antenna.png'
          : (isDarkMode ? 'antenna-slash-dark.png' : 'antenna-slash.png');
      }

      // Filament: prefer boolean if present; if not connected, default to Not Detected
      let has = null;
      if (s && typeof s.hasFilament === 'boolean') has = s.hasFilament;
      else if (s && typeof s.HAS_FIL === 'boolean') has = s.HAS_FIL;
      if (!isConn) has = false;

      if (pillFilSub) pillFilSub.textContent = (has === true) ? 'Detected' : 'Not Detected';
      if (pillFilIcon) pillFilIcon.src = (has === true)
        ? 'checkmark.png'
        : (isDarkMode ? 'xmark-dark.png' : 'xmark.png');
    } catch(_) {}
  }

  function setVariantUI(which){
    const v = String(which || '').toUpperCase();
    const isV4 = (v === 'STD' || v === 'V4');
    const isPro = (v === 'PRO');

    if (variantV4) {
      variantV4.classList.toggle('is-selected', isV4);
      variantV4.setAttribute('aria-pressed', isV4 ? 'true' : 'false');
    }
    if (variantPro) {
      variantPro.classList.toggle('is-selected', isPro);
      variantPro.setAttribute('aria-pressed', isPro ? 'true' : 'false');
    }
  }

  function updateVariantSaveState(){
    if (!variantSaveBtn) return;
    variantSaveBtn.disabled = !pendingVariant;
  }

  function openVariantModal(opts = { manual: false }){
    const manual = !!opts.manual;

    if (!manual) {
      pendingVariant = null;
      setVariantUI(null);
    }
    updateVariantSaveState();

    if (!variantModalBackdrop) return;
    variantModalManualOpen = manual;
    variantModalAutoOpen = !variantModalManualOpen;
    if (variantDesc) {
      variantDesc.textContent = variantModalManualOpen ? VARIANT_DESC_MANUAL : VARIANT_DESC_AUTO;
    }
    variantModalBackdrop.classList.add('show');
  }

  function closeVariantModal(){
    if (!variantModalBackdrop) return;
    variantModalBackdrop.classList.remove('show');
    variantModalAutoOpen = false;
    variantModalManualOpen = false;
  }

  function closeWifiModal(){
    if (!wifiModalBackdrop) return;
    wifiModalBackdrop.classList.remove('show');
  }

  function updateInfoMeta(s){
    const st = s || (window.webble?.getState ? window.webble.getState() : {});
    const isConn = (typeof st?.connected === 'boolean')
      ? st.connected
      : (window.webble?.getState?.().connected === true);

    // If not connected, show the requested defaults and don't render per-board details.
    if (!isConn) {
      applyDisconnectedDefaults();
      return;
    }

    // Variant quick switch button visibility
    try {
      const btn = document.getElementById('infoVariantBtn');
      if (btn) {
        const did = (st && Object.prototype.hasOwnProperty.call(st, 'didReceiveBoardVariant')) ? !!st.didReceiveBoardVariant : false;
        const raw = String(st?.boardVariant || '').trim().toUpperCase();
        const show = !!isConn && did && (raw === 'PRO' || raw === 'STD');
        btn.style.display = show ? 'inline-flex' : 'none';
        btn.disabled = !show;
      }
    } catch(_) {}

    if (infoBoard) infoBoard.textContent = inferBoardVersion(st);
    if (infoRespooler) infoRespooler.textContent = mapRespoolerVersion(st);

    // Switch respooler image depending on variant
    try {
      const did = (st && Object.prototype.hasOwnProperty.call(st, 'didReceiveBoardVariant')) ? !!st.didReceiveBoardVariant : false;
      const raw = String(st?.boardVariant || '').trim();
      const v = raw.toUpperCase();
      const isPro = did && raw && (v === 'PRO');
      const img = isPro ? 'url("RespoolerPro.png")' : 'url("Respooler.png")';
      const card = document.querySelector('.info-card');
      if (card) card.style.setProperty('--respooler-img', img);
    } catch(_) {}

    // FW row (with update button states)
    if (infoFw) {
      const curRaw = st?.fw ? String(st.fw).trim() : '';
      const cur = normalizeVersion(curRaw);

      const isUpdatingFromBoard = String(st?.statusCode || '').trim().toUpperCase() === 'U';
      const wifiOk = (typeof st?.wifiConnected === 'boolean') ? st.wifiConnected : null;
      const otaOk = (typeof st?.otaSuccess === 'boolean') ? st.otaSuccess : null;
      const latest = normalizeVersion(latestBoardFw);
      const hasLatest = !!latest;
      const cmp = (cur && hasLatest) ? compareVersions(cur, latest) : 1;
      const updateAvailable = !!cur && hasLatest && (cmp < 0);
      const now = Date.now();
      const isLocalPending = now < otaLocalPendingUntil;
      const isUpdating = isUpdatingFromBoard || isLocalPending;

      const key = [
        cur || '',
        latest || '',
        connEpoch,
        isConn ? '1' : '0',
        updateAvailable ? '1' : '0',
        isUpdating ? '1' : '0',
        (wifiOk === true) ? 'W1' : (wifiOk === false ? 'W0' : 'W-'),
        (otaOk === true) ? 'O1' : (otaOk === false ? 'O0' : 'O-'),
        otaUserInitiatedThisConnection ? 'T1' : 'T0',
      ].join('|');

      function ensureRow(){
        infoFw.textContent = '';

        // Use a <span> so the CSS rule `.info-meta-value > div { justify-content: space-between !important; }`
        // does NOT apply. We want the button directly after the text.
        const row = document.createElement('span');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'flex-start';
        row.style.gap = '10px';
        row.style.width = '100%';
        row.style.minWidth = '0';
        row.style.flexWrap = 'nowrap';
        row.style.position = 'relative';

        const left = document.createElement('span');
        left.style.flex = '0 1 auto';
        left.style.minWidth = '0';
        left.style.whiteSpace = 'nowrap';
        left.style.overflow = 'hidden';
        left.style.textOverflow = 'ellipsis';
        left.style.pointerEvents = 'none';
        return { row, left };
      }

      function ensureBtn(){
        if (!infoFwUpdateBtn) {
          infoFwUpdateBtn = document.createElement('button');
          infoFwUpdateBtn.type = 'button';

          infoFwUpdateBtn.style.pointerEvents = 'auto';
          infoFwUpdateBtn.style.cursor = 'pointer';
          infoFwUpdateBtn.style.position = 'relative';
          infoFwUpdateBtn.style.zIndex = '5';

          try {
            const variantSave = document.getElementById('variantSaveBtn');
            if (variantSave && variantSave.className) {
              infoFwUpdateBtn.className = variantSave.className;
            }
          } catch(_) {}
          infoFwUpdateBtn.classList.add('fw-update-btn');

          infoFwUpdateBtn.addEventListener('click', async (ev) => {
            try {
              ev.preventDefault();
              ev.stopPropagation();

              const stNow = window.webble?.getState ? window.webble.getState() : {};
              const connectedNow = stNow && stNow.connected === true;
              const wifiNow = (typeof stNow?.wifiConnected === 'boolean') ? stNow.wifiConnected : null;
              const fwNowRaw = stNow?.fw ? String(stNow.fw).trim() : '';
              const fwNow = normalizeVersion(fwNowRaw);
              const latestNow = normalizeVersion(latestBoardFw);
              const canKnowLatest = !!latestNow;
              const updateAvailNow = !!fwNow && canKnowLatest && (compareVersions(fwNow, latestNow) < 0);

              if (!connectedNow || !updateAvailNow) return;

              if (wifiNow !== true) {
                otaLocalPendingUntil = 0;
                try { updateInfoMeta(stNow); } catch(_) {}
                return;
              }

              otaUserInitiatedThisConnection = true;
              otaLocalPendingUntil = Date.now() + 15000;
              try { updateInfoMeta(stNow); } catch(_) {}

              if (typeof window.webble?.otaUpdate === 'function') {
                await window.webble.otaUpdate();
              } else if (typeof window.webble?.triggerOTAUpdate === 'function') {
                await window.webble.triggerOTAUpdate();
              } else {
                console.warn('No OTA update function exposed on window.webble');
              }
            } catch (e) {
              console.error(e);
              otaLocalPendingUntil = 0;
            }
          });
        }
        return infoFwUpdateBtn;
      }

      if (key !== infoFwLastRenderKey) {
        infoFwLastRenderKey = key;

        if (!cur) {
          // While connected but firmware has not been reported yet, keep a stable placeholder.
          // Use the same injected row structure as other states (avoids Safari layout quirks with text nodes).
          const { row, left } = ensureRow();
          left.textContent = 'Unknown';
          row.appendChild(left);
          infoFw.appendChild(row);
        } else if (!updateAvailable) {
          const { row, left } = ensureRow();
          left.textContent = `${cur} (up to date)`;
          row.appendChild(left);
          infoFw.appendChild(row);
        } else {
          const { row, left } = ensureRow();
          left.textContent = cur;
          row.appendChild(left);
          const btn = ensureBtn();

          if (isUpdating) {
            btn.textContent = 'Updating...';
            btn.disabled = true;
          } else if (otaOk === false && otaUserInitiatedThisConnection) {
            btn.textContent = 'Update failed!';
            btn.disabled = false;
          } else if (wifiOk !== true) {
            btn.textContent = 'Update available, no Wi‑Fi';
            btn.disabled = true;
          } else {
            btn.textContent = `Update to ${latest}`;
            btn.disabled = false;
          }

          row.appendChild(btn);
          infoFw.appendChild(row);
        }
      }
    }

    // Wi-Fi row (text + action button)
    if (infoWifi) {
      const wifiText = mapWifiStatus(st);
      const wifiOk = haveFreshStatusThisConnection ? getWifiOk(st) : null;
      const btnLabel = (wifiOk === true) ? 'Change' : 'Connect';

      const key = [
        wifiText || '',
        connEpoch,
        isConn ? '1' : '0',
        (wifiOk === true) ? 'W1' : (wifiOk === false ? 'W0' : 'W-'),
        btnLabel,
      ].join('|');

      if (key === infoWifiLastRenderKey) {
        // No re-render needed.
      } else {
        infoWifiLastRenderKey = key;

        infoWifi.textContent = '';

        // Use a <span> so the CSS rule `.info-meta-value > div { justify-content: space-between !important; }`
        // does NOT apply. We want the button directly after the text.
        const row = document.createElement('span');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'flex-start';
        row.style.gap = '10px';
        row.style.width = '100%';
        row.style.minWidth = '0';
        row.style.flexWrap = 'nowrap';
        row.style.position = 'relative';

        const left = document.createElement('span');
        left.style.flex = '0 1 auto';
        left.style.minWidth = '0';
        left.style.whiteSpace = 'nowrap';
        left.style.overflow = 'hidden';
        left.style.textOverflow = 'ellipsis';
        left.style.pointerEvents = 'none';
        left.textContent = wifiText || '—';
        row.appendChild(left);

        if (isConn) {
          if (!infoWifiActionBtn) {
            infoWifiActionBtn = document.createElement('button');
            infoWifiActionBtn.type = 'button';

            // Match Calibrate button styling if possible
            try {
              const calBtn = document.getElementById('servoCalBtn');
              if (calBtn && calBtn.className) infoWifiActionBtn.className = calBtn.className;
            } catch(_) {}

            infoWifiActionBtn.innerHTML = `
              <span id="wifiModalBtnLabel" class="btn-label"></span>
              <span class="btn-chevron" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                  <path d="M6 3.25L10.5 8 6 12.75" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            `;
            const ch = infoWifiActionBtn.querySelector('.btn-chevron');
            if (ch) ch.style.marginRight = '0';

            infoWifiActionBtn.style.pointerEvents = 'auto';
            infoWifiActionBtn.style.cursor = 'pointer';
            infoWifiActionBtn.style.position = 'relative';
            infoWifiActionBtn.style.zIndex = '5';

            infoWifiActionBtn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              try {
                const backdrop = document.getElementById('wifiModalBackdrop');
                if (backdrop) backdrop.classList.add('show');
                // Ensure Connect button state is correct immediately when opening.
                refreshWifiConnectEnabled();
              } catch(_) {}
            });
          }

          const labelEl = infoWifiActionBtn.querySelector('#wifiModalBtnLabel');
          if (labelEl) labelEl.textContent = btnLabel;
          else infoWifiActionBtn.textContent = btnLabel;

          infoWifiActionBtn.disabled = false;
          row.appendChild(infoWifiActionBtn);
        }

        infoWifi.appendChild(row);
      }
    }
  
    // Layout sync (desktop): keep columns aligned even when text/buttons re-render
    try { scheduleInfoCardHeightSync(); } catch(_) {}
  }

  function bindStatusUI(){
    // Modal closers
    if (wifiModalClose) wifiModalClose.addEventListener('click', closeWifiModal);
    if (wifiModalBackdrop) {
      wifiModalBackdrop.addEventListener('click', (e) => {
        if (e.target === wifiModalBackdrop) closeWifiModal();
      });
    }

    if (variantModalClose) variantModalClose.addEventListener('click', closeVariantModal);
    if (variantModalBackdrop) {
      variantModalBackdrop.addEventListener('click', (e) => {
        if (e.target === variantModalBackdrop) closeVariantModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeWifiModal();
        closeVariantModal();
      }
    });

    // Variant choice
    if (variantV4) variantV4.addEventListener('click', () => {
      pendingVariant = 'STD';
      setVariantUI('STD');
      updateVariantSaveState();
    });
    if (variantPro) variantPro.addEventListener('click', () => {
      pendingVariant = 'PRO';
      setVariantUI('PRO');
      updateVariantSaveState();
    });

    if (variantSaveBtn) {
      variantSaveBtn.addEventListener('click', async () => {
        if (!pendingVariant) return;
        try {
          await window.webble.setBoardVariant(pendingVariant);
        } catch (e) {
          console.error(e);
        } finally {
          variantModalWasShownThisConnection = true;
          closeVariantModal();
          pendingVariant = null;
          updateVariantSaveState();
        }
      });
    }

    if (infoVariantBtn) {
      infoVariantBtn.addEventListener('click', () => {
        try {
          const st = window.webble?.getState ? window.webble.getState() : {};
          const did = (st && Object.prototype.hasOwnProperty.call(st, 'didReceiveBoardVariant')) ? !!st.didReceiveBoardVariant : false;
          const raw = String(st?.boardVariant || '').trim().toUpperCase();
          const mapped = (did && (raw === 'PRO' || raw === 'STD')) ? raw : 'STD';
          pendingVariant = mapped;
          setVariantUI(mapped);
          updateVariantSaveState();
        } catch(_) {
          pendingVariant = 'STD';
          setVariantUI('STD');
          updateVariantSaveState();
        }
        openVariantModal({ manual: true });
      });
    }

    // Wi-Fi actions
    if (wifiScanBtn) {
      wifiScanBtn.addEventListener('click', async () => {
        try {
          wifiModalPhase = 'scanning';
          wifiModalLastScanning = true;
          wifiModalConnectStartedAt = 0;
          clearWifiModalSuccessTimer();
          setWifiStatusText('Scanning...');
          refreshWifiConnectEnabled();
          await window.webble.wifiScan();
        } catch(e) {
          // Scan error is NOT a Wi‑Fi connection result from the ESP32.
          wifiModalPhase = 'idle';
          setWifiStatusText('Ready for connection');
          wifiModalLastScanning = false;
          refreshWifiConnectEnabled();
          console.error(e);
        }
      });
    }

    if (wifiSsid) {
      wifiSsid.addEventListener('change', (e) => {
        const ssid = String(e.target.value || '');
        // UX: Do not send anything on selection; only send when the user presses Connect.
        if (!ssid) { refreshWifiConnectEnabled(); return; }
        wifiModalPhase = 'ready';
        wifiModalPendingSSID = ssid;
        clearWifiModalSuccessTimer();
        try { setWifiStatusText('Ready for connection'); } catch(_) {}
        refreshWifiConnectEnabled();
      });
    }

    if (wifiPass) {
      wifiPass.addEventListener('input', () => {
        refreshWifiConnectEnabled();
      });
    }

    if (wifiSendBtn) {
      wifiSendBtn.addEventListener('click', async () => {
        // IMPORTANT: Preserve leading/trailing spaces exactly as reported by the ESP32.
        // Do NOT trim here, otherwise SSIDs with trailing/leading spaces can't be connected to.
        const ssid = String(wifiSsid?.value || '');
        const pass = String(wifiPass?.value || '');
        if (!ssid) { setWifiStatusText('Ready for connection'); refreshWifiConnectEnabled(); return; }
        if (!pass) { setWifiStatusText('Ready for connection'); refreshWifiConnectEnabled(); return; }
        try {
          wifiModalPhase = 'connecting';
          wifiModalConnectStartedAt = Date.now();
          wifiModalPendingSSID = ssid;
          clearWifiModalSuccessTimer();
          setWifiStatusText('Connecting...');
          refreshWifiConnectEnabled();
          await window.webble.sendWiFiSSID(ssid);
          await window.webble.sendWiFiPassword(pass);
          await window.webble.wifiConnect();
        } catch(e) {
          // Local write error is NOT a connection result from the ESP32.
          wifiModalPhase = 'idle';
          setWifiStatusText('Ready for connection');
          refreshWifiConnectEnabled();
          console.error(e);
        }
      });
    }

    // Initial firmware fetch + initial render
    fetchLatestBoardFw().then(() => {
      try {
        if (window.webble?.getState) {
          updateInfoMeta(window.webble.getState());
        }
      } catch(_) {}
    });

    // Initial UI
    try {
      const initial = window.webble.getState();
      const isConn = initial && initial.connected === true;
      updateStatusPills(isConn ? initial : { connected: false });
      if (isConn) updateInfoMeta(initial);
      else applyDisconnectedDefaults();

      // Wi-Fi modal initial
      try {
        const w = window.webble.getWiFi?.();
        populateSsids(w?.ssids || [], w?.ssid || '');
        if (w?.connected === true) {
          wifiModalPhase = 'connected';
          wifiModalLastConnectedSSID = String(w?.ssid || '');
          const ssidText = wifiModalLastConnectedSSID ? `Connected to "${wifiModalLastConnectedSSID}"` : 'Connected successfully!';
          setWifiStatusText(ssidText);
        } else {
          wifiModalPhase = 'idle';
          setWifiStatusText('Ready for connection');
        }
      } catch(_) {}
    } catch(_) {}

    // Height sync init (desktop, 2-column)
    try {
      initInfoCardHeightSync();
      scheduleInfoCardHeightSync();
    } catch(_) {}

    // Connection lifecycle
    window.webble.on('connected', () => {
      connEpoch++;
      haveFreshStatusThisConnection = false;

      // reset caches so Info rows rebuild immediately
      infoFwLastRenderKey = null;
      infoWifiLastRenderKey = null;

      // reset OTA UI for this connection
      otaLocalPendingUntil = 0;
      otaUserInitiatedThisConnection = false;

      // reset variant modal behavior
      variantModalWasShownThisConnection = false;
      closeVariantModal();

      // reset Wi‑Fi modal UI state for this connection
      wifiModalPhase = 'idle';
      wifiModalPendingSSID = '';
      wifiModalLastConnectedSSID = '';
      wifiModalLastScanning = false;
      clearWifiModalSuccessTimer();
      refreshWifiConnectEnabled();

      // Immediately reflect connection without inheriting stale Wi-Fi state
      try {
        const st = window.webble?.getState ? window.webble.getState() : {};
        const stSafe = {
          ...st,
          wifiConnected: null,
          WIFI_OK: null,
          wifiConnectionResult: null,
          wifiLastResult: null,
          wifiSSID: null,
          WIFI_SSID: null,
        };
        updateStatusPills(stSafe);
        updateInfoMeta(stSafe);
      } catch(_) {}
    });

    window.webble.on('disconnected', () => {
      connEpoch++;
      haveFreshStatusThisConnection = false;

      closeWifiModal();
      closeVariantModal();

      wifiModalPhase = 'idle';
      wifiModalPendingSSID = '';
      wifiModalLastConnectedSSID = '';
      wifiModalLastScanning = false;
      clearWifiModalSuccessTimer();
      refreshWifiConnectEnabled();

      otaLocalPendingUntil = 0;
      otaUserInitiatedThisConnection = false;

      infoFwLastRenderKey = null;
      infoWifiLastRenderKey = null;

      // Clear stale Board-specific info (getState() can still contain the previous device).
      try {
        updateStatusPills({ connected: false });

        applyDisconnectedDefaults();

        setWifiStatusText('\u00A0');
      } catch(_) {}
    });

    // Status updates
    window.webble.on('status', (s) => {
      // Mark that we now have a fresh payload for this connection
      haveFreshStatusThisConnection = true;

      // OTA local pending reset when Board reports definitive state
      try {
        const isU = String(s?.statusCode || '').trim().toUpperCase() === 'U';
        if (!isU) otaLocalPendingUntil = 0;
        if (typeof s?.otaSuccess === 'boolean') otaLocalPendingUntil = 0;
      } catch(_) {}

      updateStatusPills(s);
      updateInfoMeta(s);

      // Variant auto-open on UNK
      try {
        const isConn = window.webble.getState().connected === true;
        const did = (s && Object.prototype.hasOwnProperty.call(s, 'didReceiveBoardVariant')) ? !!s.didReceiveBoardVariant : false;
        const raw = String(s?.boardVariant || '').trim().toUpperCase();
        const isUnknown = did && raw === 'UNK';
        const isOpen = !!variantModalBackdrop?.classList?.contains('show');

        if (infoVariantBtn) infoVariantBtn.disabled = !isConn;

        if (isConn && isUnknown && !variantModalWasShownThisConnection && !isOpen && !variantModalManualOpen) {
          openVariantModal({ manual: false });
          variantModalWasShownThisConnection = true;
        }

        if (did && (raw === 'PRO' || raw === 'STD')) {
          if (!(isOpen && variantModalManualOpen)) setVariantUI(raw);
          if (variantModalAutoOpen) closeVariantModal();
        }
      } catch(_) {}

      // Wi-Fi modal live state
      try {
        const isConn = window.webble.getState().connected === true;
        const scanning = !!s.isScanningForSSIDs;
        wifiModalLastScanning = scanning;

        if (wifiScanBtn) wifiScanBtn.disabled = !isConn || scanning;
        if (wifiSsid) wifiSsid.disabled = !isConn || scanning;
        if (wifiPass) wifiPass.disabled = !isConn;
        refreshWifiConnectEnabled();

        if (Array.isArray(s.availableSSIDs)) {
          // While modal is open, preserve user selection; otherwise prefer board-reported wifiSSID.
          const modalOpen = !!wifiModalBackdrop && wifiModalBackdrop.classList.contains('show');
          populateSsids(s.availableSSIDs, modalOpen ? null : (s.wifiSSID || ''));
        }

        // Status text state machine (modal)
        if (scanning) {
          wifiModalWasScanning = true;
          wifiModalPhase = 'scanning';
          clearWifiModalSuccessTimer();
          setWifiStatusText('Scanning...');
        } else {
          // Scan finished: prompt user to pick an SSID (do not treat scan end as failure).
          if (wifiModalWasScanning) {
            wifiModalWasScanning = false;

            // If we're not in the middle of connecting, show the post-scan prompt.
            if (wifiModalPhase !== 'connecting') {
              const picked = String(wifiSsid?.value || '');
              if (picked) {
                wifiModalPhase = 'ready';
                setWifiStatusText('Ready for connection');
              } else {
                wifiModalPhase = 'idle';
                setWifiStatusText('Ready for connection');
              }
              // Continue; connection result handling below should NOT flip this to failed.
            }
          }
          // Determine if the ESP32 reported a definitive connection RESULT.
          // IMPORTANT: `wifiConnected` (WIFI_OK) is just the current state (often false while connecting)
          // and must NOT be interpreted as an immediate failure.
          const hasRes  = (s?.wifiConnectionResult != null);
          const hasLast = (s?.wifiLastResult != null);
          const wifiOkNow = (typeof s?.wifiConnected === 'boolean') ? s.wifiConnected : null;

          const definitive = hasRes || hasLast;
          const ok = hasRes
            ? !!s.wifiConnectionResult
            : (hasLast ? !!s.wifiLastResult : null);

          // While connecting, NEVER overwrite the label unless we got a definitive success/fail.
          if (wifiModalPhase === 'connecting' && !definitive) {
            setWifiStatusText('Connecting...');
          } else if (definitive && ok === true) {
            const ssidNow = getWifiSSIDFromStatus(s);
            const wasConnecting = (wifiModalPhase === 'connecting');
            wifiModalLastConnectedSSID = ssidNow || wifiModalLastConnectedSSID || wifiModalPendingSSID || '';
            wifiModalPhase = 'connected';
            clearWifiModalSuccessTimer();

            if (wasConnecting) {
              // Show success message briefly, then show Connected to "SSID".
              setWifiStatusText('Connected successfully!');
              wifiModalSuccessTimer = setTimeout(() => {
                wifiModalSuccessTimer = 0;
                const ss = wifiModalLastConnectedSSID || '';
                setWifiStatusText(ss ? `Connected to "${ss}"` : 'Connected successfully!');
              }, 1200);
            } else {
              const ss = wifiModalLastConnectedSSID || '';
              setWifiStatusText(ss ? `Connected to "${ss}"` : 'Connected successfully!');
            }
          } else if (definitive && ok === false) {
            // Only show a failure if we actually initiated a connect attempt.
            // Some firmwares may report wifiLastResult=false after scanning which is NOT a connection failure.
            if (wifiModalPhase === 'connecting' || isRecentConnectAttempt()) {
              wifiModalPhase = 'failed';
              clearWifiModalSuccessTimer();
              setWifiStatusText('Connection failed!');
            } else {
              // Post-scan / idle state: prompt user to pick an SSID.
              const picked = String(wifiSsid?.value || '');
              wifiModalPhase = picked ? 'ready' : 'idle';
              setWifiStatusText('Ready for connection');
            }
          } else {
            // Not scanning, not definitive.
            // If we already know we're connected, show connected-to; otherwise show ready.
            const ssidNow = getWifiSSIDFromStatus(s);
            if (ssidNow) wifiModalLastConnectedSSID = ssidNow;

            if (wifiOkNow === true) {
              const ss = wifiModalLastConnectedSSID || getWifiSSIDFromStatus(s) || '';
              if (ss) wifiModalLastConnectedSSID = ss;
              wifiModalPhase = 'connected';
              setWifiStatusText(ss ? `Connected to "${ss}"` : 'Connected successfully!');
            } else if (wifiModalLastConnectedSSID && wifiModalPhase === 'connected') {
              setWifiStatusText(`Connected to "${wifiModalLastConnectedSSID}"`);
            } else {
              if (wifiModalPhase !== 'ready') wifiModalPhase = 'idle';
              setWifiStatusText('Ready for connection');
            }
          }
        }
      } catch(_) {}
    });
  }

  whenWebbleReady(bindStatusUI);
})();