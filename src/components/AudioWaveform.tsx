import { useEffect, useState } from "react";

const BARS = 28;

/** Decode audio and render peak bars into the existing inspiration-wave chrome. */
export function AudioWaveform({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    (async () => {
      try {
        const response = await fetch(src);
        const buffer = await response.arrayBuffer();
        const audio = await ctx.decodeAudioData(buffer.slice(0));
        const channel = audio.getChannelData(0);
        const block = Math.max(1, Math.floor(channel.length / BARS));
        const next: number[] = [];
        for (let i = 0; i < BARS; i += 1) {
          let sum = 0;
          const start = i * block;
          const end = Math.min(channel.length, start + block);
          for (let j = start; j < end; j += 1) sum += Math.abs(channel[j]);
          next.push(sum / (end - start || 1));
        }
        const max = Math.max(...next, 0.0001);
        if (!cancelled) setPeaks(next.map((value) => Math.max(0.12, value / max)));
      } catch {
        if (!cancelled) setPeaks(null);
      } finally {
        void ctx.close();
      }
    })();
    return () => {
      cancelled = true;
      void ctx.close();
    };
  }, [src]);

  return (
    <div className={`inspiration-wave real ${className}`.trim()}>
      <div className="inspiration-wave-peaks" aria-hidden>
        {(peaks ?? Array.from({ length: BARS }, (_, index) => 0.25 + ((index * 17) % 40) / 100)).map(
          (peak, index) => (
            <i key={index} style={{ height: `${Math.round(peak * 100)}%` }} />
          ),
        )}
      </div>
      <audio controls src={src} preload="metadata" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />
    </div>
  );
}
