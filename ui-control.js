(() => {
  function whenWebbleReady(fn){
    if (window.webble && window.webble.__ready) { fn(); return; }
    const iv = setInterval(() => {
      if (window.webble && window.webble.__ready) { clearInterval(iv); fn(); }
    }, 50);
    setTimeout(() => clearInterval(iv), 5000);
  }

  const ui = {
    connect:  document.getElementById('wbConnect'),
    connectWrap: document.getElementById('wbConnectWrap'),
    start:    document.getElementById('wbStart'),
    stop:     document.getElementById('wbStop'),
    prog:     document.getElementById('wbProg'),
    progBar:  document.getElementById('wbProgBar'),
    progPct:  document.getElementById('wbProgPct'),
    progRem:  document.getElementById('wbProgRem'),
    statusText: document.getElementById('wbStatusText'),
    buttons: document.getElementById('wbButtonGroup'),
  };

  // Keep UI identical regardless of browser support (overlay handled elsewhere)
  if (ui.buttons) ui.buttons.style.display = 'block';
  if (ui.connectWrap) ui.connectWrap.style.display = 'block';

  let statusHoldUntil = 0; // timestamp ms (kept for smooth connect transition)

  function setStatusTextAnimated(text, colorOrNull){
    const el = ui.statusText;
    if(!el) return;
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const newColor = (colorOrNull === null) ? '' : colorOrNull;
    if (prefersReduced) { el.textContent = text; el.style.color = newColor; return; }
    if (el.textContent === text) { el.style.color = newColor; return; }
    el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.93)';
    setTimeout(() => {
      el.textContent = text;
      el.style.color = newColor;
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'scale(1)';
      });
    }, 120);
  }

  // Ensure initial percent text uses a space (e.g., "0 %") even before any JS updates
  if (ui.progPct) {
    const t = ui.progPct.textContent || '0';
    const n = parseInt(String(t).replace('%', '').trim(), 10);
    ui.progPct.textContent = (isNaN(n) ? 0 : n) + ' %';
  }

  function statusVisual(s){
    const code = (s && s.statusCode) ? String(s.statusCode).toUpperCase() : null;
    const txt  = (s && s.statusText) || null;
    const byFlags = s?.run ? {t:'Running…', c:'rgb(52,199,89)'} : (s && s.connected ? {t:'Connected', c:'rgb(52,199,89)'} : {t:'Not connected', c:''});
    if(!code) return { text: txt || byFlags.t, color: byFlags.c };
    switch(code){
      case 'R': return { text: txt || 'Running…',   color:'rgb(52,199,89)' };
      case 'P': return { text: txt || 'Paused',     color:'rgb(255,149,0)' };
      case 'U': return { text: txt || 'Updating…',  color:'rgb(14,122,254)' };
      case 'D': return { text: txt || 'Done!',      color:'rgb(52,199,89)' };
      case 'A': return { text: txt || 'Auto-Stop!', color:'rgb(254,56,60)' };
      case 'C': return { text: txt || 'Connected',  color:'rgb(52,199,89)' };
      case 'I': return { text: txt || 'Idle',       color:'rgb(52,199,89)' };
      default:  return { text: txt || byFlags.t,    color: byFlags.c };
    }
  }

  function setConnected(on, justConnected){
    if (!ui.start || !ui.stop) return;

    ui.stop.disabled  = !on;
    ui.start.disabled = !on;
    if (ui.connect) ui.connect.textContent = on ? 'Disconnect' : 'Connect Respooler';
    if (!on) { ui.start.textContent = 'Start'; }
    if(on && justConnected){
      statusHoldUntil = Date.now() + 1500;
    }
    // Do not force a generic "Connected" label on connect.
    // The real status (e.g. Idle/Running/Updating) is rendered from the next status payload.
    if (ui.statusText && !on) {
      setStatusTextAnimated('Not connected', '');
    }
    if(!on && ui.progBar){ ui.progBar.style.width = '0%'; }
    if(!on && ui.progPct){ ui.progPct.textContent = '0 %'; }
  }

  function bindOnceReady(){
    // Initial state (safe if webble exists now)
    try { setConnected(window.webble.getState().connected); } catch(_) {}

    if (ui.connect) {
      ui.connect.addEventListener('click', async () => {
        const st = window.webble.getState();
        if (st.connected) {
          window.webble.disconnect();
        } else {
          try { await window.webble.connect(); } catch(e) { alert(e.message||e); }
        }
      });
    }

    if (ui.start) {
      ui.start.addEventListener('click', () => {
        const label = (ui.start.textContent || '').trim();
        if (label === 'Pause') {
          window.webble.pause();
        } else {
          window.webble.start();
        }
      });
    }

    if (ui.stop) ui.stop.addEventListener('click',  () => window.webble.stop());

    window.webble.on('connected',   () => { setConnected(true, true); });
    window.webble.on('disconnected',() => {
      statusHoldUntil = 0;
      setConnected(false);
    });

    window.webble.on('status', (s) => {
      const isConn = window.webble.getState().connected === true;
      const blockedByFil = !!s.useFil && !s.hasFilament;
      const isUpdating = (String(s.statusCode || s.code || '').toUpperCase() === 'U') || !!s.updating;

      if (ui.start) ui.start.disabled = !isConn || blockedByFil || isUpdating;
      if (ui.stop)  ui.stop.disabled  = !isConn || isUpdating;

      const isRunning = (String(s.statusCode || s.code || '').toUpperCase() === 'R') || !!s.run;
      if (ui.start) ui.start.textContent = isRunning ? 'Pause' : 'Start';

      if (ui.progBar) {
        const p = Math.max(0, Math.min(100, Number(s.progress ?? s.PROG ?? 0)));
        ui.progBar.style.width = p + '%';

        const code = String(s.statusCode || s.code || '').toUpperCase();
        if (code === 'I') ui.progBar.style.width = '0%';

        if (code === 'D') {
          ui.progBar.style.background = 'rgb(52,199,89)';
        } else if (code === 'P') {
          ui.progBar.style.background = 'rgb(255,149,0)';
        } else if (code === 'A') {
          ui.progBar.style.background = 'rgb(254,56,60)';
        } else {
          ui.progBar.style.background = '#0c4c98';
        }
      }

      if (ui.progPct) {
        const pct = Math.round(Number(s.progress ?? s.PROG ?? 0));
        ui.progPct.textContent = pct + ' %';
      }

      if (ui.progRem) {
        let rem = s.remaining ?? null;
        if (typeof rem === 'number' && !isNaN(rem)) {
          const m = String(Math.floor(rem / 60)).padStart(2,'0');
          const sec = String(Math.floor(rem % 60)).padStart(2,'0');
          ui.progRem.textContent = `-${m}:${sec}`;
        }
      }

      if (ui.statusText) {
        const vis = statusVisual({ ...s, connected: isConn });
        setStatusTextAnimated(vis.text, '');
      }
    });

    (function initProgress(){
      if(!ui.progBar || !window.webble?.getState) return;
      const st = window.webble.getState();
      const p = Math.max(0, Math.min(100, Number(st.progress ?? 0)));
      ui.progBar.style.width = p + '%';

      if(ui.progPct){
        const pct = Math.round(Number(st.progress ?? 0));
        ui.progPct.textContent = pct + ' %';
      }

      const isRunningInit = (String(st.statusCode || '').toUpperCase() === 'R') || !!st.run;
      if (ui.start) ui.start.textContent = isRunningInit ? 'Pause' : 'Start';

      const isUpdatingInit = (String(st.statusCode || '').toUpperCase() === 'U') || !!st.updating;
      if (ui.start) ui.start.disabled = !window.webble.getState?.().connected || isUpdatingInit || (!!st.useFil && !st.hasFilament);
      if (ui.stop)  ui.stop.disabled  = !window.webble.getState?.().connected || isUpdatingInit;

      if(ui.progRem && typeof st.remaining === 'number'){
        const m = String(Math.floor(st.remaining/60)).padStart(2,'0');
        const sec = String(Math.floor(st.remaining%60)).padStart(2,'0');
        ui.progRem.textContent = `-${m}:${sec}`;
      }

      if(ui.statusText){
        const stc = window.webble.getState?.() || {};
        const vis = statusVisual(stc);
        setStatusTextAnimated(vis.text, '');
      }
    })();
  }

  whenWebbleReady(bindOnceReady);
})();