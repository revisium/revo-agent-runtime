import type { BoundedCommandPort } from '../../runtime/execution/index.js';
import type {
  ExecutableProbePort,
  ExecutableResolution,
  ProbeHostPlatform,
  RunningVersionProbe,
  VersionProbeRequest,
} from '../../runtime/probe/index.js';
import { NodePosixBoundedCommandPort } from './node-posix-bounded-command-port.js';

const probeHostPlatform = (platform: NodeJS.Platform): ProbeHostPlatform =>
  platform === 'linux' || platform === 'darwin' || platform === 'win32' ? platform : 'other';

export class NodePosixExecutableProbePort implements ExecutableProbePort {
  readonly #command: BoundedCommandPort;
  readonly #environment: Readonly<Record<string, string>>;

  constructor(
    environment: Readonly<Record<string, string>>,
    command: BoundedCommandPort = new NodePosixBoundedCommandPort(),
  ) {
    this.#command = command;
    this.#environment = environment;
  }

  hostPlatform(): ProbeHostPlatform {
    // Known accepted gap: truthful win32 probing can reach POSIX-only terminateAndReap cleanup.
    return probeHostPlatform(process.platform);
  }

  async resolveExecutable(request: Readonly<{ command: string }>): Promise<ExecutableResolution> {
    return this.#command.resolve({
      command: request.command,
      args: [],
      environment: this.#environment,
    });
  }

  async startVersionProbe(request: VersionProbeRequest): Promise<RunningVersionProbe> {
    return this.#command.start({
      command: request.executable,
      args: request.args,
      environment: this.#environment,
      timeoutMs: request.timeoutMs,
      maxStdoutBytes: request.stdoutLimitBytes,
      maxStderrBytes: request.stderrLimitBytes,
    });
  }
}
