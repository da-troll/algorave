import type { OffsetEntry, SongMeta } from "./compile-core.ts";

export type EvalRequest = {
  code: string;
  probes: Record<string, string>;
  parts: string[];
  offsets: OffsetEntry[];
  meta: SongMeta;
};

export type PartStats = {
  part: string;
  error?: string;
  eventsPerCycle?: { min: number; avg: number; max: number };
  sounds?: string[];
  noteRange?: string;
  pitchClasses?: string[];
};

export type SectionStats = { name: string; bars: number; startBar: number; eventsPerCycle: number };

export type EvalResult =
  | {
      ok: true;
      cyclesAnalysed: number;
      arranged: boolean;
      totalEvents: number;
      tempo: { songJson: number; code: number | null; calls: number };
      key: { key: string; scale: string; notes: string[] };
      parts: PartStats[];
      outOfKey: Record<string, Record<string, number>>;
      unknownSounds: Record<string, string[]>;
      drumGrids: Array<{ name: string; bar: number; rows: Record<string, string> }>;
      sections: SectionStats[];
      sectionsDeclared: Array<{ name: string; bars: number }>;
      /** every arranged section, including those past the 64-bar analysis window */
      arrangedSections: Array<{ name: string; bars: number }>;
      browserOnly: string[];
      tempoCalls: Array<{ fn: string; value: number }>;
    }
  | {
      ok: false;
      error: string;
      compiledLine?: number;
      tempoCalls: Array<{ fn: string; value: number }>;
      browserOnly: string[];
    };

/** What strudel_check returns, after mapping compiled lines back to files. */
export type CheckReport = {
  ok: boolean;
  /** problems the agent must fix or justify before ending the turn */
  problems: string[];
  error?: { message: string; file?: string; line?: number };
  result?: EvalResult;
  text: string;
};
