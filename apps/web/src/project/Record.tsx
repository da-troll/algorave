// Record the live output to a 16-bit WAV in the browser; takes are saved to the song (gitignored).
import { useEffect, useRef, useState } from "react";
import { Button, Input, toast } from "@trollefsen-labs/components-react";
import { Circle, Square, Download, FileAudio } from "lucide-react";
import { api, basePath } from "../api.ts";
import { engine } from "./engine.ts";
import { useEngine } from "./Repl.tsx";

function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, n = buf.length;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c]![i]!)); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return out;
}
function b64(buf: ArrayBuffer): string {
  let s = ""; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

type Take = { name: string; bytes: number; at: string };

export function RecordPanel({ slug, bpm }: { slug: string; bpm: number }) {
  const st = useEngine();
  const [bars, setBars] = useState(4);
  const [rec, setRec] = useState<{ left: number } | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const mr = useRef<MediaRecorder | null>(null);
  const load = () => void api<Take[]>("GET", `/api/songs/${slug}/takes`).then(setTakes).catch(() => {});
  useEffect(load, [slug]);
  const start = async () => {
    if (!st.playing) await engine.play();
    const stream = engine.recorderTap();
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    mr.current = r;
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = async () => {
      setRec(null);
      try {
        const blob = new Blob(chunks, { type: r.mimeType });
        const ac = new AudioContext();
        const audio = await ac.decodeAudioData(await blob.arrayBuffer());
        await ac.close();
        const wav = encodeWav(audio);
        await api("POST", `/api/songs/${slug}/takes`, { wav: b64(wav), bars });
        toast.success(`Saved a ${bars}-bar take (${(wav.byteLength / 1024).toFixed(0)} KB)`);
        load();
      } catch (e) { toast.error((e as Error).message); }
    };
    const ms = (bars * 4 * 60 * 1000) / bpm;
    r.start(250);
    const t0 = Date.now();
    setRec({ left: ms });
    const iv = setInterval(() => { const left = ms - (Date.now() - t0); if (left <= 0) { clearInterval(iv); if (r.state === "recording") r.stop(); } else setRec({ left }); }, 200);
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="record">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs">
        <label className="flex items-center gap-1 text-[var(--text-muted)]">Bars <Input type="number" min={1} max={64} value={bars} onChange={(e) => setBars(Math.max(1, Math.min(64, Number(e.target.value) || 4)))} className="h-7 w-16 text-xs" /></label>
        {rec ? <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => mr.current?.stop()}><Square />Stop ({(rec.left / 1000).toFixed(1)}s)</Button>
          : <Button size="sm" className="h-7 px-2 text-xs" disabled={!st.ready} onClick={() => void start()}><Circle />Record {bars} bars live</Button>}
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!st.ready || !!rec} title="Renders offline with renderPatternAudio and downloads; stops playback" onClick={() => void engine.renderOffline(bars, `algorave-${slug}-${bars}bars`)}><FileAudio />Render {bars} bars offline</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {takes.length === 0 && <p className="text-sm text-[var(--text-muted)]">No takes yet. Live takes record exactly what you hear, at {bpm} bpm.</p>}
        {takes.map((t) => (
          <div key={t.name} className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] py-1.5 text-xs" data-take={t.name}>
            <span className="font-mono text-[var(--text-secondary)]">{t.name}</span>
            <span className="text-[var(--text-muted)]">{(t.bytes / 1024).toFixed(0)} KB</span>
            <audio controls preload="none" src={`${basePath}api/songs/${slug}/takes/${t.name}`} className="h-8" />
            <a href={`${basePath}api/songs/${slug}/takes/${t.name}`} download className="inline-flex items-center gap-1 text-[var(--link)]"><Download className="size-3.5" />WAV</a>
          </div>
        ))}
      </div>
    </div>
  );
}
