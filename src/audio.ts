// Звук синтезируется на лету (WebAudio): мотор дрона, взрывы, сирена. Файлов-ассетов нет.
export class Sound {
  private ctx: AudioContext | null = null; private master!: GainNode; private eng!: GainNode; private engOsc: OscillatorNode[] = [];
  volume = 0.6;
  /** Браузеры разрешают звук только после действия пользователя. */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const c = this.ctx = new AudioContext(); this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
      this.eng = c.createGain(); this.eng.gain.value = 0; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; this.eng.connect(lp); lp.connect(this.master);
      for (const [f, type] of [[78, 'sawtooth'], [156.5, 'square'], [39, 'sawtooth']] as const) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; const g = c.createGain(); g.gain.value = type === 'square' ? 0.25 : 0.5; o.connect(g); g.connect(this.eng); o.start(); this.engOsc.push(o); }
      const trem = c.createOscillator(); trem.frequency.value = 26; const tg = c.createGain(); tg.gain.value = 0.35; trem.connect(tg); tg.connect(this.eng.gain); trem.start(); // «мопедный» треск
    } catch { this.ctx = null; }
  }
  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }
  /** dist — расстояние от камеры до ближайшего дрона, м; closing — скорость сближения для эффекта Доплера. */
  engine(dist: number, closing: number) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const g = dist < 0 ? 0 : Math.min(0.5, 60 / Math.max(60, dist)) * (dist > 6000 ? 0 : 1);
    this.eng.gain.setTargetAtTime(g, t, 0.15);
    const k = 1 + Math.max(-0.15, Math.min(0.15, closing / 340));
    [78, 156.5, 39].forEach((f, i) => this.engOsc[i].frequency.setTargetAtTime(f * k, t, 0.1));
  }
  explosion(dist: number, tnt: number) {
    const c = this.ctx; if (!c) return;
    const delay = Math.min(dist / 340, 8), t = c.currentTime + delay, len = 2.6;
    const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 5);
    const src = c.createBufferSource(); src.buffer = buf; const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.max(180, 2400 - dist * 0.5), t); lp.frequency.exponentialRampToValueAtTime(70, t + len);
    const g = c.createGain(); g.gain.value = Math.min(1.4, Math.cbrt(tnt) * 0.3 * 400 / Math.max(400, dist));
    const sub = c.createOscillator(); sub.frequency.setValueAtTime(70, t); sub.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const sg = c.createGain(); sg.gain.setValueAtTime(g.gain.value, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(lp); lp.connect(g); g.connect(this.master); sub.connect(sg); sg.connect(this.master); src.start(t); sub.start(t); sub.stop(t + 1);
  }
  siren() {
    const c = this.ctx; if (!c) return; const t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    o.frequency.setValueAtTime(260, t); for (let i = 0; i < 3; i++) { o.frequency.linearRampToValueAtTime(560, t + i * 4 + 2); o.frequency.linearRampToValueAtTime(300, t + i * 4 + 4); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 1); g.gain.setValueAtTime(0.07, t + 10); g.gain.linearRampToValueAtTime(0, t + 12);
    o.connect(lp); lp.connect(g); g.connect(this.master); o.start(t); o.stop(t + 12.1);
  }
}
