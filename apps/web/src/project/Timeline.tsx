// Timeline: git log of the song. Compare (A/B in the REPL), branch from here, rewind.
import { useEffect, useState } from "react";
import { Button, Input, cn, toast } from "@trollefsen-labs/components-react";
import { GitBranch, History, Columns2, Bot, User } from "lucide-react";
import { DiffView, StatusBadge } from "@agent-gateway/ui-agent-shell";
import { api, type Commit, type Compiled, type SongDetail } from "../api.ts";

export function TimelinePanel({ slug, detail, refreshKey, onChanged, onCompare }: { slug: string; detail: SongDetail | null; refreshKey: number; onChanged: () => void; onCompare: (slot: "a" | "b", sha: string, code: string) => void }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState<{ diff: string; check: { ok: boolean; text: string } | null } | null>(null);
  const [branchName, setBranchName] = useState("");
  useEffect(() => { void api<Commit[]>("GET", `/api/songs/${slug}/timeline`).then(setCommits).catch(() => {}); }, [slug, refreshKey]);
  useEffect(() => { if (open) void api<typeof show>("GET", `/api/songs/${slug}/commits/${open}`).then(setShow); else setShow(null); }, [open, slug]);
  const busy = !!detail?.turnRunning;
  const compare = async (slot: "a" | "b", sha: string) => {
    const c = await api<Compiled>("GET", `/api/songs/${slug}/compiled?commit=${sha}`);
    onCompare(slot, sha, c.code);
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); onChanged(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="timeline">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs">
        <GitBranch className="size-3.5 text-[var(--text-muted)]" />
        <select aria-label="Branch" value={detail?.branch ?? ""} disabled={busy} onChange={(e) => void act(() => api("POST", `/api/songs/${slug}/checkout`, { branch: e.target.value }), `Checked out ${e.target.value}`)} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-0.5 font-mono text-xs text-[var(--text-primary)]">
          {(detail?.branches ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-[var(--text-muted)]">{commits.length} {commits.length === 1 ? "commit" : "commits"}</span>
        {busy && <StatusBadge entity="lock" value="held">agent working: branch/rewind wait</StatusBadge>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {commits.map((c, i) => (
          <div key={c.sha} className={cn("border-b border-[var(--border-subtle)] px-2 py-1.5", open === c.sha && "bg-[var(--surface-hover)]")} data-commit={c.sha}>
            <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === c.sha ? null : c.sha)}>
              {c.author === "You" ? <User className="size-3.5 shrink-0 text-[var(--text-muted)]" /> : <Bot className="size-3.5 shrink-0 text-[var(--text-muted)]" />}
              <span className="font-mono text-[11px] text-[var(--text-muted)]">{c.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{c.subject}</span>
              {c.check && <StatusBadge entity="check" value={c.check.ok ? "ok" : "problems"}>{c.check.ok ? "ears ok" : "ears !"}</StatusBadge>}
              {i === 0 && <StatusBadge entity="session" value="running">HEAD</StatusBadge>}
            </button>
            <div className="ml-6 text-[11px] text-[var(--text-muted)]">{c.author} · {new Date(c.date).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · {c.files.join(", ")}</div>
            {open === c.sha && (
              <div className="mt-1.5 ml-6 flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void compare("a", c.sha)}><Columns2 />Load as A</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void compare("b", c.sha)}><Columns2 />Load as B</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy || i === 0} onClick={() => { if (confirm(`Rewind to ${c.sha.slice(0, 7)}? This adds a NEW commit restoring that version; nothing is deleted.`)) void act(() => api("POST", `/api/songs/${slug}/rewind`, { to: c.sha }), "Rewound with a new commit"); }}><History />Rewind here</Button>
                  <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="idea name" className="h-7 w-32 text-xs" aria-label="Branch name" />
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy || !branchName.trim()} onClick={() => void act(() => api("POST", `/api/songs/${slug}/branch`, { from: c.sha, name: branchName }), `Branched idea/${branchName}`)}><GitBranch />Branch from here</Button>
                </div>
                {show?.check && <pre className="whitespace-pre-wrap rounded-md bg-[var(--surface-sunken)] p-1.5 font-mono text-[11px] text-[var(--text-secondary)]">{show.check.text}</pre>}
                {show && <DiffView diff={show.diff || "(no file changes)"} className="max-h-72 rounded-md" />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
