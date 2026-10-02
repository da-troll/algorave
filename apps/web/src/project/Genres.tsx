// Genre explorer: the same content/genres/*.json the strudel-genres skill reads.
import { useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from "@trollefsen-labs/components-react";
import { Play, Plus } from "lucide-react";
import { compileFiles } from "@algorave/ears/compile-core";
import { api, type Genre } from "../api.ts";
import { engine } from "./engine.ts";

export function playStarter(g: Genre) {
  const s = g.starter;
  const code = compileFiles({ songJson: JSON.stringify({ title: g.name, bpm: s.bpm, key: s.key, scale: s.scale, sections: s.sections }), parts: s.parts, arrange: s.arrange }).code;
  engine.setCode(code, true);
  void engine.evaluate();
}

export function GenresPanel({ onCreate }: { onCreate: (genreId: string) => void }) {
  const [genres, setGenres] = useState<Genre[]>([]);
  useEffect(() => { void api<Genre[]>("GET", "/api/content/genres").then(setGenres).catch((e) => toast.error((e as Error).message)); }, []);
  return (
    <div className="h-full overflow-y-auto p-2" data-testid="genres">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {genres.map((g) => (
          <Card key={g.id} className="gap-2 py-3" data-genre={g.id}>
            <CardHeader className="px-3"><CardTitle className="flex items-baseline gap-2 text-base">{g.name}<span className="font-mono text-xs font-normal text-[var(--text-muted)]">{g.bpm_range[0]}-{g.bpm_range[1]} bpm</span></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1.5 px-3 text-xs text-[var(--text-secondary)]">
              <p className="text-[var(--text-muted)]">{g.key_tendency}</p>
              <ul className="list-disc pl-4">{g.signature.slice(0, 4).map((s) => <li key={s}>{s}</li>)}</ul>
              <p><span className="text-[var(--text-muted)]">Listen for: </span>{g.listen_for}</p>
              <p className="text-[var(--text-muted)]">{g.artists_reference.slice(0, 4).join(" · ")}</p>
              <div className="mt-1 flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => playStarter(g)}><Play />Play starter</Button>
                <Button size="sm" className="h-7 px-2 text-xs" onClick={() => onCreate(g.id)}><Plus />Start a song</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
