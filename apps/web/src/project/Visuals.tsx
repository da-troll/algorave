// Hydra visuals reading the audio level. GPU work stops when the tab is hidden.
import { useEffect, useRef, useState } from "react";
import { Button, cn } from "@trollefsen-labs/components-react";
import { Maximize2, Sparkles } from "lucide-react";
// hydra-synth (AGPL) is copied into public/vendor at build (scripts/vendor-web.mjs):
// the CSP allows scripts from self only, and initHydra would otherwise load unpkg.
const hydraUrl = new URL("./vendor/hydra-synth.js", location.href).href;

// Hydra code is evaluated as hydra's own global API (osc, noise, out, a.fft).
const PRESETS: Record<string, string> = {
  "Kick bloom": "osc(8, 0.05, 1.2).color(0.8, 0.5, 1).modulate(noise(3), () => a.fft[0] * 0.6).scale(() => 1 + a.fft[0] * 0.4).out()",
  "Tunnel": "shape(4, 0.4, 0.02).repeat(3, 3).scrollX(() => time * 0.05).modulateRotate(osc(2), () => a.fft[1] * 2).kaleid(4).out()",
  "Acid wash": "voronoi(5, () => 0.3 + a.fft[2], 0.3).color(0.9, 0.4, 0.8).mult(osc(20, 0.1, () => a.fft[0] * 4)).out()",
  "Static": "noise(() => 4 + a.fft[3] * 20, 0.2).thresh(0.5).color(0.7, 0.6, 1).out()",
};

export function VisualsPanel({ active }: { active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState("Kick bloom");
  const [err, setErr] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active || !on) return;
    let stopped = false;
    (async () => {
      try {
        const { initHydra } = await import("@strudel/hydra");
        const h = (await initHydra({ detectAudio: true, src: hydraUrl })) as { synth: { hush: () => void } };
        const cv = document.getElementById("hydra-canvas");
        if (cv && box.current && !stopped) { cv.style.position = "absolute"; cv.style.inset = "0"; cv.style.width = "100%"; cv.style.height = "100%"; box.current.appendChild(cv); }
        new Function(PRESETS[preset]!)();
        void h;
      } catch (e) { setErr((e as Error).message); }
    })();
    return () => {
      stopped = true;
      void import("@strudel/hydra").then(({ clearHydra }) => clearHydra());
    };
  }, [active, on, preset]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="visuals">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs">
        <Button size="sm" variant={on ? "secondary" : "default"} className="h-7 px-2 text-xs" onClick={() => setOn(!on)}><Sparkles />{on ? "Stop visuals" : "Start visuals"}</Button>
        {Object.keys(PRESETS).map((p) => <button key={p} onClick={() => setPreset(p)} className={cn("rounded-md px-2 py-0.5", preset === p ? "bg-[var(--surface-selected)] text-[var(--text-primary)]" : "text-[var(--text-muted)]")}>{p}</button>)}
        <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => void box.current?.requestFullscreen()}><Maximize2 />Full screen</Button>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 bg-[var(--surface-sunken)]">
        {!on && <p className="p-3 text-sm text-[var(--text-muted)]">Hydra visuals react to the music (audio levels via a.fft). They run on the GPU and stop when this tab is hidden.</p>}
        {err && <p className="p-3 text-sm text-[var(--error-fg)]">{err}</p>}
      </div>
    </div>
  );
}
