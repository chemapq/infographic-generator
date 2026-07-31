import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '../../config/env.js';
import { anthropic, usageFromResponse, type CallUsage, type JobConversation } from './client.js';
import { compareInstruction } from './prompts.js';
import { VerdictSchema, type Verdict } from './schemas.js';

/**
 * Juicio de Claude sobre una pasada: recibe la captura del render y el
 * heatmap de diferencias (el original ya está al principio de la conversación)
 * y devuelve un veredicto estructurado.
 */
export async function compareRender(
  convo: JobConversation,
  renderBase64: string,
  diffBase64: string,
  pass: number,
  score: number,
  previousScore: number | null,
): Promise<{ verdict: Verdict; usage: CallUsage }> {
  convo.pushUser([
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: renderBase64 },
    },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: diffBase64 },
    },
    { type: 'text', text: compareInstruction(pass, score, previousScore) },
  ]);

  const response = await anthropic.messages.parse({
    model: env.anthropicModel,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: convo.system,
    messages: convo.buildMessages(),
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(VerdictSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error('La comparación no devolvió un veredicto válido (parsed_output vacío).');
  }
  convo.pushAssistant(response.content);
  return { verdict: response.parsed_output, usage: usageFromResponse(response.usage) };
}
