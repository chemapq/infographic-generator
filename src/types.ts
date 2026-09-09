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

export type PassKind = 'generate' | 'refine' | 'iterate' | 'manual';

/** Un cambio de texto aplicado a mano, sin pasar por Claude. */
export interface TextEdit {
  /** cssPath del elemento que contiene el nodo de texto. */
  selector: string;
  /** Índice del nodo de texto entre los childNodes de ese elemento. */
  nodeIndex: number;
  /** Texto tal como estaba al abrir el editor: verificación optimista antes de aplicar. */
  before: string;
  /** Texto nuevo. Puede ser vacío (borra el texto), nunca se borra el nodo. */
  after: string;
}

export interface PassRecord {
  /** Número de pasada, 1-based. Las iteraciones del usuario continúan la serie. */
  n: number;
  kind: PassKind;
  /** Prompt del usuario cuando kind === 'iterate'. */
  userPrompt?: string;
  /** Elemento señalado en el editor visual, si la iteración iba dirigida a uno. */
  targetLabel?: string;
  /** Cambios de texto aplicados a mano cuando kind === 'manual'. */
  edits?: TextEdit[];
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
  /** Dueño del job (cookie `ig_owner`, o el nombre de la clave para jobs de la API v1). `null` en jobs anteriores a la galería. */
  ownerId: string | null;
  /** Título editable en la galería. Si falta, se usa `originalName` sin extensión. */
  title?: string;
  /** Clave `Idempotency-Key` (API v1) con la que se creó el job. */
  idempotencyKey?: string;
  /** Referencia opaca del cliente de la API v1, p. ej. `moodle:<wwwroothash>:<rowid>`. */
  externalRef?: string;
}

/** Fila ligera para la galería: sin `spec` ni `passes`, cabe de sobra en una lista. */
export interface JobSummary {
  id: string;
  createdAt: string;
  /** mtime de job.json: ordena por "última actividad", no solo por creación. */
  updatedAt: string;
  title: string;
  originalName: string;
  status: JobStatus;
  width: number;
  height: number;
  passCount: number;
  bestScore: number | null;
  hasResult: boolean;
  ownerId: string | null;
}

export interface GalleryQuery {
  limit: number;
  cursor?: string;
  q?: string;
  status?: JobStatus | 'all';
  sort?: 'recent' | 'score';
  ownerId?: string | null;
  /**
   * Filtra por `ownerId` sea cual sea `GALLERY_SCOPE`, y sin colar los jobs
   * sin dueño. Lo activan las sesiones del iframe de Moodle, donde el dueño
   * es un usuario real y no una cookie de conveniencia.
   */
  strictOwner?: boolean;
}

export interface GalleryPage {
  items: JobSummary[];
  nextCursor: string | null;
  total: number;
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
