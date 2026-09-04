interface SessionIdentity {
  readonly sessionId: string;
  readonly epoch: number;
}

export interface EffectCorrelation extends SessionIdentity {
  readonly effectId: string;
  readonly turnId?: string;
}

export interface TurnEffectCorrelation extends EffectCorrelation {
  readonly turnId: string;
}

export interface PublicCallCorrelation extends SessionIdentity {
  readonly callId: string;
  readonly turnId?: string;
}

export interface TurnPublicCallCorrelation extends PublicCallCorrelation {
  readonly turnId: string;
}
