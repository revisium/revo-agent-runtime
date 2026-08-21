export type TerminalResultPublicationResult =
  | Readonly<{ status: 'published'; file: 'result.json' }>
  | Readonly<{
      status:
        | 'conflict'
        | 'write_failed'
        | 'flush_failed'
        | 'link_failed'
        | 'directory_flush_failed';
    }>;
