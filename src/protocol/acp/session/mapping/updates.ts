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

type ToolUpdate = Extract<SessionProtocolUpdate, { readonly type: 'tool' }>;

export const mapAcpSessionUpdate = (
  update: acp.SessionUpdate,
  tools: Map<string, ToolUpdate> = new Map(),
): SessionProtocolUpdate | undefined => {
  if (
    update.sessionUpdate === 'agent_message_chunk' &&
    update.content.type === 'text' &&
    update.content.text.length > 0
  )
    return Object.freeze({ content: update.content.text, type: 'message.delta' });
  if (
    update.sessionUpdate === 'tool_call' ||
    (update.sessionUpdate === 'tool_call_update' &&
      (update.title != null || update.status != null || update.kind != null))
  ) {
    const previous =
      update.sessionUpdate === 'tool_call_update' ? tools.get(update.toolCallId) : undefined;
    const mapped: ToolUpdate = Object.freeze({
      kind: toolKind(update.kind ?? previous?.kind),
      status: update.status == null ? (previous?.status ?? 'started') : toolStatus(update.status),
      title: update.title ?? previous?.title ?? update.toolCallId,
      toolCallId: update.toolCallId,
      type: 'tool',
    });
    tools.delete(update.toolCallId);
    tools.set(update.toolCallId, mapped);
    if (tools.size > 1_024) tools.delete(tools.keys().next().value!);
    return mapped;
  }
  if (update.sessionUpdate === 'plan')
    return Object.freeze({ items: Object.freeze(planItems(update.entries)), type: 'plan' });
  return undefined;
};

export const deliverAcpSessionUpdate = async (
  observer: SessionProtocolObserver | undefined,
  update: acp.SessionUpdate,
  tools?: Map<string, ToolUpdate>,
): Promise<void> => {
  const mapped = mapAcpSessionUpdate(update, tools);
  if (mapped === undefined || observer === undefined) return;
  await observer.update(mapped);
};
