import type { AgentLaunchEvidence } from '../../contracts/launch.js';
import { createBoundedOutput } from '../output/bounded-output.js';
import type { ProcessExit } from '../process/port.js';
import type { ExecutionEvidence, InvocationExecutionRequest } from './contracts.js';

const emptyOutput = (): Readonly<{ stdout: Uint8Array; stderr: Uint8Array }> =>
  Object.freeze({ stdout: new Uint8Array(), stderr: new Uint8Array() });

/** Owns bounded process output and authentic evidence for one invocation. */
export class InvocationArtifacts {
  private readonly stdout;
  private readonly stderr;
  private finalizedOutput: Readonly<{ stdout: Uint8Array; stderr: Uint8Array }> | undefined;
  private finalizedEvidence: ExecutionEvidence | undefined;

  constructor(request: InvocationExecutionRequest) {
    const secrets = request.redactionSecrets ?? [];
    this.stdout = createBoundedOutput({
      maxBytes: request.maxStdoutBytes ?? 8_388_608,
      secrets,
    });
    this.stderr = createBoundedOutput({
      maxBytes: request.maxStderrBytes ?? 8_388_608,
      secrets,
    });
  }

  writeStdout = (chunk: Uint8Array): void => this.stdout.write(chunk);
  writeStderr = (chunk: Uint8Array): void => this.stderr.write(chunk);

  finalizeEvidence(launch: AgentLaunchEvidence, processExit: ProcessExit): ExecutionEvidence {
    this.finalizedEvidence = Object.freeze({
      launch,
      processExit: Object.freeze({ ...processExit }),
    });
    return this.finalizedEvidence;
  }

  finalizeOutput(): void {
    this.finalizedOutput = Object.freeze({
      stderr: this.stderr.finalize().bytes,
      stdout: this.stdout.finalize().bytes,
    });
  }

  evidence(): ExecutionEvidence | undefined {
    return this.finalizedEvidence;
  }

  output(): Readonly<{ stdout: Uint8Array; stderr: Uint8Array }> {
    return this.finalizedOutput ?? emptyOutput();
  }
}
