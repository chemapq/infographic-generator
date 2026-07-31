import { env } from '../../config/env.js';
import { anthropic, usageFromResponse, type CallUsage, type JobConversation } from './client.js';

/**
 * Generación / refinado de HTML en streaming (el HTML puede ser largo).
 * `instruction` ya viene construida (generar, refinar o iteración del usuario);
 * los eventos de texto alimentan el progreso de la UI vía onProgress.
 */
export async function generateHtml(
  convo: JobConversation,
  instruction: string,
  onProgress?: (charsSoFar: number) => void,
): Promise<{ html: string; usage: CallUsage }> {
  convo.pushUser([{ type: 'text', text: instruction }]);

  const stream = anthropic.messages.stream({
    model: env.anthropicModel,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    system: convo.system,
    messages: convo.buildMessages(),
    output_config: { effort: 'high' },
  });

  let chars = 0;
  stream.on('text', (delta) => {
    chars += delta.length;
    onProgress?.(chars);
  });

  const message = await stream.finalMessage();
  convo.pushAssistant(message.content);

  const text = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return { html: extractHtml(text), usage: usageFromResponse(message.usage) };
}

/** Extrae el documento HTML aunque el modelo lo envuelva en vallas de código. */
export function extractHtml(text: string): string {
  let html = text.trim();
  const fence = html.match(/^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) html = fence[1].trim();
  const docStart = html.search(/<!doctype html/i);
  if (docStart > 0) html = html.slice(docStart);
  const docEnd = html.lastIndexOf('</html>');
  if (docEnd >= 0) html = html.slice(0, docEnd + '</html>'.length);
  return html;
}
