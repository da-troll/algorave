// git via argument arrays only (never shell strings), bounded output and time,
// no external diff/textconv helpers, no user/system config.
import { execFile } from "node:child_process";

const GIT_ENV = { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };

export function git(cwd: string, args: string[], opts: { maxBuffer?: number; author?: { name: string; email: string } } = {}): Promise<string> {
  const env: Record<string, string> = { ...GIT_ENV };
  if (opts.author) {
    env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = opts.author.name;
    env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = opts.author.email;
  }
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, "-c", "core.quotepath=off", "-c", "diff.external=", ...args], { env, timeout: 10_000, maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]}: ${(stderr || err.message).trim().split("\n").pop()}`));
      else resolve(stdout);
    });
  });
}

export const AGENT = { name: "Algorave Agent", email: "agent@algorave.local" };
export const DANIEL = { name: "Daniel", email: "daniel@algorave.local" };

export async function head(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}
export async function branch(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}
export async function isDirty(cwd: string): Promise<boolean> {
  return (await git(cwd, ["status", "--porcelain=v1", "-z"])).length > 0;
}
