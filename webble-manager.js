/* LTS WebBLE Manager – nur EINMAL laden! */
(() => {
  if (window.webble && window.webble.__ready) return; // Doppelladen verhindern

  const serviceUUID = '9E05D06D-68A7-4E1F-A503-AE26713AC101'.toLowerCase();
  const charUUID    = '7CB2F1B4-7E3F-43D2-8C92-DF58C9A7B1A8'.toLowerCase();

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  const state = {
    device: null, server: null, char: null,
    connected: false,
    name: null, fw: null,
    run: false, progress: null, remaining: null,
    isError: false, errMsg: null,
    statusCode: null, statusText: null,
    tempBuf: [], chipTempAvg: null,
    speed: 80, hs: false, led: 50, fan: 80, fanAlways: false,
    useFil: true, hasFilament: null, dir: false, pow: 100, trq: 0, jin: 0, dur: 930,
    wifiConnected: null,
    wifiSSID: null,
    wifiPassSet: null,
    wifiLastResult: null,
    wifiConnectionResult: null,
    isScanningForSSIDs: false,
    availableSSIDs: null,

    // Board variant (matches iOS app semantics)
    boardVariant: 'UNK',
    didReceiveBoardVariant: false,

    // Servo settings
    servoAngleR: 5,
    servoAngleL: 175,
    servoStepMm: 1.75,
    servoHome: 'R',

    targetWeight: 0,
    doneHoldUntil: null, DONE_HOLD_MS: 20000,
    lastConnectedAt: null,
    quickRetryCount: 0,
  };

  const listeners = {};
  function emit(event, payload){ (listeners[event]||[]).forEach(fn=>{ try{fn(payload);}catch(e){console.error(e);} }); }
  function on(event, fn){ (listeners[event] ||= []).push(fn); return () => off(event, fn); }
  function off(event, fn){ const a=listeners[event]||[]; const i=a.indexOf(fn); if(i>=0)a.splice(i,1); }

  const editing = new Set();
  const holds = Object.create(null);
  function beginEdit(key){ editing.add(String(key)); }
  function endEdit(key){ editing.delete(String(key)); }
  function isEditing(key){ return editing.has(String(key)); }
  function holdKey(key, ms){ holds[String(key)] = Date.now() + (ms||400); }
  function releaseKey(key){ delete holds[String(key)]; }
  function isHeld(key){ const t = holds[String(key)]; return !!t && Date.now() < t; }

  function mapStatusLetter(ch){
    const c = String(ch || '').trim().toUpperCase();
    switch (c) {
      case 'R': return { code:'R', text:'Running…',    run:true,  isError:false, done:false, paused:false, updating:false };
      case 'P': return { code:'P', text:'Paused',      run:false, isError:false, done:false, paused:true,  updating:false };
      case 'U': return { code:'U', text:'Updating…',  run:false, isError:false, done:false, paused:false, updating:true };
      case 'D': return { code:'D', text:'Done!',       run:false, isError:false, done:true,  paused:false, updating:false };
      case 'A': return { code:'A', text:'Auto-Stop!',  run:false, isError:true,  done:false, paused:false, updating:false };
      case 'C': return { code:'C', text:'Connected',   run:false, isError:false, done:false, paused:false, updating:false };
      case 'I': return { code:'I', text:'Idle',        run:false, isError:false, done:false, paused:false, updating:false };
      default:  return { code:null, text:null,         run:state.run, isError:state.isError, done:false, paused:false, updating:false };
    }
  }

  function bool(v){ if(typeof v==='boolean')return v; if(typeof v==='number')return v!==0; if(typeof v==='string')return ['1','true'].includes(v.toLowerCase()); return false; }
  function avgTempPush(t){ state.tempBuf.push(t|0); if(state.tempBuf.length>10) state.tempBuf.shift(); state.chipTempAvg = Math.round(state.tempBuf.reduce((a,b)=>a+b,0)/state.tempBuf.length); }

  async function writePacket(obj){
    if(!state.char) return;
    const json = JSON.stringify(obj);
    await state.char.writeValue(enc.encode(json));
    emit('log', {dir:'out', json});
  }
  const sendCmd = (cmd)=>writePacket({CMD:cmd});
  const sendSet = (k,v)=>writePacket({SET:{[k]:v}});

  async function connect(){
    if(!('bluetooth' in navigator)) throw new Error('WebBluetooth wird nicht unterstützt.');
    if (state.__connecting) return; state.__connecting = true;
    let device;
    try {
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [serviceUUID] }],
          optionalServices: [serviceUUID]
        });
      } catch (e) {
        if (e && (e.name === 'NotFoundError' || e.name === 'AbortError')) {
          emit('log', { dir: 'err', error: 'requestDevice cancelled' });
          return;
        }
        throw e;
      }

      state.device = device;
      device.addEventListener('gattserverdisconnected', onDisconnected);

      const maxAttempts = 3;
      let lastErr = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (!device.gatt.connected) {
            emit('log', { dir:'info', msg:`GATT connect attempt ${attempt}/${maxAttempts}` });
            await device.gatt.connect();
          }
          await new Promise(r => setTimeout(r, 200));

          const server  = device.gatt; state.server = server;
          const service = await server.getPrimaryService(serviceUUID);
          const char    = await service.getCharacteristic(charUUID); state.char = char;

          await char.startNotifications();
          char.addEventListener('characteristicvaluechanged', onNotify);

          state.connected = true;
          state.name = device.name || null;
          emit('connected', {name: state.name});
          emit('state', {...state});
          state.lastConnectedAt = Date.now();
          state.quickRetryCount = 0;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = (e && e.message) ? e.message : String(e);
          emit('log', { dir:'err', error:`connect attempt ${attempt} failed: ${msg}` });

          if (msg && /GATT Server is disconnected|NotConnectedError|NetworkError/i.test(msg)) {
            try { if (device.gatt.connected) device.gatt.disconnect(); } catch(_) {}
            await new Promise(r => setTimeout(r, 350));
            continue;
          }
          throw e;
        }
      }

      if (lastErr) throw lastErr;
    } finally {
      state.__connecting = false;
    }
  }

  async function silentReconnect(maxAttempts = 2){
    const device = state.device;
    if(!device || !device.gatt) return false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (device.gatt.connected) {
          try { device.gatt.disconnect(); } catch(_) {}
          await new Promise(r=>setTimeout(r, 150));
        }
        emit('log', { dir:'info', msg:`silent reconnect ${attempt}/${maxAttempts}` });
        await device.gatt.connect();
        await new Promise(r=>setTimeout(r, 200));
        const server  = device.gatt; state.server = server;
        const service = await server.getPrimaryService(serviceUUID);
        const char    = await service.getCharacteristic(charUUID); state.char = char;
        await char.startNotifications();
        char.addEventListener('characteristicvaluechanged', onNotify);
        state.connected = true;
        state.name = device.name || null;
        state.lastConnectedAt = Date.now();
        emit('connected', {name: state.name});
        emit('state', {...state});
        return true;
      } catch(e){
        const msg = (e && e.message) ? e.message : String(e);
        emit('log', { dir:'err', error:`silent reconnect failed: ${msg}` });
        await new Promise(r=>setTimeout(r, 300));
      }
    }
    return false;
  }

  function onDisconnected(){
    try { if (state.char) state.char.removeEventListener('characteristicvaluechanged', onNotify); } catch(_) {}
    state.server = null; state.char = null; state.connected = false;

    const now = Date.now();
    const elapsed = state.lastConnectedAt ? (now - state.lastConnectedAt) : Infinity;

    if (elapsed < 2000 && state.quickRetryCount < 2) {
      state.quickRetryCount++;
      (async () => {
        const ok = await silentReconnect(2);
        if (!ok) {
          state.progress = 0; state.remaining = null; state.run = false;
          state.doneHoldUntil = null;
          emit('disconnected', {});
          emit('state', {...state});
        }
      })();
      return;
    }

    state.progress = 0; state.remaining = null; state.run = false;
    state.doneHoldUntil = null;
    emit('disconnected', {});
    emit('state', {...state});
  }

  function onNotify(ev){
    const u8 = new Uint8Array(ev.target.value.buffer, ev.target.value.byteOffset, ev.target.value.byteLength);
    const txt = dec.decode(u8).trim();
    emit('log', {dir:'in', raw:txt});
    const chunks = txt.split('\n').filter(Boolean);
    for(const ch of chunks){
      try {
        const obj = JSON.parse(ch);

        // WiFi scan results may come as a top-level SSID_LIST array
        if (Array.isArray(obj.SSID_LIST)) {
          state.isScanningForSSIDs = false;
          state.availableSSIDs = obj.SSID_LIST.slice();
          emit('ssidList', { ssids: state.availableSSIDs.slice() });
          emit('state',  { ...state });
          continue;
        }

        const d = (obj.STAT && typeof obj.STAT==='object') ? obj.STAT : obj;

        if (typeof obj.STAT === 'string') {
          const s = mapStatusLetter(obj.STAT);
          state.statusCode = s.code;
          state.statusText = s.text;
          state.run = !!s.run;
          state.isError = !!s.isError;

          if (s.done) {
            state.run = false; state.progress = 100; state.remaining = 0;
            state.doneHoldUntil = Date.now()+state.DONE_HOLD_MS;
          }
        }

        if (bool(d.DONE) || state.statusCode === 'D') {
          state.run = false; state.progress = 100; state.remaining = 0;
          state.doneHoldUntil = Date.now()+state.DONE_HOLD_MS;
        }
        if (state.doneHoldUntil && Date.now()<state.doneHoldUntil && (bool(d.RUN) || bool(d.ERR) || state.statusCode==='R' || state.statusCode==='A')) {
          state.doneHoldUntil = null;
        }

        if ('RUN' in d && state.statusCode == null) state.run = bool(d.RUN);
        if (!bool(d.ERR)) {
          const hold = state.doneHoldUntil && Date.now()<state.doneHoldUntil;
          if (!hold) {
            if (typeof d.PROG === 'number') state.progress = d.PROG;
            if (typeof d.REM  === 'number') state.remaining = d.REM;
          } else { state.progress = 100; state.remaining = 0; state.run = false; }
        }
        if (state.statusCode == null) state.isError = bool(d.ERR);
        state.errMsg  = d.ERR_MSG || null;

        if (typeof d.TEMP === 'number') avgTempPush(d.TEMP);
        if ('FW' in d) state.fw = d.FW || state.fw;

        // Board variant (VAR) – only valid if key exists; older firmware won't send it
        if (Object.prototype.hasOwnProperty.call(d, 'VAR')) {
          state.didReceiveBoardVariant = true;
          const v = d.VAR;
          let mapped = 'UNK';
          if (typeof v === 'string') {
            const up = v.trim().toUpperCase();
            if (up === 'PRO') mapped = 'PRO';
            else if (up === 'STD') mapped = 'STD';
            else mapped = 'UNK';
          } else if (typeof v === 'number') {
            const i = Math.round(v);
            if (i === 2) mapped = 'PRO';
            else if (i === 1) mapped = 'STD';
            else mapped = 'UNK';
          }
          state.boardVariant = mapped;
        }

        if (typeof d.SPD === 'number' && !isEditing('SPD') && !isHeld('SPD')) state.speed = d.SPD|0;
        if ('HS'  in d && !isEditing('HS') && !isHeld('HS')) state.hs  = bool(d.HS);
        if (typeof d.LED === 'number' && !isEditing('LED') && !isHeld('LED')) state.led = d.LED|0;
        if (typeof d.FAN_SPD === 'number' && !isEditing('FAN_SPD') && !isHeld('FAN_SPD')) state.fan = d.FAN_SPD|0;
        if ('FAN_ALW' in d && !isEditing('FAN_ALW') && !isHeld('FAN_ALW')) state.fanAlways = bool(d.FAN_ALW);
        if ('USE_FIL' in d && !isEditing('USE_FIL') && !isHeld('USE_FIL')) state.useFil = bool(d.USE_FIL);
        if ('HAS_FIL' in d) state.hasFilament = bool(d.HAS_FIL);
        if ('DIR' in d && !isEditing('DIR') && !isHeld('DIR')) state.dir = bool(d.DIR);
        if (typeof d.POW === 'number' && !isEditing('POW') && !isHeld('POW')) state.pow = d.POW|0;

        if ('WIFI_OK' in d && !isEditing('WIFI_OK') && !isHeld('WIFI_OK')) state.wifiConnected = bool(d.WIFI_OK);
        if ('WIFI_SSID' in d) state.wifiSSID = d.WIFI_SSID || null;
        if ('WIFI_RESULT' in d) state.wifiLastResult = (typeof d.WIFI_RESULT === 'boolean') ? d.WIFI_RESULT : bool(d.WIFI_RESULT);
        if ('WIFI_CONN_RESULT' in d) state.wifiConnectionResult = (typeof d.WIFI_CONN_RESULT === 'boolean') ? d.WIFI_CONN_RESULT : bool(d.WIFI_CONN_RESULT);

        if ('TRQ' in d && !isEditing('TRQ')) {
          const n = Number(d.TRQ);
          if (Number.isFinite(n)) {
            state.trq = Math.max(0, Math.trunc(n));
            releaseKey('TRQ'); endEdit('TRQ');
          }
        }
        if ('JIN' in d && !isEditing('JIN')) {
          const n = Number(d.JIN);
          if (Number.isFinite(n)) {
            state.jin = Math.max(0, Math.trunc(n));
            releaseKey('JIN'); endEdit('JIN');
          }
        }
        if ('WGT' in d && !isEditing('WGT')) {
          const n = Number(d.WGT);
          if (Number.isFinite(n)) {
            state.targetWeight = Math.max(0, Math.trunc(n));
            releaseKey('WGT'); endEdit('WGT');
          }
        }

        // ---- Servo settings ----
        if (typeof d.SV_R === 'number' && !isEditing('SV_R') && !isHeld('SV_R')) state.servoAngleR = d.SV_R|0;
        if (typeof d.SV_L === 'number' && !isEditing('SV_L') && !isHeld('SV_L')) state.servoAngleL = d.SV_L|0;
        if ('SV_STP' in d && !isEditing('SV_STP') && !isHeld('SV_STP')) {
          const n = Number(d.SV_STP);
          if (Number.isFinite(n)) state.servoStepMm = n;
        }
        if (typeof d.SV_HOME === 'string' && !isEditing('SV_HOME') && !isHeld('SV_HOME')) {
          const h = d.SV_HOME.trim().toUpperCase();
          if (h === 'R' || h === 'L') state.servoHome = h;
        }

        if (state.statusCode && !state.statusText) state.statusText = state.statusCode;

        emit('status', {...state});
        emit('state',  {...state});
      } catch(e){ emit('log', {dir:'err', error:String(e)}); }
    }
  }

  window.webble = {
    __ready: true,
    on, off,
    getState: () => ({...state}),
    getBoardVariant: () => ({ variant: state.boardVariant, didReceive: !!state.didReceiveBoardVariant }),
    getWiFi: () => ({
      connected: !!state.wifiConnected,
      ssid: state.wifiSSID,
      scanning: !!state.isScanningForSSIDs,
      ssids: Array.isArray(state.availableSSIDs) ? state.availableSSIDs.slice() : null,
      lastResult: state.wifiLastResult,
      connResult: state.wifiConnectionResult,
    }),
    connect, disconnect: () => { if(state.device?.gatt?.connected) state.device.gatt.disconnect(); },
    beginEdit: (key) => { beginEdit(key); },
    endEdit:   (key) => { endEdit(key); },
    start: () => sendCmd('START'),
    stop:  () => sendCmd('STOP'),
    pause: () => sendCmd('PAUSE'),
    wifiScan: () => { state.isScanningForSSIDs = true; emit('state', { ...state }); return sendCmd('WIFI_SCAN'); },
    wifiConnect: () => sendCmd('WIFI_CONNECT'),
    sendWiFiSSID: (ssid) => { beginEdit('WIFI_SSID'); holdKey('WIFI_SSID', 700); return sendSet('WIFI_SSID', String(ssid ?? '')); },
    sendWiFiPassword: (pass) => { beginEdit('WIFI_PASS'); holdKey('WIFI_PASS', 700); state.wifiPassSet = true; return sendSet('WIFI_PASS', String(pass ?? '')); },
    setSpeed: (v) => { beginEdit('SPD'); holdKey('SPD', 400); return sendSet('SPD', Number(v)); },
    setHighSpeed: (on) => { beginEdit('HS'); holdKey('HS', 400); return sendSet('HS', on ? 1 : 0); },
    setLED: (v) => { beginEdit('LED'); holdKey('LED', 400); return sendSet('LED', Number(v)); },
    setFanSpeed: (v) => { beginEdit('FAN_SPD'); holdKey('FAN_SPD', 400); return sendSet('FAN_SPD', Number(v)); },
    setFanAlways: (on) => { beginEdit('FAN_ALW'); holdKey('FAN_ALW', 400); return sendSet('FAN_ALW', on ? 1 : 0); },
    setUseFil: (on) => { beginEdit('USE_FIL'); holdKey('USE_FIL', 400); return sendSet('USE_FIL', on ? 1 : 0); },
    setDir: (on) => { beginEdit('DIR'); holdKey('DIR', 400); return sendSet('DIR', on ? 1 : 0); },
    setPower: (v) => { beginEdit('POW'); holdKey('POW', 400); return sendSet('POW', Number(v)); },
    setTorque: (v) => {
      beginEdit('TRQ'); holdKey('TRQ', 700);
      const n = Number(v);
      if (!Number.isFinite(n)) { releaseKey('TRQ'); endEdit('TRQ'); return Promise.resolve(); }
      return sendSet('TRQ', Math.max(0, Math.trunc(n)));
    },
    setJingle: (v) => {
      beginEdit('JIN'); holdKey('JIN', 700);
      const n = Number(v);
      if (!Number.isFinite(n)) { releaseKey('JIN'); endEdit('JIN'); return Promise.resolve(); }
      return sendSet('JIN', Math.max(0, Math.trunc(n)));
    },
    setDurationAt80: (v) => { beginEdit('DUR'); holdKey('DUR', 400); return sendSet('DUR', Number(v)); },
    setTargetWeight: (v) => {
      beginEdit('WGT'); holdKey('WGT', 700);
      const n = Number(v);
      if (!Number.isFinite(n)) { releaseKey('WGT'); endEdit('WGT'); return Promise.resolve(); }
      return sendSet('WGT', Math.max(0, Math.trunc(n)));
    },
    setServoAngleR: (angle) => { beginEdit('SV_R'); holdKey('SV_R', 400); const a = Math.max(0, Math.min(180, Number(angle))); return sendSet('SV_R', a); },
    setServoAngleL: (angle) => { beginEdit('SV_L'); holdKey('SV_L', 400); const a = Math.max(0, Math.min(180, Number(angle))); return sendSet('SV_L', a); },
    setServoStepMm: (mm) => { beginEdit('SV_STP'); holdKey('SV_STP', 700); const v = Number(mm); if (!Number.isFinite(v)) return Promise.resolve(); const clamped = Math.max(0.05, Math.min(20.0, v)); return sendSet('SV_STP', clamped); },
    setServoHome: (side) => { beginEdit('SV_HOME'); holdKey('SV_HOME', 700); const s = String(side ?? '').trim().toUpperCase(); if (s !== 'R' && s !== 'L') return Promise.resolve(); return sendSet('SV_HOME', s); },
    servoGoto: (target) => { const t = String(target ?? '').trim().toUpperCase(); if (t !== 'L' && t !== 'R' && t !== 'HOME') return Promise.resolve(); return sendSet('SV_GOTO', t); },
    setBoardVariant: (variant) => {
      beginEdit('VAR'); holdKey('VAR', 700);
      const v = String(variant ?? '').trim().toUpperCase();
      const mapped = (v === 'PRO' || v === 'STD' || v === 'UNK') ? v : 'UNK';
      state.boardVariant = mapped;
      state.didReceiveBoardVariant = true;
      emit('state', { ...state });
      return sendSet('VAR', mapped);
    },
    commitEdit: (key) => { releaseKey(key); endEdit(key); },
  };
})();