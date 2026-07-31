import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompts.js';

// Cliente único. Sin apiKey explícita: el SDK resuelve credenciales del
// entorno (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN o perfil de `ant auth login`).
export const anthropic = new Anthropic();

/** Uso (tokens) de una llamada a la API. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export function usageFromResponse(usage: Anthropic.Usage): CallUsage {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens };
}

export function addUsage(a: CallUsage, b: CallUsage): CallUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export const emptyUsage = (): CallUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
});

/** Causa legible para el estado `failed` del job (cadena tipada del SDK). */
export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Credenciales de Anthropic inválidas o ausentes. Define ANTHROPIC_API_KEY en .env o inicia sesión con `ant auth login`.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Límite de peticiones de la API alcanzado (429) tras varios reintentos. Espera un momento y reintenta.';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Petición inválida a la API (400): ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'No se pudo conectar con la API de Anthropic. Revisa la conexión de red.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Error de la API de Anthropic (${String(error.status)}): ${error.message}`;
  }
  if (error instanceof Error) {
    if (error.message.includes('Could not resolve authentication method')) {
      return 'No hay credenciales de Anthropic. Copia .env.example a .env y define ANTHROPIC_API_KEY (o inicia sesión con `ant auth login`).';
    }
    return error.message;
  }
  return String(error);
}

/**
 * Conversación multi-turno de un job con caché de prompt.
 *
 * El historial se guarda SIN marcadores de caché; en cada petición se añaden
 * como máximo 3 breakpoints `cache_control: ephemeral`:
 *   1. el bloque de system (prefijo global estable),
 *   2. el último bloque del primer mensaje de usuario (imagen original),
 *   3. el último bloque del último mensaje (breakpoint móvil).
 * Así cada pasada solo paga en frío la captura nueva y el veredicto; el
 * prefijo se lee de caché a ~0,1x. Verificable en usage.cache_read_input_tokens.
 */
export class JobConversation {
  private readonly history: Anthropic.MessageParam[] = [];

  get system(): Anthropic.TextBlockParam[] {
    return [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }

  pushUser(content: Anthropic.ContentBlockParam[]): void {
    this.history.push({ role: 'user', content });
  }

  pushAssistant(content: Anthropic.MessageParam['content']): void {
    this.history.push({ role: 'assistant', content });
  }

  get length(): number {
    return this.history.length;
  }

  /** Mensajes para la petición, con los breakpoints de caché colocados. */
  buildMessages(): Anthropic.MessageParam[] {
    const cloned: Anthropic.MessageParam[] = structuredClone(this.history);
    const markable = new Set<number>();
    const firstUser = cloned.findIndex((m) => m.role === 'user');
    if (firstUser >= 0) markable.add(firstUser);
    if (cloned.length > 0) markable.add(cloned.length - 1);
    for (const index of markable) {
      const message = cloned[index];
      if (message.role !== 'user' || !Array.isArray(message.content)) continue;
      const last = message.content[message.content.length - 1];
      if (last && (last.type === 'text' || last.type === 'image')) {
        last.cache_control = { type: 'ephemeral' };
      }
    }
    return cloned;
  }
}
