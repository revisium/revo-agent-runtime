export type RawResponsePublicationResult =
  | Readonly<{ status: 'published'; file: 'raw-final-response.txt' }>
  | Readonly<{
      status:
        | 'conflict'
        | 'write_failed'
        | 'flush_failed'
        | 'link_failed'
        | 'directory_flush_failed';
    }>;
