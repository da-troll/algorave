import { useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@trollefsen-labs/components-react";
import { Play, Plus, Map, Disc3 } from "lucide-react";
import { api, type Genre, type SongSummary } from "./api.ts";
import { Header } from "./Header.tsx";

export function Home({ navigate }: { navigate: (to: string) => void }) {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<SongSummary[]>("GET", "/api/songs").then(setSongs).catch((e) => { toast.error((e as Error).message); setSongs([]); });
    void api<Genre[]>("GET", "/api/content/genres").then(setGenres).catch(() => {});
  }, []);
  const create = async (opts: { genre?: string; path?: boolean }) => {
    setBusy(true);
    try {
      const s = await api<{ slug: string }>("POST", "/api/songs", { title: title || undefined, genre: opts.genre || undefined });
      navigate(`/song/${s.slug}${opts.path ? "?tab=path" : ""}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const last = songs?.[0];
  return (
    <div className="flex h-full flex-col">
      <Header title="Songs" onHome={() => navigate("/")} />
      <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <Card className="py-4">
            <CardHeader className="px-4"><CardTitle className="text-base">Continue my last jam</CardTitle></CardHeader>
            <CardContent className="px-4 text-sm text-[var(--text-secondary)]">
              {songs === null ? <Skeleton className="h-10" /> : last ? (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium text-[var(--text-primary)]">{last.title}</p><p className="text-xs text-[var(--text-muted)]">{last.genre ?? "no genre"} · {last.bpm} bpm · {last.branch}</p></div>
                  <Button onClick={() => navigate(`/song/${last.slug}`)} data-testid="continue"><Play />Continue</Button>
                </div>
              ) : <p>No songs yet. Start one.</p>}
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardHeader className="px-4"><CardTitle className="text-base">New song</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
              <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Song title" />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void create({})} data-testid="new-blank"><Plus />Blank</Button>
                <select aria-label="Genre" value={genre} onChange={(e) => setGenre(e.target.value)} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 text-sm text-[var(--text-primary)]">
                  <option value="">Pick a genre…</option>
                  {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <Button variant="outline" disabled={busy || !genre} onClick={() => void create({ genre })} data-testid="new-genre"><Disc3 />From genre</Button>
                <Button variant="outline" disabled={busy} onClick={() => void create({ path: true })}><Map />Guided path</Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <h2 className="mt-5 mb-2 text-sm font-semibold text-[var(--heading-color)]">Songs</h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Genre</TableHead><TableHead>BPM</TableHead><TableHead className="hidden sm:table-cell">Branch</TableHead><TableHead>Last change</TableHead></TableRow></TableHeader>
            <TableBody>
              {(songs ?? []).map((s) => (
                <TableRow key={s.slug} className="cursor-pointer" onClick={() => navigate(`/song/${s.slug}`)} data-song={s.slug}>
                  <TableCell className="font-medium text-[var(--text-primary)]">{s.title}</TableCell>
                  <TableCell className="text-[var(--text-secondary)]">{s.genre ?? "-"}</TableCell>
                  <TableCell className="font-mono text-[var(--text-secondary)]">{s.bpm}</TableCell>
                  <TableCell className="hidden font-mono text-xs text-[var(--text-muted)] sm:table-cell">{s.branch}</TableCell>
                  <TableCell className="text-xs text-[var(--text-muted)]">{new Date(s.lastChange).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</TableCell>
                </TableRow>
              ))}
              {songs?.length === 0 && <TableRow><TableCell colSpan={5} className="text-[var(--text-muted)]">Nothing here yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}
