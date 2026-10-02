// The Strudel engine: one StrudelMirror (the class <strudel-editor> wraps in
// @strudel/repl 1.3.0) mounted in the REPL panel. We do not import @strudel/repl
// itself: its dist bundles a second copy of @strudel/core. prebake() below
// mirrors @strudel/repl/prebake.mjs (read 2026-10-02), with Hydra served locally.
import { StrudelMirror } from "@strudel/codemirror";
import * as core from "@strudel/core";
import { transpiler } from "@strudel/transpiler";
import { aliasBank, getAudioContext, initAudioOnFirstClick, registerSynthSounds, registerZZFXSounds, samples, webaudioOutput, getSuperdoughAudioController, renderPatternAudio } from "@strudel/webaudio";
import { setTheme as setDrawTheme } from "@strudel/draw";
import { EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { tokenColor, watchTheme } from "@agent-gateway/ui-theme";
import { tokenEditorTheme } from "./cmTheme.ts";

const ds = "https://raw.githubusercontent.com/felixroos/dough-samples/main";
const ts = "https://raw.githubusercontent.com/todepond/samples/main";
const tc = "https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main";

async function prebake() {
  const modules = core.evalScope(
    core,
    import("@strudel/draw"),
    import("@strudel/mini"),
    import("@strudel/tonal"),
    import("@strudel/webaudio"),
    import("@strudel/codemirror"),
    import("@strudel/hydra"),
    import("@strudel/soundfonts"),
  );
  await Promise.all([
    modules,
    registerSynthSounds(),
    registerZZFXSounds(),
    import("@strudel/soundfonts").then(({ registerSoundfonts }) => registerSoundfonts()),
    samples(`${ds}/tidal-drum-machines.json`),
    samples(`${ds}/piano.json`),
    samples(`${ds}/Dirt-Samples.json`),
    samples(`${ds}/vcsl.json`),
    samples(`${ds}/mridangam.json`),
    samples(`${tc}/strudel.json`),
  ]);
  aliasBank(`${ts}/tidal-drum-machines-alias.json`);
  // .piano() as in the REPL's prebake
  (core.Pattern.prototype as unknown as Record<string, unknown>).piano = function (this: { s: (x: string) => unknown }) { return this.s("piano"); };
}

/**
 * @strudel/codemirror's activateTheme() injects `:root { --background: ... !important;
 * --foreground: ... !important; ... }` and adds a `.dark` class to <html>. Those names
 * collide with the design tokens (--foreground resolved to white in Latte). The editor is
 * themed from tokens (cmTheme.ts) instead, so the injected block is emptied and the class
 * removed; a MutationObserver keeps it that way if Strudel re-activates a theme.
 */
function neutralizeStrudelTheme() {
  const clean = () => {
    for (const st of Array.from(document.head.querySelectorAll("style"))) {
      if (st.textContent && /:root\s*\{[^}]*--lineHighlight/.test(st.textContent)) st.textContent = "";
    }
    document.documentElement.classList.remove("dark");
  };
  clean();
  if (!(globalThis as { __arThemeGuard?: boolean }).__arThemeGuard) {
    (globalThis as { __arThemeGuard?: boolean }).__arThemeGuard = true;
    new MutationObserver(clean).observe(document.head, { childList: true, subtree: true, characterData: true });
    new MutationObserver(() => { if (document.documentElement.classList.contains("dark")) document.documentElement.classList.remove("dark"); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
}

export type ApplyMode = "bar" | "4bars" | "now";
export type EngineState = {
  ready: boolean;
  playing: boolean;
  evalError: string | null;
  schedulerError: string | null;
  pending: { label: string; at: number } | null;
  scratch: boolean;
  cycle: number;
};
type Listener = (s: EngineState) => void;

class Engine {
  mirror: InstanceType<typeof StrudelMirror> | null = null;
  state: EngineState = { ready: false, playing: false, evalError: null, schedulerError: null, pending: null, scratch: false, cycle: 0 };
  private ls = new Set<Listener>();
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAppliedCode = "";
  onRuntime: (r: { ok: boolean; error?: string }) => void = () => {};
  private tick: ReturnType<typeof setInterval> | null = null;

  on(l: Listener) { this.ls.add(l); l(this.state); return () => { this.ls.delete(l); }; }
  private set(p: Partial<EngineState>) { this.state = { ...this.state, ...p }; for (const l of this.ls) l(this.state); }

  mount(root: HTMLElement, canvas: HTMLCanvasElement) {
    if (this.mirror) {
      // re-parent the existing editor when the panel remounts
      root.appendChild(this.mirror.root.firstChild ?? document.createElement("div"));
      this.mirror.root = root;
      this.mirror.drawContext = canvas.getContext("2d");
      return;
    }
    initAudioOnFirstClick();
    const ctx = canvas.getContext("2d");
    this.mirror = new StrudelMirror({
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      root,
      initialCode: "// loading the song",
      pattern: core.silence,
      drawTime: [-2, 2],
      drawContext: ctx,
      prebake,
      bgFill: false,
      solo: true,
      onUpdateState: (st: { started: boolean; evalError?: unknown; schedulerError?: unknown }) => {
        const evalError = st.evalError ? String((st.evalError as Error).message ?? st.evalError) : null;
        const schedulerError = st.schedulerError ? String((st.schedulerError as Error).message ?? st.schedulerError) : null;
        if (evalError !== this.state.evalError && evalError) this.onRuntime({ ok: false, error: evalError });
        if (schedulerError !== this.state.schedulerError && schedulerError) this.onRuntime({ ok: false, error: `scheduler: ${schedulerError}` });
        this.set({ playing: !!st.started, evalError, schedulerError });
      },
    });
    neutralizeStrudelTheme();
    const view = this.mirror.editor as EditorView;
    view.dispatch({ effects: StateEffect.appendConfig.of(tokenEditorTheme()) });
    this.syncDrawTheme();
    watchTheme(() => this.syncDrawTheme());
    this.mirror.prebaked.then(() => { neutralizeStrudelTheme(); this.set({ ready: true }); });
    this.tick = setInterval(() => {
      const s = this.scheduler();
      if (s?.started) this.set({ cycle: s.now() });
    }, 250);
  }

  private syncDrawTheme() {
    setDrawTheme({ background: "transparent", foreground: tokenColor("--accent"), caret: tokenColor("--text-primary"), selection: tokenColor("--selection-bg"), lineHighlight: "transparent", gutterBackground: "transparent", gutterForeground: tokenColor("--text-muted") });
  }

  scheduler(): { now: () => number; cps: number; started: boolean } | null {
    return (this.mirror?.repl as { scheduler?: { now: () => number; cps: number; started: boolean } } | undefined)?.scheduler ?? null;
  }

  get code(): string { return this.mirror?.code ?? ""; }

  setCode(code: string, scratch = false) {
    this.mirror?.setCode(code);
    this.set({ scratch });
  }

  /** Validate in the browser first: a transpile failure never replaces what plays. */
  check(code: string): string | null {
    try { transpiler(code, {}); return null; } catch (e) { return String((e as Error).message); }
  }

  async evaluate(): Promise<boolean> {
    if (!this.mirror) return false;
    await this.mirror.evaluate();
    const ok = !this.state.evalError;
    if (ok) { this.lastAppliedCode = this.mirror.code; this.onRuntime({ ok: true }); }
    return ok;
  }

  async play() { await this.evaluate(); }
  stop() { this.mirror?.stop(); this.set({ playing: false }); }

  /**
   * Apply new code on the next cycle boundary (1 cycle = 1 bar). If nothing is
   * playing, load it immediately without starting playback.
   */
  apply(code: string, label: string, mode: ApplyMode): string | null {
    const err = this.check(code);
    if (err) { this.onRuntime({ ok: false, error: `transpile: ${err}` }); return err; }
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    const s = this.scheduler();
    if (!s?.started || mode === "now") {
      this.setCode(code);
      this.set({ pending: null });
      if (s?.started) void this.evaluate();
      return null;
    }
    const now = s.now();
    const step = mode === "4bars" ? 4 : 1;
    const target = Math.floor(now / step + 1e-6) * step + step;
    const ms = Math.max(0, ((target - now) / s.cps) * 1000 - 90); // evaluate just ahead of the boundary
    this.set({ pending: { label, at: target } });
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.setCode(code);
      void this.evaluate().finally(() => this.set({ pending: null }));
    }, ms);
    return null;
  }

  cancelPending() { if (this.pendingTimer) clearTimeout(this.pendingTimer); this.pendingTimer = null; this.set({ pending: null }); }

  /** Record the live output: MediaStreamDestination tapped off superdough's destination gain. */
  recorderTap(): MediaStream {
    const ac = getAudioContext() as AudioContext;
    const dest = ac.createMediaStreamDestination();
    const out = (getSuperdoughAudioController() as { output: { destinationGain: AudioNode } }).output.destinationGain;
    out.connect(dest);
    return dest.stream;
  }

  /** Offline render (@strudel/webaudio renderPatternAudio, PR 1674): downloads a WAV. Stops live playback. */
  async renderOffline(bars: number, name: string) {
    const s = this.scheduler();
    this.stop();
    const { evaluate } = await import("@strudel/transpiler");
    const r = (await evaluate(this.code)) as { pattern: unknown };
    await renderPatternAudio(r.pattern, s?.cps ?? 0.5, 0, bars, 44100, 128, false, name);
  }
}

export const engine = new Engine();
