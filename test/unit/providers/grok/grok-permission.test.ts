import { expect, test } from 'vitest';

import { grokMcpPermission } from '../../../../src/providers/grok/permission.js';

const call = {
  options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' as const }],
  sessionId: 'session',
  toolCall: {
    toolCallId: 'tool',
    title: 'knowledge__echo',
    rawInput: { variant: 'UseTool', tool_name: 'knowledge__echo', tool_input: { text: 'nonce' } },
  },
};
const servers = [{ name: 'knowledge', transport: 'stdio' as const, command: 'node', args: [] }];

test('explicit MCP grant approves only an attached exact Grok tool, once', () => {
  expect(grokMcpPermission(call, { mcpTools: ['knowledge__echo'] }, servers)).toBe('once');
});

test.each([
  {},
  { mcpTools: '*' },
  { mcpTools: [1] },
  { mcpTools: ['knowledge__*'] },
  { mcpTools: ['knowledgeecho'] },
  { mcpTools: ['other__echo'] },
])('absent or nonmatching grants do not approve MCP requests: %j', (permissions) => {
  expect(grokMcpPermission(call, permissions, servers)).toBeUndefined();
});

test('tool title alone and malformed raw input cannot issue a grant', () => {
  for (const rawInput of [
    undefined,
    null,
    [],
    {},
    { ...call.toolCall.rawInput, variant: 'Bash' },
    { ...call.toolCall.rawInput, tool_name: 1 },
    { ...call.toolCall.rawInput, tool_input: 'unstructured' },
  ]) {
    expect(
      grokMcpPermission(
        { ...call, toolCall: { ...call.toolCall, rawInput } },
        { mcpTools: ['knowledge__echo'] },
        servers,
      ),
    ).toBeUndefined();
  }
});

test('detached servers, ambiguous namespace and persistent approval options are rejected', () => {
  expect(grokMcpPermission(call, { mcpTools: ['knowledge__echo'] }, [])).toBeUndefined();
  expect(
    grokMcpPermission(call, { mcpTools: ['knowledge__echo'] }, [...servers, ...servers]),
  ).toBeUndefined();
  expect(
    grokMcpPermission({ ...call, options: [] }, { mcpTools: ['knowledge__echo'] }, servers),
  ).toBeUndefined();
});

test('a grant cannot cross a namespace boundary or target an empty tool name', () => {
  expect(
    grokMcpPermission(call, { mcpTools: ['knowledge__echo'] }, [{ ...servers[0]!, name: 'other' }]),
  ).toBeUndefined();
  expect(
    grokMcpPermission(
      {
        ...call,
        toolCall: {
          ...call.toolCall,
          rawInput: { ...call.toolCall.rawInput, tool_name: 'knowledge__' },
        },
      },
      { mcpTools: ['knowledge__'] },
      servers,
    ),
  ).toBeUndefined();
});

test('persistent or rejection choices never substitute for allow_once', () => {
  expect(
    grokMcpPermission(
      {
        ...call,
        options: [
          { optionId: 'always', name: 'Always', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
      { mcpTools: ['knowledge__echo'] },
      servers,
    ),
  ).toBeUndefined();
});

test('exact underscore identifiers retain their namespace and tool grant', () => {
  expect(
    grokMcpPermission(
      {
        ...call,
        toolCall: { ...call.toolCall, rawInput: { ...call.toolCall.rawInput, tool_name: '____' } },
      },
      { mcpTools: ['____'] },
      [{ ...servers[0]!, name: '_' }],
    ),
  ).toBe('once');
});
