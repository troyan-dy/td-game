// live/audio.js — процедурный звук «Некрополиса» (WebAudio, без файлов). Звучит от событий сима (S.ev) и кликов UI.
// AudioContext создаётся по первому жесту игрока (политика автоплея браузеров).
(function () {
  const A = (window.AUDIO = {});
  let ctx = null, master = null, vol = 0.7, noiseBuf = null, drone = null;
  const last = {};                                              // ограничение частоты одинаковых звуков
  A.setVolume = (v) => { vol = v; if (master) master.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.05); };
  A.unlock = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = vol * 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); let s = 1;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    startDrone();
  };
  const ok = (k, gap) => { if (!ctx) return false; const t = ctx.currentTime; if (last[k] && t - last[k] < gap) return false; last[k] = t; return true; };
  const env = (g, t, a, d, peak) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const tone = (type, f0, f1, dur, peak, delay = 0, dest = master) => { const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur); env(g, t, 0.005, dur, peak); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05); };
  const noise = (dur, peak, f, q = 1, type = 'bandpass', delay = 0) => { const t = ctx.currentTime + delay, s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; b.type = type; b.frequency.value = f; b.Q.value = q; env(g, t, 0.004, dur, peak); s.connect(b); b.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05); };
  const startDrone = () => {                                    // тихий низкий гул кладбища
    const g = ctx.createGain(); g.gain.value = 0.035; g.connect(master);
    [55, 82.4, 110.3].forEach((f, i) => { const o = ctx.createOscillator(), l = ctx.createOscillator(), lg = ctx.createGain();
      o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f; l.frequency.value = 0.07 + i * 0.031; lg.gain.value = f * 0.004; l.connect(lg); lg.connect(o.frequency); o.connect(g); o.start(); l.start(); });
    drone = g;
  };
  A.ui = (k) => { if (!ctx) return;
    if (k === 'click' && ok('click', 0.04)) tone('square', 660, 520, 0.05, 0.05);
    if (k === 'deny' && ok('deny', 0.15)) { tone('square', 180, 140, 0.12, 0.08); tone('square', 150, 120, 0.12, 0.06, 0.08); }
    if (k === 'start') { tone('triangle', 196, 0, 0.6, 0.12); tone('triangle', 294, 0, 0.8, 0.09, 0.12); } };
  A.event = (e) => {
    if (!ctx || ctx.state !== 'running') return;
    switch (e.k) {
      case 'fire':
        if (e.type === 'bones' && ok('f_b', 0.07)) { noise(0.07, 0.10, 1800, 2); tone('triangle', 240, 90, 0.09, 0.07); }
        if (e.type === 'spirits' && ok('f_s', 0.09)) tone('sine', 900, 1500, 0.18, 0.035);
        if (e.type === 'plague' && ok('f_p', 0.12)) { tone('sine', 140, 300, 0.14, 0.08); noise(0.1, 0.03, 600, 3); }
        if (e.type === 'dark' && ok('f_d', 0.09)) { tone('sawtooth', 120, 60, 0.22, 0.05); tone('sine', 520, 260, 0.2, 0.04); }
        break;
      case 'hit': if (ok('hit', 0.05)) noise(0.04, 0.05, e.kind === 'ghost' ? 3000 : 1200, 3); break;
      case 'cloud': if (ok('cloud', 0.12)) { noise(0.35, 0.06, 500, 1, 'lowpass'); tone('sine', 90, 60, 0.3, 0.05); } break;
      case 'die': if (ok('die', 0.05)) { noise(0.12, 0.08, 400, 1, 'lowpass'); tone('sine', 880 + (e.souls % 5) * 60, 1320, 0.12, 0.03, 0.05); } break;
      case 'build': tone('triangle', 130, 70, 0.25, 0.12); noise(0.25, 0.08, 300, 1, 'lowpass'); tone('sine', 520, 780, 0.15, 0.05, 0.1); break;
      case 'upgrade': case 'perk': [392, 494, 587, 784].forEach((f, i) => tone('triangle', f, 0, 0.22, 0.07, i * 0.07)); break;
      case 'move': noise(0.18, 0.06, 500, 1, 'lowpass'); tone('triangle', 330, 494, 0.18, 0.06, 0.06); break;
      case 'sell': tone('sine', 700, 350, 0.25, 0.06); noise(0.2, 0.05, 900, 2); break;
      case 'leak': tone('sawtooth', e.boss ? 70 : 110, 50, 0.5, 0.14); noise(0.4, 0.1, 200, 1, 'lowpass'); break;
      case 'wave': [196, 196, 261.6].forEach((f, i) => tone('sawtooth', f, f * 0.98, 0.35, 0.06, i * 0.18)); noise(0.6, 0.05, 150, 1, 'lowpass'); break;
      case 'boss': tone('sawtooth', 65, 49, 1.4, 0.12); tone('sawtooth', 98, 73, 1.4, 0.08); break;
      case 'waveClear': [523, 659, 784].forEach((f, i) => tone('triangle', f, 0, 0.3, 0.06, i * 0.1)); break;
      case 'heal': if (e.any && ok('heal', 0.4)) tone('sine', 660, 990, 0.3, 0.025); break;
      case 'freeze': if (ok('frz', 0.1)) noise(0.2, 0.05, 5000, 4); break;
      case 'win': [262, 330, 392, 523].forEach((f, i) => tone('triangle', f, 0, 0.6, 0.09, i * 0.18)); break;
      case 'lose': [220, 196, 175, 131].forEach((f, i) => tone('sawtooth', f, f * 0.97, 0.6, 0.07, i * 0.25)); break;
    }
  };
})();
