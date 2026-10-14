// Synthetischer Motorsound und Effekte über WebAudio
const GEARS = [0, 14, 28, 42, 56, 70, 120];

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter.connect(this.engineGain).connect(this.master);

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.osc1.start();
    this.osc2.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  engine(speed, throttle, active) {
    if (!this.ctx) return;
    let gear = 0;
    while (gear < GEARS.length - 2 && speed > GEARS[gear + 1]) gear++;
    const rpm = Math.min(1, (speed - GEARS[gear]) / (GEARS[gear + 1] - GEARS[gear]));
    const f = 55 + rpm * 120 + gear * 12;
    const now = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, now, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, now, 0.03);
    this.filter.frequency.setTargetAtTime(500 + throttle * 1400 + rpm * 600, now, 0.05);
    this.engineGain.gain.setTargetAtTime(active ? 0.06 + throttle * 0.06 : 0, now, 0.08);
  }

  beep(freq = 880, dur = 0.15, type = 'sine', vol = 0.25) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  thud(strength) {
    this.beep(70 + Math.random() * 30, 0.12, 'triangle', Math.min(0.4, strength * 0.03));
  }
}
