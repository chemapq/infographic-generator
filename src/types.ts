import type { CallUsage } from './services/claude/client.js';
import type { Spec, Verdict } from './services/claude/schemas.js';

export type JobStatus =
  | 'queued'
  | 'analyzing'
  | 'generating'
  | 'rendering'
  | 'comparing'
  | 'refining'
  | 'iterating'
  | 'done'
  | 'failed';

export type PassKind = 'generate' | 'refine' | 'iterate';

export interface PassRecord {
  /** Número de pasada, 1-based. Las iteraciones del usuario continúan la serie. */
  n: number;
  kind: PassKind;
  /** Prompt del usuario cuando kind === 'iterate'. */
  userPrompt?: string;
  score: number | null;
  verdict: Verdict | null;
  usage: CallUsage;
  htmlFile: string;
  screenshotFile: string;
  diffFile: string;
  createdAt: string;
}

export interface JobOptions {
  maxPasses: number;
  notes?: string;
}

export interface JobRecord {
  id: string;
  createdAt: string;
  status: JobStatus;
  options: JobOptions;
  originalName: string;
  width: number;
  height: number;
  spec: Spec | null;
  passes: PassRecord[];
  /** Pasada con mejor score (a la que se revierte si el bucle diverge). */
  bestPass: number | null;
  totalUsage: CallUsage;
  stopReason: string | null;
  error: string | null;
}

export interface JobEvent {
  type:
    | 'status'
    | 'analyze:done'
    | 'pass:start'
    | 'generate:progress'
    | 'render:done'
    | 'compare:done'
    | 'pass:done'
    | 'job:done'
    | 'job:failed';
  data: Record<string, unknown>;
  at: string;
}
