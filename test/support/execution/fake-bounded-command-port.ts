import type {
  BoundedCommandPort,
  BoundedCommandRequest,
  CommandResolution,
  RunningBoundedCommand,
} from '../../../src/runtime/execution/index.js';

export type FakeBoundedCommandCall =
  | { readonly type: 'resolve'; readonly request: BoundedCommandRequest }
  | { readonly type: 'start'; readonly request: BoundedCommandRequest };

export class FakeBoundedCommandPort implements BoundedCommandPort {
  readonly calls: FakeBoundedCommandCall[] = [];
  readonly resolutions: CommandResolution[] = [];
  readonly starts: RunningBoundedCommand[] = [];

  resolve(request: BoundedCommandRequest): Promise<CommandResolution> {
    this.calls.push(Object.freeze({ type: 'resolve', request }));
    const result = this.resolutions.shift();
    if (result === undefined) throw new Error('No resolution queued.');
    return Promise.resolve(result);
  }

  start(request: BoundedCommandRequest): Promise<RunningBoundedCommand> {
    this.calls.push(Object.freeze({ type: 'start', request }));
    const result = this.starts.shift();
    if (result === undefined) throw new Error('No start queued.');
    return Promise.resolve(result);
  }
}
