import { normalizeAcpConfiguration } from '../../configuration/catalog.js';
import type { ConfigurationCatalogFallback } from '../../execution/configuration/fallback.js';

const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,255}$/;

class GrokModelsOutputError extends Error {
  constructor() {
    super('Invalid grok models output.');
    this.name = 'GrokModelsOutputError';
  }
}

const parseModels = (stdout: Uint8Array) => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch {
    throw new GrokModelsOutputError();
  }
  const defaultMatch = /^Default model:\s*(\S+)\s*$/m.exec(text);
  const available = text.split('\n').flatMap((line) => {
    const match = /^\s{2}[*-]\s+(\S+?)(?:\s+\(default\))?\s*$/.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  const current = defaultMatch?.[1];
  if (
    current === undefined ||
    !modelIdPattern.test(current) ||
    available.length === 0 ||
    available.length > 1_000 ||
    available.some((model) => !modelIdPattern.test(model)) ||
    new Set(available).size !== available.length ||
    !available.includes(current)
  )
    throw new GrokModelsOutputError();
  return { available, current };
};

export const grokModelCommandFallback: ConfigurationCatalogFallback = Object.freeze({
  args: Object.freeze(['models']),
  parse: (stdout: Uint8Array) => {
    const parsed = parseModels(stdout);
    return normalizeAcpConfiguration([
      {
        category: 'model',
        currentValue: parsed.current,
        id: 'model',
        name: 'Model',
        options: parsed.available.map((value) => ({ name: value, value })),
        type: 'select',
      },
    ]);
  },
});
