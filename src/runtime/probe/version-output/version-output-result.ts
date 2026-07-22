import type { StrictSemVer } from '../../definition/index.js';
import type { VersionOutputFailureReason } from './version-output-failure-reason.js';

export type VersionOutputResult =
  | { readonly valid: true; readonly version: StrictSemVer }
  | { readonly valid: false; readonly reason: VersionOutputFailureReason };
