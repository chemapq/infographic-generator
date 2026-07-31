import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '../../config/env.js';
import { anthropic, usageFromResponse, type CallUsage, type JobConversation } from './client.js';
import { ANALYZE_INSTRUCTION } from './prompts.js';
import { SpecSchema, type Spec } from './schemas.js';

/**
 * Pasada 0 — análisis. Recibe la imagen original y devuelve la
 * especificación estructurada (salida estructurada con schema Zod).
 */
export async function analyzeImage(
  convo: JobConversation,
  imageBase64: string,
): Promise<{ spec: Spec; usage: CallUsage }> {
  convo.pushUser([
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
    },
    { type: 'text', text: ANALYZE_INSTRUCTION },
  ]);

  const response = await anthropic.messages.parse({
    model: env.anthropicModel,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: convo.system,
    messages: convo.buildMessages(),
    output_config: {
      effort: 'high',
      format: zodOutputFormat(SpecSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error('El análisis no devolvió una especificación válida (parsed_output vacío).');
  }
  convo.pushAssistant(response.content);
  return { spec: response.parsed_output, usage: usageFromResponse(response.usage) };
}
