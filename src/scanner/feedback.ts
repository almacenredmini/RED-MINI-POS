let ctx: AudioContext | null = null;

/** Beep corto generado (sin archivos de audio) + vibración en celulares. */
export function scanFeedback(ok = true): void {
  navigator.vibrate?.(ok ? 60 : [40, 60, 40]);
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1800 : 420;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Sin audio disponible: la vibración/feedback visual alcanza.
  }
}
