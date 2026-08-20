import type { PreparedProtocolSession } from './prepared-protocol-session.js';
import type { ProtocolDriverCreateRequest } from './protocol-driver-create-request.js';
import type { ProtocolDriverId } from './protocol-driver-id.js';

export interface ProtocolDriverPort {
  readonly id: ProtocolDriverId;
  create(request: ProtocolDriverCreateRequest): PreparedProtocolSession;
}
