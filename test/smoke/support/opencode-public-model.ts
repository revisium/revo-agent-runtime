const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** v1.18.30 provider.ts retains zero-cost models and supplies apiKey: "public" without auth. */
export const verifiedPublicOpenCodeModel = (input: {
  readonly selectedModel: string;
  readonly reportedVersion: string;
  readonly stdout: string;
}): boolean => {
  if (input.reportedVersion !== '1.18.30' || input.selectedModel !== 'opencode/big-pickle')
    return false;
  const lines = input.stdout.split(/\r?\n/);
  const start = lines.indexOf(input.selectedModel);
  if (start < 0) return false;
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => line.startsWith('opencode/'));
  try {
    const model = record(JSON.parse((next < 0 ? rest : rest.slice(0, next)).join('\n')));
    const api = record(model?.api);
    const cost = record(model?.cost);
    return (
      model?.id === 'big-pickle' &&
      model.providerID === 'opencode' &&
      api?.id === 'big-pickle' &&
      api.url === 'https://opencode.ai/zen/v1' &&
      api.npm === '@ai-sdk/openai-compatible' &&
      cost?.input === 0 &&
      cost.output === 0
    );
  } catch {
    return false;
  }
};
