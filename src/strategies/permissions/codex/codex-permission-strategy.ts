type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

interface CodexPermissionRequest {
  readonly sandbox: CodexSandbox;
  readonly network: 'disabled' | 'enabled';
  readonly allowDangerFullAccess?: boolean;
}

interface CodexPermissionMapping {
  readonly sandboxFlag: `--sandbox=${CodexSandbox}`;
  readonly config: readonly string[];
}

const copy = (value: CodexPermissionMapping): CodexPermissionMapping =>
  Object.freeze({ ...value, config: Object.freeze([...value.config]) });

export const mapCodexPermissions = (request: CodexPermissionRequest): CodexPermissionMapping => {
  if (request.sandbox === 'danger-full-access' && request.allowDangerFullAccess !== true)
    throw new Error('Codex danger-full-access requires explicit admission.');
  if (request.sandbox === 'read-only' && request.network === 'enabled')
    throw new Error('Codex read-only with network enabled has no approved mapping.');

  const config =
    request.network === 'enabled'
      ? ['--config', 'sandbox_workspace_write.network_access=true']
      : ['--config', 'sandbox_workspace_write.network_access=false'];
  return copy({
    sandboxFlag: `--sandbox=${request.sandbox}`,
    config,
  });
};
