/**
 * Mikrofonövervakning för vaktläget. Web Audio används här enbart för
 * NIVÅMÄTNING av mikrofonen (skärmen är på i vaktläget, så iOS-suspendering
 * är inte ett problem). Inget ljud spelas in eller lagras – bara ett RMS-värde
 * läses ut i realtid.
 *
 * Högpassfilter ~300 Hz före mätningen gör att gråtets högre frekvenser
 * sticker ut mot appens eget dova brus.
 */
export class MicMonitor {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array | null = null;

  get active(): boolean {
    return this.analyser !== null;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Ekosläckning PÅ är avgörande på iPhone: med den av väljer iOS ett
        // "mätläge" som routar all uppspelning till ÖRONHÖGTALAREN i stället
        // för högtalaren – triggerljudet blir då i praktiken ohörbart. Med EC
        // på behåller iOS högtalaren, och som bonus subtraheras appens eget
        // ljud ur mikrofonsignalen så att vakten inte triggar på sig själv.
        echoCancellation: true,
        // AGC och brusreducering hålls av – baslinjelogiken vill se rå nivå.
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    type CtxCtor = typeof AudioContext;
    const Ctx: CtxCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: CtxCtor }).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume().catch(() => undefined);
    const src = this.ctx.createMediaStreamSource(this.stream);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;
    hp.Q.value = 0.7;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    src.connect(hp);
    hp.connect(analyser);
    // Ansluts INTE till destination – inget mikrofonljud hörs i högtalaren.
    this.analyser = analyser;
    this.buf = new Float32Array(analyser.fftSize);
  }

  /** Aktuell nivå i dBFS (ca -90 … 0). */
  readDb(): number {
    if (!this.analyser || !this.buf) return -90;
    this.analyser.getFloatTimeDomainData(this.buf as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    return 20 * Math.log10(rms + 1e-7);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.buf = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
