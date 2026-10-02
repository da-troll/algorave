import { createGatewayClient } from "@agent-gateway/sdk";

/** Same origin, under whatever prefix the edge serves us at (base './'). */
export const basePath = location.pathname.replace(/[^/]*$/, "");
export const client = createGatewayClient({ baseUrl: basePath.replace(/\/$/, "") });
export const api = client.req;

export type SongSummary = { slug: string; title: string; genre: string | null; bpm?: number; key?: string; scale?: string; branch: string; lastChange: string; lastSessionId: string | null; progress: string[] };
export type SongDetail = {
  song: SongSummary & { progress: string[] };
  meta: { title: string; bpm: number; key: string; scale: string; genre?: string; sections?: Array<{ name: string; bars: number }> };
  parts: Record<string, string>; arrange: string; branch: string; head: string; branches: string[]; writerSession: string | null; turnRunning: boolean;
};
export type Compiled = { code: string; commit: string; parts: string[]; meta: SongDetail["meta"] };
export type Commit = { sha: string; author: string; date: string; subject: string; files: string[]; check: { ok: boolean; summary: string } | null };
export type Genre = { id: string; name: string; bpm_range: [number, number]; key_tendency: string; signature: string[]; listen_for: string; artists_reference: string[]; starter: { bpm: number; key: string; scale: string; sections: Array<{ name: string; bars: number }>; parts: Record<string, string>; arrange: string } };
export type Lesson = { id: string; order: number; title: string; goal: string; explain: string; reference_snippet: string; try_prompt: string };

export const PROJECT_REPO = "https://github.com/da-troll/algorave-room";
