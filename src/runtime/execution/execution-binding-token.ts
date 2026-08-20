interface ExecutionBindingTokenInput {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
  readonly protocolDriverId: 'native/stdio-v1' | 'acp/v1';
  readonly resultParserId?: 'codex-jsonl/v1' | 'claude-stream-json/v1';
  readonly permissionStrategyId: 'codex-cli/v1' | 'claude-cli/v1' | 'acp/v1';
  readonly delivery: {
    readonly prompt: 'argument' | 'stdin' | 'file' | 'protocol';
    readonly resultSchema: 'argument' | 'file' | 'protocol';
    readonly result: 'stdout' | 'protocol';
  };
}

export class ExecutionBindingToken {
  readonly #proof: ExecutionBindingTokenInput;

  private constructor(input: ExecutionBindingTokenInput) {
    this.#proof = Object.freeze({
      agentId: input.agentId,
      agentVersion: input.agentVersion,
      definitionDigest: input.definitionDigest,
      protocolDriverId: input.protocolDriverId,
      ...(input.resultParserId === undefined ? {} : { resultParserId: input.resultParserId }),
      permissionStrategyId: input.permissionStrategyId,
      delivery: Object.freeze({ ...input.delivery }),
    });
    Object.freeze(this);
  }

  static create(input: ExecutionBindingTokenInput): ExecutionBindingToken {
    return new ExecutionBindingToken(input);
  }

  static matches(token: unknown, proof: ExecutionBindingTokenInput): boolean {
    if (typeof token !== 'object' || token === null || !(#proof in token)) return false;
    return (
      token.#proof.agentId === proof.agentId &&
      token.#proof.agentVersion === proof.agentVersion &&
      token.#proof.definitionDigest === proof.definitionDigest &&
      token.#proof.protocolDriverId === proof.protocolDriverId &&
      token.#proof.resultParserId === proof.resultParserId &&
      token.#proof.permissionStrategyId === proof.permissionStrategyId &&
      token.#proof.delivery.prompt === proof.delivery.prompt &&
      token.#proof.delivery.resultSchema === proof.delivery.resultSchema &&
      token.#proof.delivery.result === proof.delivery.result
    );
  }
}
