import type { ExecutableResolution } from './executable-resolution.js';
import type { RunningVersionProbe } from './running-version-probe.js';
import type { VersionProbeRequest } from './version-probe-request.js';

export type ProbeHostPlatform = 'darwin' | 'linux' | 'win32' | 'other';

export interface ExecutableProbePort {
  hostPlatform(): ProbeHostPlatform;
  resolveExecutable(request: Readonly<{ command: string }>): Promise<ExecutableResolution>;
  startVersionProbe(request: VersionProbeRequest): Promise<RunningVersionProbe>;
}
