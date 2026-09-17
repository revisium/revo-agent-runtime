/** Spawned as a temp .js file so the MCP child does not depend on the repo module graph. */
export const knowledgeMcpSource = `'use strict';
const fs = require('fs');
const auditArg = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('--audit='));
const correlationArg = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('--correlation='));
const auditPath = auditArg === undefined ? '' : auditArg.slice('--audit='.length);
const correlationId = correlationArg === undefined ? '' : correlationArg.slice('--correlation='.length);
const writeAudit = (name, text) => {
  if (auditPath.length === 0 || name !== 'echo') return;
  const line = JSON.stringify({
    correlationId: correlationId,
    method: 'tools/call',
    name: name,
    text: text,
  }) + '\\n';
  try {
    fs.writeFileSync(auditPath, line, { encoding: 'utf8', flag: 'ax', mode: 0o600 });
  } catch (error) {
    if (error && error.code === 'EEXIST') fs.appendFileSync(auditPath, line);
  }
  try {
    fs.chmodSync(auditPath, 0o600);
  } catch (error) {}
};
const writeMessage = (message) => {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
  process.stdout.write(body);
};
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const handle = (message) => {
  if (!isRecord(message)) return;
  const method = message.method;
  const id = message.id;
  if (method === 'initialize') {
    writeMessage({
      id,
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'revo-knowledge-fixture', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'tools/list') {
    writeMessage({
      id,
      jsonrpc: '2.0',
      result: {
        tools: [
          {
            description: 'Echo text for Revo live MCP evidence.',
            inputSchema: {
              properties: { text: { type: 'string' } },
              required: ['text'],
              type: 'object',
            },
            name: 'echo',
          },
        ],
      },
    });
    return;
  }
  if (method !== 'tools/call') return;
  const params = isRecord(message.params) ? message.params : {};
  const args = isRecord(params.arguments) ? params.arguments : {};
  const name = typeof params.name === 'string' ? params.name : '';
  const text = typeof args.text === 'string' ? args.text : '';
  writeAudit(name, text);
  writeMessage({
    id,
    jsonrpc: '2.0',
    result: { content: [{ text: 'echo:' + text, type: 'text' }] },
  });
};
let buffer = Buffer.alloc(0);
const consumeNdjson = () => {
  const newline = buffer.indexOf('\\n');
  if (newline === -1) return false;
  const line = buffer.subarray(0, newline).toString('utf8').trim();
  buffer = buffer.subarray(newline + 1);
  if (line.startsWith('{')) handle(JSON.parse(line));
  return true;
};
const consumeFramed = () => {
  const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
  if (headerEnd === -1) return false;
  const header = buffer.subarray(0, headerEnd).toString('utf8');
  const match = /Content-Length:\\s*(\\d+)/i.exec(header);
  if (match === null) {
    buffer = buffer.subarray(headerEnd + 4);
    return true;
  }
  const length = Number(match[1]);
  const start = headerEnd + 4;
  if (buffer.length < start + length) return false;
  handle(JSON.parse(buffer.subarray(start, start + length).toString('utf8')));
  buffer = buffer.subarray(start + length);
  return true;
};
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (consumeFramed() || consumeNdjson()) {}
});
`;
