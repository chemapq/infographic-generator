/**
 * Edición sin estado para `POST /api/v1/edit`: HTML + prompt entran, HTML
 * sale. Sin job, sin `output/`, sin Chromium, sin pixelmatch, sin cola en
 * serie — una única llamada a Claude. Es lo que hace posible el editor del
 * plugin de Moodle sin pasar por el pipeline. Reutiliza exactamente el mismo
 * patrón que ya usa `runIteration()` en el orquestador (HTML actual +
 * `iterateInstruction()` pura), solo que sin persistir nada en disco.
 * Ver PLAN_MOODLE.md §5.3.
 */
import { JobConversation, type CallUsage } from './claude/client.js';
import { generateHtml } from './claude/generate.js';
import { iterateInstruction, type IterateTarget } from './claude/prompts.js';
import { sanitizeHtml } from './validator.js';

export interface EditHtmlOptions {
  html: string;
  prompt: string;
  target?: IterateTarget;
  /** PNG del original, en base64, si se dispone de él: ancla la edición al referente visual. */
  originalImageBase64?: string;
}

export interface EditHtmlResult {
  html: string;
  usage: CallUsage;
  warnings: string[];
}

export async function editHtml(options: EditHtmlOptions): Promise<EditHtmlResult> {
  // El HTML entra y sale por sanitizeHtml(): en el flujo manual del plugin el
  // HTML de entrada lo escribe el cliente, y un cliente es siempre hostil.
  const input = sanitizeHtml(options.html);

  const convo = new JobConversation();
  if (options.originalImageBase64) {
    // Primer (y único) mensaje de usuario antes de la instrucción: buildMessages()
    // marca su último bloque —la imagen— como breakpoint de caché ephemeral,
    // así ediciones sucesivas sobre el mismo activo leen la imagen de caché.
    convo.pushUser([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: options.originalImageBase64 },
      },
      { type: 'text', text: 'Esta es la infografía original de referencia.' },
    ]);
  }

  const instruction =
    `HTML actual sobre el que aplicar los cambios:\n\n${input.html}\n\n` +
    iterateInstruction(options.prompt, options.target);

  const generation = await generateHtml(convo, instruction);
  const output = sanitizeHtml(generation.html);

  return {
    html: output.html,
    usage: generation.usage,
    warnings: [...input.warnings, ...output.warnings],
  };
}
