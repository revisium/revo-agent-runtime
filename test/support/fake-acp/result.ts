export const resultTextForMode = (mode: string): string => {
  if (mode === 'ok-result' || mode === 'recovery') return '{"ok":true}';
  if (mode === 'array-result') return '[]';
  if (mode === 'primitive-result') return 'true';
  if (mode === 'empty-result') return '';
  if (mode === 'duplicate-result') return '{"one":1}{"two":2}';
  if (mode === 'literal-secret-result') return '{"answer":"literal-secret"}';
  if (mode === 'schema-mismatch') return JSON.stringify({ unexpected: 'vendor-schema-payload' });
  if (mode === 'oversized-result') return JSON.stringify({ answer: 'x'.repeat(70_000) });
  if (mode === 'environment-result')
    return JSON.stringify({
      answer: process.env.VISIBLE_VALUE ?? null,
      secret: process.env.SECRET_CHILD ?? null,
      unrelated: process.env.UNRELATED_HOST_SECRET ?? null,
    });
  return '{"answer":"fake ACP result"}';
};
