/**
 * Procedural sound effects (original, synthesized at runtime with WebAudio — no sample assets).
 * Every sound is triggered by an authoritative event, never by local input alone.
 */
type SfxName =
  | 'pulse'
  | 'sweep'
  | 'guard'
  | 'guardBreak'
  | 'liftStart'
  | 'impact'
  | 'goal'
  | 'countdown'
  | 'kickoff'
  | 'roundEnd'
  | 'deny'
  | 'ui';

class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  volume = 0.7;

  /** Must be called from a user gesture (autoplay policies). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /**
   * @param pan  stereo position in [-1, 1] (arena x mapped by the caller)
   * @param intensity  0..1 loudness / brightness scale
   */
  play(name: SfxName, pan = 0, intensity = 1): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!this.enabled || !ctx || !out || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    const k = Math.max(0.05, Math.min(1, intensity));
    switch (name) {
      case 'pulse':
        this.tone(p, t, 'sine', 140, 48, 0.22, 0.55 * k);
        this.burst(p, t, 1800, 0.08, 0.25 * k, 'bandpass');
        break;
      case 'sweep':
        this.burst(p, t, 900, 0.7, 0.22 * k, 'bandpass', 2600);
        break;
      case 'guard':
        this.tone(p, t, 'triangle', 90, 60, 0.3, 0.4 * k);
        this.burst(p, t, 400, 0.18, 0.3 * k, 'lowpass');
        break;
      case 'guardBreak':
        this.burst(p, t, 3000, 0.35, 0.4 * k, 'highpass');
        this.tone(p, t, 'square', 220, 70, 0.25, 0.12 * k);
        break;
      case 'liftStart':
        this.tone(p, t, 'sine', 220, 440, 0.4, 0.18 * k);
        break;
      case 'impact':
        this.burst(p, t, 1200 + 2400 * k, 0.06 + 0.06 * k, 0.35 * k, 'bandpass');
        this.tone(p, t, 'sine', 180 + 120 * k, 90, 0.08, 0.25 * k);
        break;
      case 'goal':
        this.tone(p, t, 'sine', 70, 35, 1.2, 0.7);
        this.tone(p, t, 'triangle', 392, 392, 0.9, 0.15);
        this.tone(p, t + 0.12, 'triangle', 523.25, 523.25, 0.9, 0.12);
        this.tone(p, t + 0.24, 'triangle', 659.25, 659.25, 1.1, 0.12);
        this.burst(p, t, 600, 1.0, 0.3, 'lowpass');
        break;
      case 'countdown':
        this.tone(p, t, 'sine', 660, 660, 0.12, 0.25);
        break;
      case 'kickoff':
        this.tone(p, t, 'sine', 990, 990, 0.25, 0.3);
        this.burst(p, t, 2400, 0.2, 0.15, 'bandpass');
        break;
      case 'roundEnd':
        this.tone(p, t, 'triangle', 330, 330, 0.8, 0.15);
        this.tone(p, t + 0.15, 'triangle', 440, 440, 0.9, 0.13);
        break;
      case 'deny':
        this.tone(p, t, 'square', 180, 150, 0.09, 0.08);
        break;
      case 'ui':
        this.tone(p, t, 'sine', 880, 880, 0.05, 0.1);
        break;
    }
    // Disconnect the panner after the longest voice has finished.
    setTimeout(() => p.disconnect(), 2000);
  }

  private tone(
    dest: AudioNode,
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(
    dest: AudioNode,
    t: number,
    freq: number,
    dur: number,
    gain: number,
    type: BiquadFilterType,
    freqEnd?: number,
  ): void {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
}

export const sfx = new SoundKit();
