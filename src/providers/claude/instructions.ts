import type { ProviderInstructionsDelivery } from '../instructions-delivery.js';
import { claudeProviderPolicy } from './definition.js';

/**
 * The bundled Claude bridge spreads `_meta.systemPrompt` objects onto the Claude Agent SDK
 * session options, where `append` keeps the Claude Code preset and adds the caller text.
 * The channel is gated on the exact bridge version, never on the installed CLI version.
 */
export const claudeInstructionsDelivery: ProviderInstructionsDelivery = (request) =>
  request.definitionVersion === claudeProviderPolicy.version
    ? {
        channel: 'acp:session/new._meta.systemPrompt.append',
        mode: 'native_append',
        sessionMeta: { systemPrompt: { append: request.instructions } },
      }
    : undefined;
