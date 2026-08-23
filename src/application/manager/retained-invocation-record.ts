import type { NormalizedInvocationOutcome, PreparedLaunch } from '../../runtime/execution/index.js';
import type { JsonObject } from '../../runtime/spec/index.js';

export interface RetainedInvocationRecord {
  readonly outcome: NormalizedInvocationOutcome;
  readonly pin: PreparedLaunch['pin'];
  readonly acceptedAt: string;
  readonly startedAt: string | undefined;
  readonly finishedAt: string | undefined;
  readonly metadata: JsonObject | undefined;
  readonly outputDirectory: string;
}
