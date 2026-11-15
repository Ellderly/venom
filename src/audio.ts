// Звук. Записи берутся из sounds/manifest.json (слот → список файлов-вариантов); чего там нет — синтезируется (WebAudio).
// Манифест пишет tools/import_sounds.py. Юниты ссылаются на слоты по имени (units.ts → sounds).
type Chain = { src: AudioBufferSourceNode; gain: GainNode; lp: BiquadFilterNode };
type Voice = { key: string; near: Chain; far: Chain; pan: StereoPannerNode; nk: number; fk: number };
export type Engine = 'piston' | 'jet';
export interface Heard { dist: number; closing: number; pan: number; dive: number; seed: number; near?: string; far?: string; engine?: Engine }
export interface BlastSounds { blastNear?: string; blastFar?: string; debris?: string }

export class Sound {
  private ctx: AudioContext | null = null; private master!: GainNode; private wet!: GainNode;
  private voices: Voice[] = []; private engBuf!: AudioBuffer; private jetBuf!: AudioBuffer; private level = new Map<AudioBuffer, number>(); private boomBuf!: AudioBuffer; private crackBuf!: AudioBuffer; private debrisBuf!: AudioBuffer;
  private slots: Record<string, AudioBuffer[]> = {};
  volume = 0.7;
  /** Сколько записей загружено — показывается в настройках. */
  get recorded() { return Object.values(this.slots).reduce((n, a) => n + a.length, 0); }

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
      this.engBuf = this.makeEngine(c); this.jetBuf = this.makeJet(c); this.makeBlast(c);
      for (let i = 0; i < 4; i++) this.voices.push(this.makeVoice(c, '', this.engBuf, this.engBuf));
      void this.loadRecorded();
    } catch { this.ctx = null; }
  }

  private async loadRecorded() {
    let man: Record<string, string[] | string> = {};
    try { man = await (await fetch('./sounds/manifest.json')).json(); } catch { /* манифеста нет */ }
    await Promise.all(Object.entries(man).map(async ([slot, files]) => {
      if (slot.startsWith('_')) return;
      for (const f of Array.isArray(files) ? files : [files]) {
        try { (this.slots[slot] ??= []).push(await this.ctx!.decodeAudioData(await (await fetch(`./sounds/${f}`)).arrayBuffer())); } catch { /* файл не прочитался — пропускаем */ }
      }
    }));
    for (const v of this.voices) v.key = '?'; // голоса пересоберутся с записями при следующем кадре
  }
  /** Множитель громкости петли: записи сведены с разным уровнем, а моторы должны звучать сопоставимо. */
  private norm(b: AudioBuffer) {
    let k = this.level.get(b); if (k !== undefined) return k;
    const d = b.getChannelData(0); let sum = 0, n = 0; for (let i = 0; i < d.length; i += 16) { sum += d[i] * d[i]; n++; }
    k = Math.min(2.5, Math.max(0.4, 0.3 / Math.max(0.01, Math.sqrt(sum / n)))); this.level.set(b, k); return k;
  }
  private pick(slot?: string) { const a = slot ? this.slots[slot] : undefined; return a?.length ? a[(Math.random() * a.length) | 0] : null; }

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

  /** Турбореактивный двигатель: свист компрессора (два тона с лёгкой дрожью), шипение струи и низкий гул. */
  private makeJet(c: AudioContext) {
    const sr = c.sampleRate, len = Math.floor(sr * 3.2), buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0);
    let low = 0, mid = 0, hi = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < len; i++) {
      const s = i / sr, w = Math.random() * 2 - 1;
      low += (w - low) * 0.004; mid += (w - mid) * 0.09; hi += (w - hi) * 0.5;                 // гул, рёв струи, шипение
      p1 += 6.283 * 2350 * (1 + 0.004 * Math.sin(6.283 * 0.9 * s)) / sr; p2 += 6.283 * 3720 * (1 + 0.003 * Math.sin(6.283 * 1.3 * s + 1)) / sr;
      const flutter = 1 + 0.12 * Math.sin(6.283 * 5.5 * s) * Math.sin(6.283 * 0.7 * s);
      d[i] = Math.tanh((low * 14 + (mid - low) * 1.5 * flutter + (hi - mid) * 0.55 + 0.07 * Math.sin(p1) + 0.04 * Math.sin(p2)) * 1.3) * 0.7;
    }
    const fade = Math.floor(sr * 0.25); for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[len - fade + i] * (1 - k); } // бесшовная петля
    const out = c.createBuffer(1, len - fade, sr); out.copyToChannel(d.subarray(0, len - fade), 0); return out;
  }

  private makeChain(c: AudioContext, buf: AudioBuffer, out: AudioNode): Chain {
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.4;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const gain = c.createGain(); gain.gain.value = 0;
    src.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(out);
    src.start(0, Math.random() * buf.duration); return { src, gain, lp };
  }
  /** Голос цели: два слоя (ближний и дальний), между ними плавный переход по расстоянию. */
  private makeVoice(c: AudioContext, key: string, near: AudioBuffer, far: AudioBuffer): Voice {
    const pan = c.createStereoPanner(); pan.connect(this.master);
    const send = c.createGain(); send.gain.value = 0.25; pan.connect(send); send.connect(this.wet);
    return { key, pan, near: this.makeChain(c, near, pan), far: this.makeChain(c, far, pan), nk: this.norm(near), fk: this.norm(far) };
  }
  private dropVoice(v: Voice) { for (const ch of [v.near, v.far]) { try { ch.src.stop(); } catch { /* уже остановлен */ } ch.gain.disconnect(); } v.pan.disconnect(); }

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
    const sm = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    for (let i = 0; i < this.voices.length; i++) {
      let v = this.voices[i]; const h = list[i];
      if (!h || h.dist > 9000) { v.near.gain.gain.setTargetAtTime(0, t, 0.2); v.far.gain.gain.setTargetAtTime(0, t, 0.2); continue; }
      const jet = h.engine === 'jet', key = `${h.near ?? ''}|${h.far ?? ''}|${h.engine ?? ''}`;
      if (v.key !== key) { // другой тип цели или догрузились записи
        const nb = this.slots[h.near ?? '']?.[0] ?? (jet ? this.jetBuf : this.engBuf), fb = this.slots[h.far ?? '']?.[0] ?? nb;
        this.dropVoice(v); v = this.voices[i] = this.makeVoice(c, key, nb, fb);
      }
      // реактивный слышен дальше и «накрывает» позже: слои меняются на большем расстоянии
      const realFar = !!this.slots[h.far ?? '']?.length, ref = jet ? 230 : 140, x = jet ? sm(500, 2200, h.dist) : sm(350, 1600, h.dist);
      const g = Math.min(1, ref / Math.max(ref, h.dist)) * (jet ? 0.75 + 0.25 * h.dive : 0.5 + 0.5 * h.dive);
      v.near.gain.gain.setTargetAtTime(g * 0.9 * v.nk * (1 - x) * (1 - h.dist / 9000), t, 0.12);
      // дальний слой: настоящая запись «над городом» слышна дальше и не глушится фильтром
      v.far.gain.gain.setTargetAtTime(x * v.fk * (realFar ? 0.55 * Math.min(1, (jet ? 2600 : 1800) / h.dist) : g * 0.9) * (1 - sm(5000, 9000, h.dist)), t, 0.25);
      v.near.lp.frequency.setTargetAtTime(Math.max(350, (jet ? 11000 : 7000) * Math.exp(-h.dist / (jet ? 1100 : 900))), t, 0.2);
      v.far.lp.frequency.setTargetAtTime(realFar ? Math.max(900, 6000 * Math.exp(-h.dist / 4000)) : Math.max(300, 2500 * Math.exp(-h.dist / 1500)), t, 0.2);
      const dmax = jet ? 0.32 : 0.14, doppler = 1 + Math.max(-dmax, Math.min(dmax, h.closing / 340));
      const rate = (0.96 + (h.seed % 1) * 0.08) * doppler * (1 + (jet ? 0.1 : 0.42) * h.dive); // в пикировании поршневой мотор «воет», турбина почти не меняет тон
      v.near.src.playbackRate.setTargetAtTime(rate, t, 0.15); v.far.src.playbackRate.setTargetAtTime(rate, t, 0.15);
      v.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, h.pan)), t, 0.1);
    }
  }

  private play(buf: AudioBuffer, when: number, gain: number, lpFreq: number, rate = 1, wet = 0.6, hpFreq = 0) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpFreq; const g = c.createGain(); g.gain.value = gain;
    s.connect(lp); let out: AudioNode = lp;
    if (hpFreq) { const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpFreq; lp.connect(hp); out = hp; }
    out.connect(g); g.connect(this.master); const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.wet); s.start(when);
  }

  explosion(dist: number, tnt: number, collapse = false, snd: BlastSounds = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + Math.min(dist / 340, 12), size = Math.cbrt(tnt) / 4, att = Math.min(1, 250 / Math.max(250, dist));
    const rec = dist > 1200 ? this.pick(snd.blastFar) ?? this.pick(snd.blastNear) : this.pick(snd.blastNear) ?? this.pick(snd.blastFar);
    if (rec) {
      this.play(rec, t, 1.3 * Math.sqrt(att) * size, Math.max(300, 16000 * Math.exp(-dist / 1500)), 0.94 + Math.random() * 0.12, 0.4);
      const deb = dist < 1800 ? this.pick(snd.debris) : null;
      if (deb) this.play(deb, t + 0.4, (collapse ? 0.9 : 0.45) * att, 6000, 0.9 + Math.random() * 0.2, 0.5);
      return;
    }
    const air = Math.exp(-dist / 1200); // воздух съедает верхние частоты
    if (dist < 2500) this.play(this.crackBuf, t, 1.5 * att * air * size, 9000, 1 / (0.8 + size * 0.2), 0.3, 500);
    this.play(this.boomBuf, t, 2.2 * Math.sqrt(att) * size, Math.max(90, 2600 * air), 1 / (0.75 + size * 0.25), 0.8);
    if (dist < 1800) this.play(this.debrisBuf, t + 0.35, (collapse ? 0.9 : 0.4) * att, 5000 * air + 400, collapse ? 0.7 : 1, 0.5, 300);
  }

  siren() {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    const rec = this.pick('siren'); if (rec) { this.play(rec, t, 0.35, 6000, 1, 0.5); return; }
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
