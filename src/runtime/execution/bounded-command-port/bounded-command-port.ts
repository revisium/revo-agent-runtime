import type { BoundedCommandRequest } from './bounded-command-request.js';
import type { CommandResolution } from './command-resolution.js';
import type { RunningBoundedCommand } from './running-bounded-command.js';

export interface BoundedCommandPort {
  resolve(request: BoundedCommandRequest): Promise<CommandResolution>;
  start(request: BoundedCommandRequest): Promise<RunningBoundedCommand>;
}
