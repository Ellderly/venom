// Звук. По умолчанию всё синтезируется (WebAudio). Если в папке sounds/ лежат реальные записи
// и они перечислены в sounds/list.json (geran — зацикленный мотор, explosion — взрыв, siren — сирена), используются они.
type Voice = { src: AudioBufferSourceNode; gain: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode };
export interface Heard { dist: number; closing: number; pan: number; dive: number; seed: number }

export class Sound {
  private ctx: AudioContext | null = null; private master!: GainNode; private wet!: GainNode;
  private voices: Voice[] = []; private engBuf!: AudioBuffer; private boomBuf!: AudioBuffer; private crackBuf!: AudioBuffer; private debrisBuf!: AudioBuffer;
  private real: Record<string, AudioBuffer> = {};
  volume = 0.7;

  /** Браузеры разрешают звук только после действия пользователя. */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const c = this.ctx = new AudioContext();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(c.destination);
      this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(comp);
      // эхо города: свёртка с затухающим шумом
      const ir = c.createBuffer(2, c.sampleRate * 3.2, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < d.length; i++) { const t = i / d.length; lp += ((Math.random() * 2 - 1) - lp) * (0.5 - 0.42 * t); d[i] = lp * Math.pow(1 - t, 2.6) * (i < 600 ? i / 600 : 1); } }
      const conv = c.createConvolver(); conv.buffer = ir; this.wet = c.createGain(); this.wet.gain.value = 0.55; this.wet.connect(conv); conv.connect(this.master);
      this.engBuf = this.makeEngine(c); this.makeBlast(c);
      for (let i = 0; i < 4; i++) this.voices.push(this.makeVoice(c, this.engBuf));
      void this.loadReal();
    } catch { this.ctx = null; }
  }

  /** Реальные записи перечисляются в sounds/list.json, например {"geran": "geran.mp3"}. */
  private async loadReal() {
    try {
      const list = await (await fetch('./sounds/list.json')).json() as Record<string, string>;
      for (const [name, file] of Object.entries(list)) {
        if (!['geran', 'explosion', 'siren'].includes(name)) continue;
        this.real[name] = await this.ctx!.decodeAudioData(await (await fetch(`./sounds/${file}`)).arrayBuffer());
        if (name === 'geran') { for (const v of this.voices) { v.src.stop(); v.gain.disconnect(); } this.voices = [0, 1, 2, 3].map(() => this.makeVoice(this.ctx!, this.real.geran)); }
      }
    } catch { /* записей нет — остаётся синтез */ }
  }

  /** Мотор: двухтактный оппозитник. Импульсы вспышек с неровностью по периоду и силе + гул винта. */
  private makeEngine(c: AudioContext) {
    const sr = c.sampleRate, len = Math.floor(sr * 2.4), buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0);
    const f0 = 118; let t = 0;
    while (t < len) {                                   // вспышки в цилиндрах
      const period = sr / f0 * (1 + (Math.random() - 0.5) * 0.05), amp = 0.6 + Math.random() * 0.5, strong = Math.random() < 0.5 ? 1 : 0.62;
      const n = Math.floor(period * 0.55);
      for (let i = 0; i < n && t + i < len; i++) { const k = i / n; d[Math.floor(t) + i] += amp * strong * Math.exp(-k * 5.5) * (Math.sin(k * 21) * 0.7 + (Math.random() - 0.5) * 0.9); }
      t += period;
    }
    for (let i = 0; i < len; i++) {                      // винт и резонанс выхлопа
      const s = i / sr; d[i] += 0.22 * Math.sin(6.283 * f0 * 0.5 * s) + 0.14 * Math.sin(6.283 * f0 * 2 * s + 0.4 * Math.sin(6.283 * 9 * s));
      d[i] = Math.tanh(d[i] * 1.6) * 0.7;                // перегруз даёт характерный «треск мопеда»
    }
    const fade = Math.floor(sr * 0.02); for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[len - fade + i] * (1 - k); } // бесшовная петля
    const out = c.createBuffer(1, len - fade, sr); out.copyToChannel(d.subarray(0, len - fade), 0); return out;
  }

  private makeVoice(c: AudioContext, buf: AudioBuffer): Voice {
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.4;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const gain = c.createGain(); gain.gain.value = 0; const pan = c.createStereoPanner();
    src.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect(this.master);
    const send = c.createGain(); send.gain.value = 0.25; pan.connect(send); send.connect(this.wet);
    src.start(0, Math.random() * buf.duration); return { src, gain, lp, pan };
  }

  private makeBlast(c: AudioContext) {
    const sr = c.sampleRate;
    const mk = (sec: number, f: (t: number, i: number) => number) => { const b = c.createBuffer(1, Math.floor(sr * sec), sr), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = f(i / sr, i); return b; };
    this.crackBuf = mk(0.25, t => (Math.random() * 2 - 1) * Math.exp(-t * 38) * (t < 0.002 ? t / 0.002 : 1));
    let br = 0, ph = 0; // грохот: коричневый шум + уходящий вниз суб-бас
    this.boomBuf = mk(4.5, t => { br += ((Math.random() * 2 - 1) - br) * 0.035; ph += 6.283 * (26 + 48 * Math.exp(-t * 3.2)) / sr;
      return Math.tanh((br * 9 * Math.exp(-t * 1.5) + Math.sin(ph) * 1.1 * Math.exp(-t * 2.6) + (Math.random() * 2 - 1) * 0.5 * Math.exp(-t * 9)) * 1.4) * Math.min(1, t / 0.004); });
    let env = 0; // осыпающиеся обломки и стекло
    this.debrisBuf = mk(3.5, t => { if (Math.random() < 0.0016 * Math.exp(-t * 0.9)) env = 0.4 + Math.random() * 0.6; env *= 0.9965; return (Math.random() * 2 - 1) * env * env * Math.min(1, t * 3); });
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  /** Раз в кадр: ближайшие к камере цели. Пустой список — тишина. */
  engines(list: Heard[]) {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    list.sort((a, b) => a.dist - b.dist);
    this.voices.forEach((v, i) => {
      const h = list[i];
      if (!h || h.dist > 5000) { v.gain.gain.setTargetAtTime(0, t, 0.2); return; }
      const g = Math.min(1, 140 / Math.max(140, h.dist)) * (0.5 + 0.5 * h.dive) * (1 - h.dist / 5000);
      v.gain.gain.setTargetAtTime(g * 0.9, t, 0.12);
      v.lp.frequency.setTargetAtTime(Math.max(350, 7000 * Math.exp(-h.dist / 900)), t, 0.2);   // вдали остаётся только низкий гул
      const doppler = 1 + Math.max(-0.14, Math.min(0.14, h.closing / 340));
      v.src.playbackRate.setTargetAtTime((0.96 + (h.seed % 1) * 0.08) * doppler * (1 + 0.42 * h.dive), t, 0.15);       // в пикировании мотор «воет»
      v.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, h.pan)), t, 0.1);
    });
  }

  private play(buf: AudioBuffer, when: number, gain: number, lpFreq: number, rate = 1, wet = 0.6, hpFreq = 0) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpFreq; const g = c.createGain(); g.gain.value = gain;
    s.connect(lp); let out: AudioNode = lp;
    if (hpFreq) { const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpFreq; lp.connect(hp); out = hp; }
    out.connect(g); g.connect(this.master); const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.wet); s.start(when);
  }

  explosion(dist: number, tnt: number, collapse = false) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + Math.min(dist / 340, 12), size = Math.cbrt(tnt) / 4, att = Math.min(1, 250 / Math.max(250, dist));
    if (this.real.explosion) { this.play(this.real.explosion, t, 1.2 * att * size, Math.max(300, 16000 * Math.exp(-dist / 1500)), 1, 0.4); return; }
    const air = Math.exp(-dist / 1200); // воздух съедает верхние частоты
    if (dist < 2500) this.play(this.crackBuf, t, 1.5 * att * air * size, 9000, 1 / (0.8 + size * 0.2), 0.3, 500);
    this.play(this.boomBuf, t, 2.2 * Math.sqrt(att) * size, Math.max(90, 2600 * air), 1 / (0.75 + size * 0.25), 0.8);
    if (dist < 1800) this.play(this.debrisBuf, t + 0.35, (collapse ? 0.9 : 0.4) * att, 5000 * air + 400, collapse ? 0.7 : 1, 0.5, 300);
  }

  siren() {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    if (this.real.siren) { this.play(this.real.siren, t, 0.35, 6000, 1, 0.5); return; }
    const g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
    for (const [mul, vol, type] of [[1, 0.5, 'triangle'], [2, 0.16, 'sine'], [3.01, 0.07, 'sine']] as const) { // электромеханическая сирена: ровный вой с гармониками
      const o = c.createOscillator(), og = c.createGain(); o.type = type; og.gain.value = vol;
      o.frequency.setValueAtTime(180 * mul, t);
      for (let i = 0; i < 3; i++) { o.frequency.exponentialRampToValueAtTime(455 * mul, t + i * 6 + 2.6); o.frequency.setValueAtTime(455 * mul, t + i * 6 + 4); o.frequency.exponentialRampToValueAtTime(300 * mul, t + i * 6 + 6); }
      o.connect(og); og.connect(g); o.start(t); o.stop(t + 19);
    }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 2); g.gain.setValueAtTime(0.06, t + 15); g.gain.linearRampToValueAtTime(0, t + 18.5);
    g.connect(lp); lp.connect(this.wet); const dry = c.createGain(); dry.gain.value = 0.35; lp.connect(dry); dry.connect(this.master);
  }
}
