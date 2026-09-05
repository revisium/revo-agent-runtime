import type * as acp from '@agentclientprotocol/sdk';

import type { SessionProtocolUpdate } from '../../../session/model/update.js';
import type { SessionProtocolObserver } from '../../../session/port/session.js';

const toolKind = (kind: acp.ToolKind | null | undefined) => {
  if (kind === 'think' || kind === 'switch_mode' || kind === undefined || kind === null)
    return 'other' as const;
  return kind;
};

const toolStatus = (status: acp.ToolCallStatus | null | undefined) => {
  if (status === 'pending' || status === undefined || status === null) return 'started' as const;
  return status;
};

const planItems = (entries: readonly acp.PlanEntry[]) =>
  entries.map((entry, index) =>
    Object.freeze({ itemId: `item_${index + 1}`, status: entry.status, title: entry.content }),
  );

export const mapAcpSessionUpdate = (
  update: acp.SessionUpdate,
): SessionProtocolUpdate | undefined => {
  if (
    update.sessionUpdate === 'agent_message_chunk' &&
    update.content.type === 'text' &&
    update.content.text.length > 0
  )
    return Object.freeze({ content: update.content.text, type: 'message.delta' });
  if (update.sessionUpdate === 'tool_call')
    return Object.freeze({
      kind: toolKind(update.kind),
      status: toolStatus(update.status),
      title: update.title,
      toolCallId: update.toolCallId,
      type: 'tool',
    });
  if (update.sessionUpdate === 'tool_call_update' && update.title != null)
    return Object.freeze({
      kind: toolKind(update.kind),
      status: toolStatus(update.status),
      title: update.title,
      toolCallId: update.toolCallId,
      type: 'tool',
    });
  if (update.sessionUpdate === 'plan')
    return Object.freeze({ items: Object.freeze(planItems(update.entries)), type: 'plan' });
  return undefined;
};

export const deliverAcpSessionUpdate = async (
  observer: SessionProtocolObserver | undefined,
  update: acp.SessionUpdate,
): Promise<void> => {
  const mapped = mapAcpSessionUpdate(update);
  if (mapped === undefined || observer === undefined) return;
  await observer.update(mapped);
};
