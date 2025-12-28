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
    wifiStatus.textContent = (t && String(t).trim().length) ? String(t) : '\u00A0';
  }

  let lastWifiSsidRenderKey = null;
  function populateSsids(ssids, selected){
    if (!wifiSsid) return;

    const list = (Array.isArray(ssids) ? ssids : []).map(s => String(s));
    const cur = (selected != null) ? String(selected) : String(wifiSsid.value || '');
    const keep = cur;

    // Don't rebuild while user is interacting.
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

      // IMPORTANT: never `return` from here — this function also renders Wi‑Fi.
      if (key !== infoFwLastRenderKey) {
        infoFwLastRenderKey = key;

        if (!cur) {
          infoFw.textContent = '—';
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
        if (w?.connected === true) setWifiStatusText('Connected');
        else if (w?.connected === false) setWifiStatusText('Not Connected');
        else setWifiStatusText('\u00A0');
      } catch(_) {}
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

        if (wifiScanBtn) wifiScanBtn.disabled = !isConn || scanning;
        if (wifiSsid) wifiSsid.disabled = !isConn || scanning;
        if (wifiPass) wifiPass.disabled = !isConn;
        if (wifiSendBtn) wifiSendBtn.disabled = !isConn || scanning;

        if (Array.isArray(s.availableSSIDs)) {
          populateSsids(s.availableSSIDs, s.wifiSSID || '');
        }

        if (scanning) {
          setWifiStatusText('Scanning…');
        } else if (s.wifiConnected === true) {
          setWifiStatusText('Connected');
        } else if (s.wifiConnected === false) {
          setWifiStatusText('Not Connected');
        } else if (s.wifiConnectionResult != null) {
          setWifiStatusText(s.wifiConnectionResult ? 'Connected' : 'Connection failed');
        } else if (s.wifiLastResult != null) {
          setWifiStatusText(s.wifiLastResult ? 'OK' : 'Failed');
        } else {
          // No Wi-Fi fields reported (older firmware): if connected, default to Not connected
          setWifiStatusText(isConn ? 'Not Connected' : '\u00A0');
        }
      } catch(_) {}
    });
  }

  whenWebbleReady(bindStatusUI);
})();