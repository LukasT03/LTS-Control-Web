(() => {
  function whenWebbleReady(fn){
    if (window.webble && window.webble.__ready) { fn(); return; }
    const iv = setInterval(() => {
      if (window.webble && window.webble.__ready) { clearInterval(iv); fn(); }
    }, 50);
    setTimeout(() => clearInterval(iv), 5000);
  }

  function bindWithWebble(){
    // -------------------- Settings DOM --------------------
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
    const servoSettingsGroup = document.getElementById('servoSettingsGroup');
    const servoCalBtn = document.getElementById('servoCalBtn');
    const servoStepMinus = document.getElementById('servoStepMinus');
    const servoStepPlus  = document.getElementById('servoStepPlus');
    const servoStepVal   = document.getElementById('servoStepVal');

    // Servo modal
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

    // -------------------- Helpers --------------------
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
      if (!el) return;
      el.addEventListener('pointerdown', () => beginUI(key));
      if (onLocal) el.addEventListener('input', e => onLocal(e.target.value));
      const commit = (v) => { try { setter(v); } finally { endUI(key); } };
      el.addEventListener('pointerup',   e => commit(e.target.value));
      el.addEventListener('change',      e => commit(e.target.value));
      el.addEventListener('pointercancel', () => endUI(key));
      el.addEventListener('keyup', (e)=>{ if(e.key==='Enter' || e.key===' ') commit(e.target.value); });
    }
    function bindCheckbox(el, key, setter){
      if (!el) return;
      el.addEventListener('pointerdown', () => beginUI(key));
      el.addEventListener('change', e => { try { setter(e.target.checked); } finally { endUI(key); } });
      el.addEventListener('pointercancel', () => endUI(key));
      el.addEventListener('keyup', (e)=>{ if(e.key==='Enter' || e.key===' ') { try { setter(el.checked); } finally { endUI(key); } } });
      el.addEventListener('blur', () => { if (uiEditing.has(key)) endUI(key); });
    }
    function bindSelect(el, key, setter){
      if (!el) return;
      el.addEventListener('pointerdown', () => beginUI(key));
      el.addEventListener('focusin',   () => beginUI(key));
      el.addEventListener('change',    e => { try { setter(e.target.value); } finally { endUI(key); } });
      el.addEventListener('blur',      () => { if (uiEditing.has(key)) endUI(key); });
    }

    function clampPow(v){
      v = Number(v);
      if (!Number.isFinite(v)) return 100;
      return Math.max(80, Math.min(120, Math.round(v / 10) * 10));
    }

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

    function fmtMm(v){
      const n = Number(v);
      if (!Number.isFinite(n)) return '– mm';
      return n.toFixed(2) + ' mm';
    }

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

    // -------------------- Bind settings controls --------------------
    bindSlider(led,   'LED',     (v)=>window.webble.setLED(v));
    bindCheckbox(useFil,'USE_FIL',(on)=>window.webble.setUseFil(on));
    bindCheckbox(dir, 'DIR',     (on)=>window.webble.setDir(on));
    bindCheckbox(hs,  'HS',      (on)=>window.webble.setHighSpeed(on));

    bindSelect(autoStop, 'TRQ', (v) => { setPending('TRQ', v); window.webble.setTorque(v); });
    bindSelect(jin,      'JIN', (v) => { setPending('JIN', v); window.webble.setJingle(v); });
    bindSelect(wgt,      'WGT', (v) => { setPending('WGT', v); window.webble.setTargetWeight(v); });

    bindSlider(fan,   'FAN_SPD', (v)=>window.webble.setFanSpeed(v));
    bindCheckbox(fanAlways,'FAN_ALW',(on)=>window.webble.setFanAlways(on));
    bindSlider(speed, 'SPD',     (v)=>window.webble.setSpeed(v), (v)=>{ if (speedVal) speedVal.textContent = v + ' %'; });

    // Servo home position
    if (servoHomeSetting) {
      bindSelect(servoHomeSetting, 'SV_HOME', (v) => {
        setPending('SV_HOME', v);
        window.webble.setServoHome(v);
      });
    }

    // Motor strength +/- buttons
    let motorLocal = 100;
    function updateMotorUI(){
      if (motorVal) motorVal.textContent = String(motorLocal) + ' %';
    }
    function commitMotor(){
      beginUI('POW');
      try { window.webble.setPower(motorLocal); } finally { endUI('POW'); }
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
    function updateDurUI(){
      if (durVal) durVal.textContent = fmtDur(durLocal);
    }
    function commitDur(){
      beginUI('DUR');
      try {
        setPending('DUR', durLocal);
        window.webble.setDurationAt80(durLocal);
      } finally {
        endUI('DUR');
      }
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

    // -------------------- Servo modal (settings UI) --------------------
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
      beginUI('SV_STP');
      try { window.webble.setServoStepMm(servoStepLocal); } finally { endUI('SV_STP'); }
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
        try { window.webble.setServoAngleL(angleL); } finally { endUI('SV_L'); }
      } else {
        beginUI('SV_R');
        try { window.webble.setServoAngleR(angleR); } finally { endUI('SV_R'); }
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

    // -------------------- Apply incoming state to SETTINGS UI --------------------
    function applySettingsFromState(s){
      const st = s || {};

      if (led && !isUIEditing('LED'))      led.value = st.led ?? 50;
      if (useFil && !isUIEditing('USE_FIL'))  useFil.checked = (st.useFil !== false);

      if (!isUIEditing('POW')) {
        motorLocal = clampPow(st.pow ?? 100);
        updateMotorUI();
      }

      if (dir && !isUIEditing('DIR'))      dir.checked = !!st.dir;
      if (hs && !isUIEditing('HS'))       hs.checked = !!st.hs;

      if (autoStop && !isUIEditing('TRQ')) {
        const v = String(st.trq ?? 0);
        if (shouldApply('TRQ', v)) autoStop.value = v;
      }
      if (jin && !isUIEditing('JIN')) {
        const v = String(st.jin ?? 0);
        if (shouldApply('JIN', v)) jin.value = v;
      }
      if (wgt && !isUIEditing('WGT')) {
        const v = String(st.targetWeight ?? st.wgt ?? st.WGT ?? st.targetweight ?? 0);
        if (shouldApply('WGT', v)) wgt.value = v;
      }

      if (fan && !isUIEditing('FAN_SPD'))  fan.value = st.fan ?? 80;
      if (fanAlways && !isUIEditing('FAN_ALW'))  fanAlways.checked = !!st.fanAlways;

      if (speed && !isUIEditing('SPD')) {
        const sp = st.speed ?? 80;
        speed.value = sp;
        if (speedVal) speedVal.textContent = sp + ' %';
      }

      if (!isUIEditing('DUR')) {
        const v = Number(st.dur ?? st.DUR);
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
        const v = Number(st.servoStepMm ?? st.SV_STP);
        if (Number.isFinite(v)) {
          servoStepLocal = v;
          updateServoStepUI();
        }
      }
      if (!isUIEditing('SV_L') && typeof (st.servoAngleL ?? st.SV_L) === 'number') {
        angleL = Math.max(0, Math.min(180, Math.round(Number(st.servoAngleL ?? st.SV_L))));
        if (calSide === 'L') updateAngleText();
      }
      if (!isUIEditing('SV_R') && typeof (st.servoAngleR ?? st.SV_R) === 'number') {
        angleR = Math.max(0, Math.min(180, Math.round(Number(st.servoAngleR ?? st.SV_R))));
        if (calSide === 'R') updateAngleText();
      }
      if (!isUIEditing('SV_HOME') && servoHomeSetting && typeof (st.servoHome ?? st.SV_HOME) === 'string') {
        const h = String(st.servoHome ?? st.SV_HOME).trim().toUpperCase();
        if ((h === 'R' || h === 'L') && shouldApply('SV_HOME', h)) {
          servoHomeSetting.value = h;
        }
      }

      // Enable/disable settings controls that depend on connection + variant
      const isConn = (typeof st.connected === 'boolean')
        ? st.connected
        : (window.webble?.getState?.().connected === true);

      const isPro = isRespoolerProFromState(st || window.webble?.getState?.() || {});
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

      // Disable input controls when not connected
      try {
        const disable = !isConn;
        if (led) led.disabled = disable;
        if (useFil) useFil.disabled = disable;
        if (dir) dir.disabled = disable;
        if (hs) hs.disabled = disable;
        if (autoStop) autoStop.disabled = disable;
        if (jin) jin.disabled = disable;
        if (wgt) wgt.disabled = disable;
        if (fan) fan.disabled = disable;
        if (fanAlways) fanAlways.disabled = disable;
        if (speed) speed.disabled = disable;
      } catch(_) {}
    }

    window.webble.on('status', s => {
      try { applySettingsFromState(s); } catch(_) {}
    });

    // Initial
    try {
      applySettingsFromState(window.webble.getState());
    } catch(_) {}
  }

  whenWebbleReady(bindWithWebble);
})();