// @agent-gateway/ui-theme: the ONLY package that reads tokens from JavaScript.
// AppTheme is the single theme-state owner (one ThemeRoot, one useTheme).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeRoot, useTheme, type CatppuccinAccent, type CatppuccinFlavor } from "@trollefsen-labs/components-react";
import { flavors } from "@catppuccin/palette";

export type ThemeMode = "dark" | "light";
type Ctx = { theme: ThemeMode; toggle: () => void; setTheme: (t: ThemeMode) => void; flavor: CatppuccinFlavor; setFlavor: (f: CatppuccinFlavor) => void; accent: CatppuccinAccent; setAccent: (a: CatppuccinAccent) => void };
const ThemeCtx = createContext<Ctx | null>(null);

function stored<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(key); if (v && (ok as readonly string[]).includes(v)) return v as T; } catch { /* private mode */ }
  return fallback;
}
const FLAVORS = ["mocha", "macchiato", "frappe"] as const;
const ACCENTS = ["rosewater", "flamingo", "pink", "mauve", "red", "maroon", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender"] as const;

/** One owner: seeds from the pre-paint attribute, persists theme, flavor and accent. */
export function AppTheme({ children, flavor: defFlavor = "mocha", accent: defAccent = "mauve", initial = "dark" }: { children: ReactNode; flavor?: CatppuccinFlavor; accent?: CatppuccinAccent; initial?: ThemeMode }) {
  const seed = (typeof document !== "undefined" && (document.documentElement.getAttribute("data-theme") as ThemeMode | null)) || initial;
  const { theme, toggle, setTheme } = useTheme({ storageKey: "app-theme", defaultTheme: seed });
  const [flavor, setFlavorState] = useState<CatppuccinFlavor>(() => stored("app-flavor", FLAVORS, defFlavor));
  const [accent, setAccentState] = useState<CatppuccinAccent>(() => stored("app-accent", ACCENTS, defAccent));
  const setFlavor = useCallback((f: CatppuccinFlavor) => { setFlavorState(f); try { localStorage.setItem("app-flavor", f); } catch { /* ignore */ } }, []);
  const setAccent = useCallback((a: CatppuccinAccent) => { setAccentState(a); try { localStorage.setItem("app-accent", a); } catch { /* ignore */ } }, []);
  const v = useMemo(() => ({ theme, toggle, setTheme, flavor, setFlavor, accent, setAccent }), [theme, toggle, setTheme, flavor, setFlavor, accent, setAccent]);
  return (
    <ThemeCtx.Provider value={v}>
      <ThemeRoot palette="catppuccin" theme={theme} flavor={flavor} accent={accent}>{children}</ThemeRoot>
    </ThemeCtx.Provider>
  );
}

export function useAppTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useAppTheme outside <AppTheme>");
  return c;
}

/** Resolved value of a CSS custom property on <html>. */
export function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name.startsWith("--") ? name : `--${name}`).trim();
}

/** Calls back when palette/theme/flavor/accent attributes change. */
export function watchTheme(cb: () => void): () => void {
  const mo = new MutationObserver(() => cb());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette", "data-theme", "data-flavor", "data-accent"] });
  return () => mo.disconnect();
}

export function useThemeVersion(): number {
  const [n, setN] = useState(0);
  useEffect(() => watchTheme(() => setN((x) => x + 1)), []);
  return n;
}

/** xterm ITheme from tokens (surfaces, text, accent) + Catppuccin ANSI for the active flavor. */
export function terminalTheme() {
  const el = document.documentElement;
  const light = el.getAttribute("data-theme") === "light";
  const fl = (light ? "latte" : (el.getAttribute("data-flavor") || "mocha")) as keyof typeof flavors;
  const c = flavors[fl].colors;
  return {
    background: tokenColor("--surface-sunken"),
    foreground: tokenColor("--text-primary"),
    cursor: tokenColor("--accent"),
    cursorAccent: tokenColor("--surface-sunken"),
    selectionBackground: tokenColor("--selection-bg") || c.surface2.hex,
    black: light ? c.subtext1.hex : c.surface1.hex, red: c.red.hex, green: c.green.hex, yellow: c.yellow.hex,
    blue: c.blue.hex, magenta: c.pink.hex, cyan: c.teal.hex, white: light ? c.surface2.hex : c.subtext1.hex,
    brightBlack: light ? c.subtext0.hex : c.surface2.hex, brightRed: c.red.hex, brightGreen: c.green.hex, brightYellow: c.yellow.hex,
    brightBlue: c.blue.hex, brightMagenta: c.pink.hex, brightCyan: c.teal.hex, brightWhite: light ? c.surface1.hex : c.subtext0.hex,
  };
}

export type Tone = "info" | "success" | "warning" | "error" | "neutral";
/** GW-PLAN 6.6 status mapping, used everywhere a state is shown. */
export function tone(entity: "session" | "turn" | "approval" | "connection" | "check" | "lock", value: string): Tone {
  const m: Record<string, Record<string, Tone>> = {
    session: { starting: "info", running: "info", idle: "neutral", stopped: "neutral", failed: "error", interrupted: "warning" },
    turn: { completed: "success", failed: "error", interrupted: "warning", running: "info", pending: "info" },
    approval: { allow: "success", deny: "error", read: "neutral", low: "info", elevated: "warning", critical: "error" },
    connection: { live: "success", reconnecting: "warning", offline: "error", connecting: "warning" },
    check: { ok: "success", problems: "warning", failed: "error" },
    lock: { held: "warning" },
  };
  return m[entity]?.[value] ?? "neutral";
}
/**
 * Badge classes per tone. rules.md says -bg, -border and -fg, but in Latte the -fg on -bg
 * pairs measure 4.2-4.3:1 at badge size (axe, 2026-10-02), under 4.5. So the fill is the
 * opaque surface and the tone is carried by -border and -fg (both pass). Reported upstream.
 */
export function toneClasses(t: Tone): string {
  switch (t) {
    case "info": return "border-[var(--info-border)] bg-[var(--surface-raised)] text-[var(--info-fg)]";
    case "success": return "border-[var(--success-border)] bg-[var(--surface-raised)] text-[var(--success-fg)]";
    case "warning": return "border-[var(--warning-border)] bg-[var(--surface-raised)] text-[var(--warning-fg)]";
    case "error": return "border-[var(--error-border)] bg-[var(--surface-raised)] text-[var(--error-fg)]";
    default: return "border-[var(--border)] bg-[var(--surface-hover)] text-[var(--text-secondary)]";
  }
}
export function toneText(t: Tone): string {
  return t === "neutral" ? "text-[var(--text-muted)]" : `text-[var(--${t}-fg)]`;
}
/** Diff line classes (beyond-css diff tokens, mapped onto status tokens). */
export function diffClasses(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-[var(--text-muted)]";
  if (line.startsWith("+")) return "bg-[var(--success-bg)] text-[var(--success-fg)]";
  if (line.startsWith("-")) return "bg-[var(--error-bg)] text-[var(--error-fg)]";
  if (line.startsWith("@@")) return "text-[var(--info-fg)]";
  return "text-[var(--text-secondary)]";
}
export const FLAVOR_OPTIONS = FLAVORS;
export const ACCENT_OPTIONS = ACCENTS;
