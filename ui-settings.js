(() => {
  function whenWebbleReady(fn){
    if (window.webble && window.webble.__ready) { fn(); return; }
    const iv = setInterval(() => {
      if (window.webble && window.webble.__ready) { clearInterval(iv); fn(); }
    }, 50);
    setTimeout(() => clearInterval(iv), 5000);
  }

  // Info card meta (right of image)
  const infoBoard = document.getElementById('infoBoard');
  const infoRespooler = document.getElementById('infoRespooler');
  const infoFw = document.getElementById('infoFw');
  const infoWifi = document.getElementById('infoWifi');

  // Info FW update button (rendered inline inside #infoFw)
  let infoFwUpdateBtn = null;
  // Cache key to avoid rebuilding the FW row on every status update (prevents click from getting cancelled)
  let infoFwLastRenderKey = null;
  // Info Wi‑Fi action button (rendered inline inside #infoWifi)
  let infoWifiActionBtn = null;
  // Cache key to avoid rebuilding the Wi‑Fi row on every status update (prevents click from getting cancelled)
  let infoWifiLastRenderKey = null;
  // Local OTA UI state so we can immediately show "Updating..." after the user clicks.
  let otaLocalPendingUntil = 0;
  // Only show "Update failed!" if the user actually attempted an OTA update in this connection.
  let otaUserInitiatedThisConnection = false;

  // --- Latest firmware check (for Info Card) ---
  const LATEST_BOARD_FW_URL = 'https://raw.githubusercontent.com/LukasT03/LTS-Respooler/main/Firmware/latest_board_firmware.txt';
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

  fetchLatestBoardFw().then(() => {
    try {
      if (window.webble?.getState) updateInfoMeta(window.webble.getState());
    } catch(_) {}
  });

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

  function mapWifiStatus(s){
    const st = s || {};

    // Prefer explicit boolean from firmware, but fall back to other known fields.
    const ok = (typeof st?.wifiConnected === 'boolean') ? st.wifiConnected
      : (typeof st?.WIFI_OK === 'boolean') ? st.WIFI_OK
      : (typeof st?.wifiConnectionResult === 'boolean') ? st.wifiConnectionResult
      : (typeof st?.wifiLastResult === 'boolean') ? st.wifiLastResult
      : null;

    const ssid = (st?.wifiSSID != null && String(st.wifiSSID).trim().length)
      ? String(st.wifiSSID)
      : (st?.WIFI_SSID != null && String(st.WIFI_SSID).trim().length)
        ? String(st.WIFI_SSID)
        : null;

    if (ok === true) return ssid ? ('Connected: ' + ssid) : 'Connected';
    if (ok === false) return 'Not connected';

    // If we're connected to the Board but Wi‑Fi state is unknown (older firmware / not reported),
    // show a sensible default instead of a dash.
    const isConn = (typeof st?.connected === 'boolean') ? st.connected : false;
    if (isConn) return 'Not connected';

    return '—';
  }

  function getWifiOk(st){
    if (typeof st?.wifiConnected === 'boolean') return st.wifiConnected;
    if (typeof st?.WIFI_OK === 'boolean') return st.WIFI_OK;
    // Fall back to last known result fields if present
    if (typeof st?.wifiConnectionResult === 'boolean') return st.wifiConnectionResult;
    if (typeof st?.wifiLastResult === 'boolean') return st.wifiLastResult;
    return null;
  }

  function updateInfoMeta(s){
    const st = s || (window.webble?.getState ? window.webble.getState() : {});
    try {
      const btn = document.getElementById('infoVariantBtn');
      if (btn) {
        const isConn = (typeof st?.connected === 'boolean') ? st.connected : (window.webble?.getState?.().connected === true);
        const did = (st && Object.prototype.hasOwnProperty.call(st, 'didReceiveBoardVariant')) ? !!st.didReceiveBoardVariant : false;
        const raw = String(st?.boardVariant || '').trim().toUpperCase();
        // Only show the manual selector when the Board reported a *known* variant.
        // For UNK we auto-open the modal, and we don't show the manual button.
        const show = !!isConn && did && (raw === 'PRO' || raw === 'STD');
        btn.style.display = show ? 'inline-flex' : 'none';
        btn.disabled = !show;
      }
    } catch(_) {}
    if (infoBoard) infoBoard.textContent = inferBoardVersion(st);
    if (infoRespooler) infoRespooler.textContent = mapRespoolerVersion(st);
    if (infoFw) {
      const curRaw = st?.fw ? String(st.fw).trim() : '';
      const cur = normalizeVersion(curRaw);

      const isConn = (typeof st?.connected === 'boolean') ? st.connected : (window.webble?.getState?.().connected === true);
      const isUpdatingFromBoard = String(st?.statusCode || '').trim().toUpperCase() === 'U';
      const wifiOk = (typeof st?.wifiConnected === 'boolean') ? st.wifiConnected : null;
      const otaOk = (typeof st?.otaSuccess === 'boolean') ? st.otaSuccess : null;

      // If the latest version is unknown (fetch failed / not loaded), we must still render using ONLY
      // the allowed statuses. In that case, treat it as "up to date" (no button).
      const latest = normalizeVersion(latestBoardFw);
      const hasLatest = !!latest;

      // Update available?
      const cmp = (cur && hasLatest) ? compareVersions(cur, latest) : 1;
      const updateAvailable = !!cur && hasLatest && (cmp < 0);

      // Local pending: show "Updating..." immediately after click, even before the Board switches status.
      const now = Date.now();
      const isLocalPending = now < otaLocalPendingUntil;
      const isUpdating = isUpdatingFromBoard || isLocalPending;

      // We only ever rebuild the row when something that affects the 5 allowed states changes.
      const key = [
        cur || '',
        latest || '',
        isConn ? '1' : '0',
        updateAvailable ? '1' : '0',
        isUpdating ? '1' : '0',
        (wifiOk === true) ? 'W1' : (wifiOk === false ? 'W0' : 'W-'),
        (otaOk === true) ? 'O1' : (otaOk === false ? 'O0' : 'O-'),
        otaUserInitiatedThisConnection ? 'T1' : 'T0',
      ].join('|');

      // Helper to build the row container once
      function ensureRow(){
        infoFw.textContent = '';
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '10px';
        row.style.minWidth = '0';
        row.style.flexWrap = 'wrap';
        row.style.position = 'relative';
        const left = document.createElement('span');
        left.style.flex = '1';
        left.style.minWidth = '0';
        left.style.whiteSpace = 'nowrap';
        left.style.pointerEvents = 'none';

        return { row, left };
      }

      // Helper to ensure we have a button with the right base styling
      function ensureBtn(){
        if (!infoFwUpdateBtn) {
          infoFwUpdateBtn = document.createElement('button');
          infoFwUpdateBtn.type = 'button';

          // Make sure the button is always clickable even if surrounding layout overlays exist.
          infoFwUpdateBtn.style.pointerEvents = 'auto';
          infoFwUpdateBtn.style.cursor = 'pointer';
          infoFwUpdateBtn.style.position = 'relative';
          infoFwUpdateBtn.style.zIndex = '5';

          // Match the Variant Save button styling as closely as possible.
          try {
            const variantSaveBtn = document.getElementById('variantSaveBtn');
            if (variantSaveBtn && variantSaveBtn.className) {
              infoFwUpdateBtn.className = variantSaveBtn.className;
            }
          } catch(_) {}
          // Dedicated class hook for global styling in CSS.
          infoFwUpdateBtn.classList.add('fw-update-btn');

          // Bind click handler once.
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

              // If we are not connected or no update is available, ignore.
              if (!connectedNow || !updateAvailNow) return;

              // If Wi-Fi isn't connected, show the allowed state (disabled label) and do not start OTA.
              if (wifiNow !== true) {
                // Force a re-render to show "Update available, no Wi-Fi".
                otaLocalPendingUntil = 0;
                try { updateInfoMeta(stNow); } catch(_) {}
                return;
              }

          // Mark that the user initiated an OTA update in this connection.
          otaUserInitiatedThisConnection = true;

          // Immediately show "Updating..." (allowed state), even if Board status is delayed.
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

      // Fast path: same state => only keep disabled in sync
      if (key === infoFwLastRenderKey) {
        try {
          if (infoFwUpdateBtn) {
            // Keep the disabled attribute correct for the current label/state.
            // (Label itself is only updated on rebuild to guarantee the 5 allowed statuses.)
            infoFwUpdateBtn.disabled = infoFwUpdateBtn.hasAttribute('disabled') ? true : false;
          }
        } catch(_) {}
        return;
      }
      infoFwLastRenderKey = key;

      // If we don't have a current version, render the simplest allowed state.
      if (!cur) {
        infoFw.textContent = '—';
        return;
      }

      // 1) Up to date
      if (!updateAvailable) {
        const { row, left } = ensureRow();
        left.textContent = `${cur} (up to date)`;
        row.appendChild(left);
        infoFw.appendChild(row);
        return;
      }

      // From here: update is available (cur < latest)
      const { row, left } = ensureRow();
      left.textContent = cur;
      row.appendChild(left);

      const btn = ensureBtn();

      // 2) Updating...
      if (isUpdating) {
        btn.textContent = 'Updating...';
        btn.disabled = true;
        btn.dataset.fwState = 'updating';
        row.appendChild(btn);
        infoFw.appendChild(row);
        return;
      }

      // 3) Update failed!
      // Only show this if the user actually initiated an OTA update in this connection.
      if (otaOk === false && otaUserInitiatedThisConnection) {
        btn.textContent = 'Update failed!';
        btn.disabled = false; // allow retry
        btn.dataset.fwState = 'failed';
        row.appendChild(btn);
        infoFw.appendChild(row);
        return;
      }

      // 4) Update available, no Wi-Fi
      if (wifiOk !== true) {
        btn.textContent = 'Update available, no Wi-Fi';
        btn.disabled = true;
        btn.dataset.fwState = 'no-wifi';
        row.appendChild(btn);
        infoFw.appendChild(row);
        return;
      }

      // 5) Update to <latest>
      btn.textContent = `Update to ${latest}`;
      btn.disabled = false;
      btn.dataset.fwState = 'ready';
      row.appendChild(btn);
      infoFw.appendChild(row);
    }
    if (infoWifi) {
      const wifiText = mapWifiStatus(st);
      const isConn = (typeof st?.connected === 'boolean') ? st.connected : (window.webble?.getState?.().connected === true);
      const wifiOk = getWifiOk(st);
      // Button text depends ONLY on the connected state (unknown => treat as not connected)
      const btnLabel = (wifiOk === true) ? 'Change' : 'Connect';

      const key = [
        wifiText || '',
        isConn ? '1' : '0',
        (wifiOk === true) ? 'W1' : (wifiOk === false ? 'W0' : 'W-'),
        btnLabel,
      ].join('|');

      if (key === infoWifiLastRenderKey) return;
      infoWifiLastRenderKey = key;

      // Build a row similar to FW: left text + right action button.
      infoWifi.textContent = '';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.gap = '10px';
      row.style.minWidth = '0';
      row.style.flexWrap = 'wrap';
      row.style.position = 'relative';

      const left = document.createElement('span');
      left.style.flex = '1';
      left.style.minWidth = '0';
      left.style.whiteSpace = 'nowrap';
      left.style.pointerEvents = 'none';
      left.textContent = wifiText || '—';

      row.appendChild(left);

      // Only show the action button when connected to the Board.
      if (isConn) {
        if (!infoWifiActionBtn) {
          infoWifiActionBtn = document.createElement('button');
          infoWifiActionBtn.type = 'button';

          // Match the Calibrate button styling exactly (same className).
          try {
            const calBtn = document.getElementById('servoCalBtn');
            if (calBtn && calBtn.className) {
              infoWifiActionBtn.className = calBtn.className;
            }
          } catch (_) {}

          // Ensure it behaves like a normal clickable button.
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
            } catch (_) {}
          });
        }

        infoWifiActionBtn.textContent = btnLabel;
        infoWifiActionBtn.disabled = false;
        row.appendChild(infoWifiActionBtn);
      }

      infoWifi.appendChild(row);
    }
    // Switch respooler image depending on variant
    // Default to V4 image if VAR was never received (older firmware).
    try {
      const did = (st && Object.prototype.hasOwnProperty.call(st, 'didReceiveBoardVariant')) ? !!st.didReceiveBoardVariant : false;
      const raw = String(st?.boardVariant || '').trim();
      const v = raw.toUpperCase();
      const isPro = did && raw && (v === 'PRO');
      const img = isPro ? 'url("RespoolerPro.png")' : 'url("Respooler.png")';
      const card = document.querySelector('.info-card');
      if (card) card.style.setProperty('--respooler-img', img);
    } catch(_) {}
  }

  function bindWithWebble(){
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
    const variantModalBackdrop = document.getElementById('variantModalBackdrop');
    const variantModalClose    = document.getElementById('variantModalClose');
    const variantV4            = document.getElementById('variantV4');
    const variantPro           = document.getElementById('variantPro');
    const infoVariantBtn       = document.getElementById('infoVariantBtn');

    let variantModalWasShownThisConnection = false;
    let variantModalAutoOpen = false;
    let variantModalManualOpen = false;
    const variantDesc = document.getElementById('variantDesc');
    const VARIANT_DESC_AUTO = 'Your Board reported an unknown Respooler variant. Please select the correct one and press Save.';
    const VARIANT_DESC_MANUAL = 'Select the Respooler variant that this Board is connected to.';
    let pendingVariant = null;
    const variantSaveBtn = document.getElementById('variantSaveBtn');
    const updateVariantSaveState = () => {
      if (!variantSaveBtn) return;
      variantSaveBtn.disabled = !pendingVariant;
    };

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

    function openVariantModal(opts = { manual: false }){
      const manual = !!opts.manual;

      // Auto-open (UNK): default to V4 so the user can just press Save.
      // Manual open (button): keep whatever we preselected from the current Board state.
      if (!manual) {
        pendingVariant = 'STD';
        setVariantUI('STD');
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

    if (variantModalClose) variantModalClose.addEventListener('click', () => closeVariantModal());
    if (variantModalBackdrop) {
      variantModalBackdrop.addEventListener('click', (e) => {
        if (e.target === variantModalBackdrop) closeVariantModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeVariantModal();
    });

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

    function closeWifiModal(){
      if (!wifiModalBackdrop) return;
      wifiModalBackdrop.classList.remove('show');
    }
    if (wifiModalClose) wifiModalClose.addEventListener('click', closeWifiModal);
    if (wifiModalBackdrop) {
      wifiModalBackdrop.addEventListener('click', (e) => {
        if (e.target === wifiModalBackdrop) closeWifiModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeWifiModal();
    });

    // Status pills
    const pillConnSub = document.getElementById('pillConnSub');
    const pillFilSub  = document.getElementById('pillFilSub');
    const pillConnIcon = document.getElementById('pillConnIcon');
    const pillFilIcon  = document.getElementById('pillFilIcon');

    // Dark mode detection for icon variants
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    let isDarkMode = darkQuery.matches;
    darkQuery.addEventListener('change', e => {
      isDarkMode = e.matches;
      try { updateStatusPills(window.webble.getState()); } catch(_) {}
    });

    function setWifiStatusText(t){
      if (!wifiStatus) return;
      wifiStatus.textContent = (t && String(t).trim().length) ? String(t) : '\u00A0';
    }

    let lastWifiSsidRenderKey = null;

    function populateSsids(ssids, selected){
      if (!wifiSsid) return;

      const list = (Array.isArray(ssids) ? ssids : []).map(s => String(s));
      const cur = (selected != null) ? String(selected) : String(wifiSsid.value || '');
      const keep = cur;

      // IMPORTANT: Don't rebuild the <select> while the user is interacting with it.
      // Frequent status updates can otherwise replace the DOM mid-click, making selection impossible.
      if (document.activeElement === wifiSsid) return;

      const key = list.join('\u0000') + '|' + keep;
      if (key === lastWifiSsidRenderKey) return;
      lastWifiSsidRenderKey = key;

      wifiSsid.innerHTML = '<option value="" ' + (keep ? '' : 'selected') + '>Select…</option>';
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

        // Filament: prefer hasFilament boolean if present; if not connected, default to Not Detected
        let has = null;
        if (s && typeof s.hasFilament === 'boolean') has = s.hasFilament;
        else if (s && typeof s.HAS_FIL === 'boolean') has = s.HAS_FIL;
        if (!isConn) has = false;

        if (pillFilSub) {
          if (has === true) pillFilSub.textContent = 'Detected';
          else pillFilSub.textContent = 'Not Detected';
        }
        if (pillFilIcon) {
          if (has === true) pillFilIcon.src = 'checkmark.png';
          else pillFilIcon.src = isDarkMode ? 'xmark-dark.png' : 'xmark.png';
        }
      } catch(_) {}
    }

    if (wifiScanBtn) {
      wifiScanBtn.addEventListener('click', async () => {
        try {
          setWifiStatusText('Scanning…');
          await window.webble.wifiScan();
        } catch(e) {
          setWifiStatusText('Scan failed');
          console.error(e);
        }
      });
    }

    if (wifiSsid) {
      wifiSsid.addEventListener('change', async (e) => {
        const ssid = String(e.target.value || '');
        if (!ssid) return;
        try {
          await window.webble.sendWiFiSSID(ssid);
          setWifiStatusText('SSID sent');
        } catch(err) {
          setWifiStatusText('SSID failed');
          console.error(err);
        }
      });
    }

    if (wifiSendBtn) {
      wifiSendBtn.addEventListener('click', async () => {
        const ssid = String(wifiSsid?.value || '').trim();
        const pass = String(wifiPass?.value || '');
        if (!ssid) { setWifiStatusText('Select a network'); return; }
        try {
          setWifiStatusText('Sending…');
          await window.webble.sendWiFiSSID(ssid);
          await window.webble.sendWiFiPassword(pass);
          await window.webble.wifiConnect();
          setWifiStatusText('Connecting…');
        } catch(e) {
          setWifiStatusText('Send failed');
          console.error(e);
        }
      });
    }

    // Update UI initially
    try {
      const w = window.webble.getWiFi?.();
      populateSsids(w?.ssids || [], w?.ssid || '');
      if (w?.connected && w?.ssid) setWifiStatusText('Connected: ' + w.ssid);
    } catch(_) {}

    const led = document.getElementById('led');
    const useFil = document.getElementById('useFil');
    const motorVal = document.getElementById('motorVal');
    const motorMinus = document.getElementById('motorMinus');
    const motorPlus  = document.getElementById('motorPlus');
    const dir = document.getElementById('dir');
    const hs = document.getElementById('hs');
    const autoStop = document.getElementById('autoStop');
    const jin = document.getElementById('jin');
    const wgt = document.getElementById('wgt');
    const fan = document.getElementById('fan');
    const fanAlways = document.getElementById('fanAlways');
    const speed = document.getElementById('speed');
    const speedVal = document.getElementById('speedVal');

    const durVal = document.getElementById('durVal');
    const durMinus = document.getElementById('durMinus');
    const durPlus  = document.getElementById('durPlus');

    // Servo UI
    const servoCalBtn = document.getElementById('servoCalBtn');
    const servoStepMinus = document.getElementById('servoStepMinus');
    const servoStepPlus  = document.getElementById('servoStepPlus');
    const servoStepVal   = document.getElementById('servoStepVal');

    const servoSettingsGroup = document.getElementById('servoSettingsGroup');

    function isRespoolerProFromState(st){
      try {
        const did = (st && Object.prototype.hasOwnProperty.call(st, 'didReceiveBoardVariant')) ? !!st.didReceiveBoardVariant : false;
        const raw = String(st?.boardVariant || '').trim().toUpperCase();
        return did && raw === 'PRO';
      } catch (_) {
        return false;
      }
    }

    function setServoSettingsEnabled(enabled){
      const on = !!enabled;
      if (servoSettingsGroup) {
        servoSettingsGroup.classList.toggle('is-disabled', !on);
        servoSettingsGroup.setAttribute('aria-disabled', on ? 'false' : 'true');
      }
      // Also set disabled attributes for accessibility (overlay already blocks pointer events)
      if (servoCalBtn) servoCalBtn.disabled = !on;
      if (servoStepMinus) servoStepMinus.disabled = !on;
      if (servoStepPlus) servoStepPlus.disabled = !on;
      if (servoHomeSetting) servoHomeSetting.disabled = !on;
    }

    // Modal
    const servoModalBackdrop = document.getElementById('servoModalBackdrop');
    const servoModalClose    = document.getElementById('servoModalClose');
    const servoSideL         = document.getElementById('servoSideL');
    const servoSideR         = document.getElementById('servoSideR');
    const servoArrowLeft     = document.getElementById('servoArrowLeft');
    const servoArrowRight    = document.getElementById('servoArrowRight');
    const servoAngleText     = document.getElementById('servoAngleText');
    const servoHomeSetting   = document.getElementById('servoHomeSetting');
    const servoSideSegment   = document.getElementById('servoSideSegment');
    const servoSideIndicator = document.getElementById('servoSideIndicator');

    const uiEditing = new Set();
    const beginUI = (key) => { uiEditing.add(key); try { window.webble.beginEdit(key); } catch(_){} };
    const endUI   = (key) => { uiEditing.delete(key); try { window.webble.commitEdit(key); } catch(_){} };
    const isUIEditing = (key) => uiEditing.has(key);

    const pending = new Map();
    function setPending(key, val, ms = 900) {
      pending.set(key, { val: String(val), until: Date.now() + ms });
    }
    function shouldApply(key, incomingVal) {
      const p = pending.get(key);
      if (!p) return true;
      if (Date.now() > p.until) { pending.delete(key); return true; }
      if (String(incomingVal) === p.val) { pending.delete(key); return true; }
      return false;
    }

    function bindSlider(el, key, setter, onLocal){
      el.addEventListener('pointerdown', () => beginUI(key));
      if (onLocal) el.addEventListener('input', e => onLocal(e.target.value));
      const commit = (v) => { setter(v); endUI(key); };
      el.addEventListener('pointerup',   e => commit(e.target.value));
      el.addEventListener('change',      e => commit(e.target.value));
      el.addEventListener('pointercancel', () => endUI(key));
      el.addEventListener('keyup', (e)=>{ if(e.key==='Enter' || e.key===' ') commit(e.target.value); });
    }
    function bindCheckbox(el, key, setter){
      el.addEventListener('pointerdown', () => beginUI(key));
      el.addEventListener('change', e => { setter(e.target.checked); endUI(key); });
      el.addEventListener('pointercancel', () => endUI(key));
      el.addEventListener('keyup', (e)=>{ if(e.key==='Enter' || e.key===' ') { setter(el.checked); endUI(key);} });
      el.addEventListener('blur', () => { if (uiEditing.has(key)) endUI(key); });
    }
    function bindSelect(el, key, setter){
      el.addEventListener('pointerdown', () => beginUI(key));
      el.addEventListener('focusin',   () => beginUI(key));
      el.addEventListener('change',    e => { setter(e.target.value); endUI(key); });
      el.addEventListener('blur',      () => { if (uiEditing.has(key)) endUI(key); });
    }

    bindSlider(led,   'LED',     (v)=>window.webble.setLED(v));
    bindCheckbox(useFil,'USE_FIL',(on)=>window.webble.setUseFil(on));
    bindCheckbox(dir, 'DIR',     (on)=>window.webble.setDir(on));
    bindCheckbox(hs,  'HS',      (on)=>window.webble.setHighSpeed(on));
    bindSelect(autoStop, 'TRQ', (v) => { setPending('TRQ', v); window.webble.setTorque(v); });
    bindSelect(jin,      'JIN', (v) => { setPending('JIN', v); window.webble.setJingle(v); });
    bindSelect(wgt,      'WGT', (v) => { setPending('WGT', v); window.webble.setTargetWeight(v); });

    // Servo home position
    if (servoHomeSetting) {
      bindSelect(servoHomeSetting, 'SV_HOME', (v) => {
        setPending('SV_HOME', v);
        window.webble.setServoHome(v);
      });
    }

    bindSlider(fan,   'FAN_SPD', (v)=>window.webble.setFanSpeed(v));
    bindCheckbox(fanAlways,'FAN_ALW',(on)=>window.webble.setFanAlways(on));
    bindSlider(speed, 'SPD',     (v)=>window.webble.setSpeed(v), (v)=>{ speedVal.textContent = v + ' %'; });

    // Motor strength +/- buttons
    let motorLocal = 100;
    function clampPow(v){
      v = Number(v);
      if (!Number.isFinite(v)) return 100;
      return Math.max(80, Math.min(120, Math.round(v / 10) * 10));
    }
    function updateMotorUI(){
      if (motorVal) motorVal.textContent = String(motorLocal) + ' %';
    }
    function commitMotor(){
      beginUI('POW');
      window.webble.setPower(motorLocal);
      endUI('POW');
    }
    updateMotorUI();

    if (motorMinus) motorMinus.addEventListener('click', () => {
      motorLocal = clampPow(motorLocal - 10);
      updateMotorUI();
      commitMotor();
    });
    if (motorPlus) motorPlus.addEventListener('click', () => {
      motorLocal = clampPow(motorLocal + 10);
      updateMotorUI();
      commitMotor();
    });

    // Reference Time (calibration time at 80) — DUR in seconds
    let durLocal = 895;
    function clampDur(v){
      v = Number(v);
      if (!Number.isFinite(v)) return 895;
      v = Math.round(v);
      return Math.max(10, Math.min(60 * 180, v)); // 10s .. 180m
    }
    function fmtDur(sec){
      const s = clampDur(sec);
      const m = Math.floor(s / 60);
      const r = s % 60;
      return String(m).padStart(2,'0') + 'm ' + String(r).padStart(2,'0') + 's';
    }
    function updateDurUI(){
      if (durVal) durVal.textContent = fmtDur(durLocal);
    }
    function commitDur(){
      beginUI('DUR');
      setPending('DUR', durLocal);
      window.webble.setDurationAt80(durLocal);
      endUI('DUR');
    }
    updateDurUI();

    const durDelta = 5; // seconds per click
    if (durMinus) durMinus.addEventListener('click', () => {
      durLocal = clampDur(durLocal - durDelta);
      updateDurUI();
      commitDur();
    });
    if (durPlus) durPlus.addEventListener('click', () => {
      durLocal = clampDur(durLocal + durDelta);
      updateDurUI();
      commitDur();
    });

    function fmtMm(v){
      const n = Number(v);
      if (!Number.isFinite(n)) return '– mm';
      return n.toFixed(2) + ' mm';
    }

    // Servo modal open/close
    function openServoModal(){
      if (!servoModalBackdrop) return;

      // When opening, align modal picker with current Home Position
      try {
        const hv = (servoHomeSetting && servoHomeSetting.value)
          ? String(servoHomeSetting.value).trim().toUpperCase()
          : null;
        if (hv === 'R' || hv === 'L') {
          setSide(hv);
        }
      } catch(_) {}

      servoModalBackdrop.classList.add('show');
    }

    function closeServoModal(){
      if (!servoModalBackdrop) return;
      servoModalBackdrop.classList.remove('show');

      // When closing, return servo to Home position
      try {
        if (window.webble && typeof window.webble.servoGoto === 'function') {
          window.webble.servoGoto('HOME');
        }
      } catch(_) {}
    }

    if (servoCalBtn) {
      servoCalBtn.addEventListener('click', () => {
        // Only allow opening calibration on Respooler Pro
        if (servoSettingsGroup?.classList?.contains('is-disabled')) return;
        openServoModal();
      });
    }
    if (servoModalClose) servoModalClose.addEventListener('click', closeServoModal);
    if (servoModalBackdrop) {
      servoModalBackdrop.addEventListener('click', (e) => {
        if (e.target === servoModalBackdrop) closeServoModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeServoModal();
    });

    // Step distance +/- buttons
    let servoStepLocal = 1.75;
    function updateServoStepUI(){
      if (servoStepVal) servoStepVal.textContent = fmtMm(servoStepLocal);
    }
    updateServoStepUI();

    const stepDelta = 0.01;
    const stepMin = 0.05;
    const stepMax = 20.0;

    function commitServoStep(){
      try { beginUI('SV_STP'); } catch(_){}
      window.webble.setServoStepMm(servoStepLocal);
      try { endUI('SV_STP'); } catch(_){}
    }

    if (servoStepMinus) servoStepMinus.addEventListener('click', () => {
      servoStepLocal = Math.max(stepMin, +(servoStepLocal - stepDelta).toFixed(2));
      updateServoStepUI();
      commitServoStep();
    });
    if (servoStepPlus) servoStepPlus.addEventListener('click', () => {
      servoStepLocal = Math.min(stepMax, +(servoStepLocal + stepDelta).toFixed(2));
      updateServoStepUI();
      commitServoStep();
    });

    // Servo calibration (segmented + arrows)
    let calSide = 'L'; // 'L' or 'R'
    let angleL = 175;
    let angleR = 5;

    function setSide(side){
      calSide = (side === 'R') ? 'R' : 'L';

      // Side selection should also move the servo to that side
      try {
        if (window.webble && typeof window.webble.servoGoto === 'function') {
          window.webble.servoGoto(calSide);
        }
      } catch(_) {}

      if (servoSideL) {
        const on = calSide === 'L';
        servoSideL.classList.toggle('is-selected', on);
        servoSideL.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (servoSideR) {
        const on = calSide === 'R';
        servoSideR.classList.toggle('is-selected', on);
        servoSideR.setAttribute('aria-selected', on ? 'true' : 'false');
      }

      if (servoSideIndicator) {
        const index = (calSide === 'L') ? 0 : 1;
        servoSideIndicator.style.transform = `translateX(${index * 100}%)`;
      }

      updateAngleText();
    }

    function updateAngleText(){
      const v = (calSide === 'L') ? angleL : angleR;
      if (servoAngleText) servoAngleText.textContent = `Angle: ${Math.round(v)}°`;
    }

    function commitAngle(){
      if (calSide === 'L') {
        beginUI('SV_L');
        window.webble.setServoAngleL(angleL);
        endUI('SV_L');
      } else {
        beginUI('SV_R');
        window.webble.setServoAngleR(angleR);
        endUI('SV_R');
      }
    }

    function nudgeAngle(delta){
      if (calSide === 'L') {
        angleL = Math.max(0, Math.min(180, Math.round(angleL + delta)));
      } else {
        angleR = Math.max(0, Math.min(180, Math.round(angleR + delta)));
      }
      updateAngleText();
      commitAngle();
    }

    if (servoSideL) servoSideL.addEventListener('click', () => setSide('L'));
    if (servoSideR) servoSideR.addEventListener('click', () => setSide('R'));
    if (servoArrowLeft)  servoArrowLeft.addEventListener('click', () => nudgeAngle(+1));
    if (servoArrowRight) servoArrowRight.addEventListener('click', () => nudgeAngle(-1));

    // Initialize
    setSide('L');

    window.webble.on('status', s => {
      updateInfoMeta(s);
      // Clear local OTA pending state once the Board reports a definitive state/result.
      try {
        const isU = String(s?.statusCode || '').trim().toUpperCase() === 'U';
        if (!isU) otaLocalPendingUntil = 0;
        if (typeof s?.otaSuccess === 'boolean') otaLocalPendingUntil = 0;
      } catch(_) {}
      updateStatusPills(s);

      // Auto-show variant picker ONLY when the Board explicitly sent an unknown variant.
      // (Older firmware won't send VAR at all => didReceiveBoardVariant stays false => no popup.)
      try {
        const isConn = window.webble.getState().connected === true;
        const did = (s && Object.prototype.hasOwnProperty.call(s, 'didReceiveBoardVariant')) ? !!s.didReceiveBoardVariant : false;
        const raw = String(s?.boardVariant || '').trim().toUpperCase();
        const isUnknown = did && raw === 'UNK';
        const isOpen = !!variantModalBackdrop?.classList?.contains('show');

        // Enable/disable the quick-switch button with connection state
        if (infoVariantBtn) infoVariantBtn.disabled = !isConn;

        if (isConn && isUnknown && !variantModalWasShownThisConnection && !isOpen && !variantModalManualOpen) {
          // Auto-open: default selection handled in openVariantModal()
          openVariantModal({ manual: false });
          variantModalWasShownThisConnection = true;
        }

        // If we have a known variant, reflect it in the UI.
        // IMPORTANT: Do NOT override the user's selection while the modal is open manually.
        if (did && (raw === 'PRO' || raw === 'STD')) {
          if (!(isOpen && variantModalManualOpen)) {
            setVariantUI(raw);
          }

          // Only auto-close when it was auto-opened due to UNK.
          if (variantModalAutoOpen) {
            closeVariantModal();
          }
        }
      } catch(_) {}

      try {
        const isConn = window.webble.getState().connected === true;
        const scanning = !!s.isScanningForSSIDs;
        if (wifiScanBtn) wifiScanBtn.disabled = !isConn || scanning;
        if (wifiSsid) wifiSsid.disabled = !isConn || scanning;
        if (wifiPass) wifiPass.disabled = !isConn;
        if (wifiSendBtn) wifiSendBtn.disabled = !isConn || scanning;
        // (removed: legacy wifiModalBtn wiring)

        if (Array.isArray(s.availableSSIDs)) {
          populateSsids(s.availableSSIDs, s.wifiSSID || '');
        }

        if (scanning) {
          setWifiStatusText('Scanning…');
        } else if (s.wifiConnected) {
          setWifiStatusText(s.wifiSSID ? ('Connected: ' + s.wifiSSID) : 'Connected');
        } else if (s.wifiConnectionResult != null) {
          setWifiStatusText(s.wifiConnectionResult ? 'Connected' : 'Connection failed');
        } else if (s.wifiLastResult != null) {
          setWifiStatusText(s.wifiLastResult ? 'OK' : 'Failed');
        }
      } catch(_) {}

      if (!isUIEditing('LED'))      led.value = s.led ?? 50;
      if (!isUIEditing('USE_FIL'))  useFil.checked = (s.useFil !== false);
      if (!isUIEditing('POW')) {
        motorLocal = clampPow(s.pow ?? 100);
        updateMotorUI();
      }
      if (!isUIEditing('DIR'))      dir.checked = !!s.dir;
      if (!isUIEditing('HS'))       hs.checked = !!s.hs;
      if (!isUIEditing('TRQ')) { const v = String(s.trq ?? 0); if (shouldApply('TRQ', v)) autoStop.value = v; }
      if (!isUIEditing('JIN')) { const v = String(s.jin ?? 0); if (shouldApply('JIN', v)) jin.value = v; }
      if (!isUIEditing('WGT')) { const v = String(s.targetWeight ?? s.wgt ?? s.WGT ?? s.targetweight ?? 0); if (shouldApply('WGT', v)) wgt.value = v; }
      if (!isUIEditing('FAN_SPD'))  fan.value = s.fan ?? 80;
      if (!isUIEditing('FAN_ALW'))  fanAlways.checked = !!s.fanAlways;
      if (!isUIEditing('SPD'))      { speed.value = s.speed ?? 80; speedVal.textContent = (s.speed ?? 80) + ' %'; }
      if (!isUIEditing('DUR')) {
        const v = Number(s.dur ?? s.DUR);
        if (Number.isFinite(v)) {
          const vv = clampDur(v);
          if (shouldApply('DUR', vv)) {
            durLocal = vv;
            updateDurUI();
          }
        }
      }

      // Servo values
      if (!isUIEditing('SV_STP')) {
        const v = Number(s.servoStepMm ?? s.SV_STP);
        if (Number.isFinite(v)) {
          servoStepLocal = v;
          updateServoStepUI();
        }
      }
      if (!isUIEditing('SV_L') && typeof (s.servoAngleL ?? s.SV_L) === 'number') {
        angleL = Math.max(0, Math.min(180, Math.round(Number(s.servoAngleL ?? s.SV_L))));
        if (calSide === 'L') updateAngleText();
      }
      if (!isUIEditing('SV_R') && typeof (s.servoAngleR ?? s.SV_R) === 'number') {
        angleR = Math.max(0, Math.min(180, Math.round(Number(s.servoAngleR ?? s.SV_R))));
        if (calSide === 'R') updateAngleText();
      }
      if (!isUIEditing('SV_HOME') && servoHomeSetting && typeof (s.servoHome ?? s.SV_HOME) === 'string') {
        const h = String(s.servoHome ?? s.SV_HOME).trim().toUpperCase();
        if ((h === 'R' || h === 'L') && shouldApply('SV_HOME', h)) {
          servoHomeSetting.value = h;
        }
      }

      // Disable servo controls when not connected
      const isConn = window.webble.getState().connected === true;
      const isPro = isRespoolerProFromState(s || window.webble.getState?.() || {});
      setServoSettingsEnabled(isConn && isPro);
      if (servoSideL) servoSideL.disabled = !isConn;
      if (servoSideR) servoSideR.disabled = !isConn;
      if (servoArrowLeft)  servoArrowLeft.disabled = !isConn;
      if (servoArrowRight) servoArrowRight.disabled = !isConn;
      if (motorMinus) motorMinus.disabled = !isConn;
      if (motorPlus)  motorPlus.disabled = !isConn;
      if (durMinus) durMinus.disabled = !isConn;
      if (durPlus)  durPlus.disabled = !isConn;
      if (servoSideSegment) servoSideSegment.classList.toggle('is-disabled', !isConn);
    });

    window.webble.on('disconnected', () => {
      variantModalWasShownThisConnection = false;
      closeVariantModal();

      // Reset OTA UI state for the next connection.
      otaLocalPendingUntil = 0;
      otaUserInitiatedThisConnection = false;
      infoFwLastRenderKey = null;
      infoWifiLastRenderKey = null;
    });

    try {
      const initial = window.webble.getState();
      updateStatusPills(initial);
      updateInfoMeta(initial);

      try {
        const isConn0 = window.webble.getState().connected === true;
        const isPro0 = isRespoolerProFromState(initial);
        setServoSettingsEnabled(isConn0 && isPro0);
      } catch (_) {}

      if (typeof initial.servoStepMm === 'number') {
        servoStepLocal = initial.servoStepMm;
        updateServoStepUI();
      }
      if (typeof initial.servoAngleL === 'number') angleL = Math.max(0, Math.min(180, Math.round(initial.servoAngleL)));
      if (typeof initial.servoAngleR === 'number') angleR = Math.max(0, Math.min(180, Math.round(initial.servoAngleR)));
      updateAngleText();
      if (servoHomeSetting && typeof initial.servoHome === 'string') {
        const h = String(initial.servoHome).trim().toUpperCase();
        if (h === 'R' || h === 'L') servoHomeSetting.value = h;
      }
      if (typeof initial.pow === 'number') {
        motorLocal = clampPow(initial.pow);
        updateMotorUI();
      }
      if (typeof initial.dur === 'number') {
        durLocal = clampDur(initial.dur);
        updateDurUI();
      }
    } catch(_) {}
  }

  whenWebbleReady(bindWithWebble);
})();