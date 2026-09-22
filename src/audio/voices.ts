// Voice bookkeeping: every sound is a Voice owning its nodes. When all its sources end,
// every node is disconnected (no leaks). A VoiceTracker caps simultaneous voices (steals oldest).

export class Voice {
  readonly out: GainNode;
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private disposed = false;
  end = 0;
  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, private tracker: VoiceTracker | null) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.nodes.push(this.out);
  }
  /** Register a node for cleanup. */
  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  gain(v = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this.add(g);
  }
  filter(type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return this.add(b);
  }
  osc(type: OscillatorType, f: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return this.add(o);
  }
  buffer(buf: AudioBuffer, loop = false): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    return this.add(s);
  }
  pan(p: number): AudioNode {
    const c = this.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
    if (typeof c.createStereoPanner === 'function') {
      const s = c.createStereoPanner();
      s.pan.value = Math.max(-1, Math.min(1, p));
      return this.add(s);
    }
    return this.gain(1);
  }
  /** Start + schedule stop of a source; disposal happens when every source has ended. */
  play(s: AudioScheduledSourceNode, start: number, stop: number, offset?: number) {
    if (this.disposed) return;
    if (offset !== undefined && s instanceof AudioBufferSourceNode) s.start(start, offset);
    else s.start(start);
    s.stop(Math.max(start + 0.001, stop));
    this.pending++;
    this.srcs.push(s);
    s.onended = () => {
      this.pending--;
      if (this.pending <= 0) this.dispose();
    };
    this.end = Math.max(this.end, stop);
  }
  /** Fast fade-out and stop (voice stealing / scene changes). */
  kill(t: number, tau = 0.015) {
    if (this.disposed) return;
    try {
      const g = this.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(0, t, tau);
      for (const s of this.srcs) {
        try { s.stop(t + tau * 6); } catch { /* already stopped */ }
      }
    } catch { /* ignore */ }
    this.tracker?.remove(this);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
    for (const s of this.srcs) s.onended = null;
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.tracker?.remove(this);
  }
}

export class VoiceTracker {
  private voices: Voice[] = [];
  stolen = 0;
  constructor(private ctx: BaseAudioContext, private max: number) {}
  voice(dest: AudioNode): Voice {
    while (this.voices.length >= this.max) {
      const old = this.voices.shift()!;
      this.stolen++;
      old.kill(this.ctx.currentTime);
    }
    const v = new Voice(this.ctx, dest, this);
    this.voices.push(v);
    return v;
  }
  remove(v: Voice) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }
  get count() { return this.voices.length; }
  killAll(t: number) {
    for (const v of this.voices.slice()) v.kill(t, 0.05);
  }
}
