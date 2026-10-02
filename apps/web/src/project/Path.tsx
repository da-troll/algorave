// Guided path: empty editor to finished track, lesson by lesson. Progress per song.
import { useEffect, useState } from "react";
import { Button, Checkbox, cn, toast } from "@trollefsen-labs/components-react";
import { Play, MessageSquarePlus } from "lucide-react";
import { compileFiles } from "@algorave/ears/compile-core";
import { api, type Lesson, type SongDetail } from "../api.ts";
import { engine } from "./engine.ts";

export function PathPanel({ slug, detail, onPrompt }: { slug: string; detail: SongDetail | null; onPrompt: (text: string) => void }) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { void api<Lesson[]>("GET", "/api/content/path").then((l) => { setLessons(l); setSel((s) => s ?? l[0]?.id ?? null); }); }, []);
  useEffect(() => { setDone(detail?.song.progress ?? []); }, [detail?.song.progress]);
  const lesson = lessons.find((l) => l.id === sel);
  const mark = async (id: string, on: boolean) => {
    const next = on ? [...new Set([...done, id])] : done.filter((x) => x !== id);
    setDone(next);
    try { await api("PUT", `/api/songs/${slug}/progress`, { done: next }); } catch (e) { toast.error((e as Error).message); }
  };
  const showMe = (l: Lesson) => {
    const code = compileFiles({ songJson: JSON.stringify({ title: l.title, bpm: detail?.meta.bpm ?? 128, key: "C", scale: "minor", sections: [] }), parts: {}, arrange: l.reference_snippet }).code;
    engine.setCode(code, true);
    void engine.evaluate();
  };
  return (
    <div className="flex h-full min-h-0 flex-col sm:flex-row" data-testid="path">
      <ol className="shrink-0 overflow-y-auto border-b border-[var(--border-subtle)] p-1 sm:w-64 sm:border-r sm:border-b-0">
        {lessons.map((l) => (
          <li key={l.id} className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-sm", sel === l.id ? "bg-[var(--surface-selected)]" : "hover:bg-[var(--surface-hover)]")}>
            <Checkbox checked={done.includes(l.id)} onCheckedChange={(v) => void mark(l.id, !!v)} aria-label={`Done: ${l.title}`} />
            <button className="min-w-0 flex-1 truncate text-left text-[var(--text-primary)]" onClick={() => setSel(l.id)}><span className="font-mono text-[var(--text-muted)]">{l.order}.</span> {l.title}</button>
          </li>
        ))}
      </ol>
      {lesson && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
          <h3 className="text-base font-semibold text-[var(--heading-color)]">{lesson.order}. {lesson.title}</h3>
          <p className="mt-1 text-[var(--text-secondary)]"><span className="text-[var(--text-muted)]">Goal: </span>{lesson.goal}</p>
          <p className="mt-2 leading-relaxed text-[var(--text-secondary)]">{lesson.explain}</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--surface-sunken)] p-2 font-mono text-xs text-[var(--text-primary)]">{lesson.reference_snippet}</pre>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => showMe(lesson)}><Play />Show me</Button>
            <Button size="sm" onClick={() => onPrompt(lesson.try_prompt)}><MessageSquarePlus />Do it in my song</Button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">"Show me" plays the reference in a scratch slot. "Do it in my song" puts this in the prompt box: {lesson.try_prompt}</p>
        </div>
      )}
    </div>
  );
}
