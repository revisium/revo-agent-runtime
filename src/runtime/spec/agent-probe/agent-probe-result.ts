import type { AgentProbeAvailable } from './agent-probe-available.js';
import type { AgentProbeUnavailable } from './agent-probe-unavailable.js';

export type AgentProbeResult = AgentProbeAvailable | AgentProbeUnavailable;
