const escapePointerToken = (token: string): string =>
  token.replaceAll('~', '~0').replaceAll('/', '~1');

export const appendPointerToken = (path: string, token: string): string =>
  `${path}/${escapePointerToken(token)}`;
