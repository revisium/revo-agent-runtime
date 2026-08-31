export interface SystemExecutableProbe {
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export const defaultSystemExecutableProbe: SystemExecutableProbe = Object.freeze({
  args: ['--version'],
  timeoutMs: 1_000,
});

export interface BridgePackagePolicy {
  readonly binName: string;
  readonly bridgeName: string;
  readonly bridgeVersion: string;
  readonly vendorDependencyRange: string;
  readonly vendorName: string;
  readonly vendorVersion: string;
}

export interface NodePackageEntrypointPolicy {
  readonly binName: string;
  readonly command: string;
  readonly packageName: string;
}

export interface AdjacentNodePackagePolicy {
  readonly command: string;
  readonly entrypointName: string;
  readonly launcherName: string;
}

export interface AdjacentNodePackage {
  readonly entrypoint: string;
  readonly node: string;
}

export interface DiscoveryPlatform {
  resolveSystemExecutable(command: string): Promise<string | undefined>;
  resolveSystemOverride(
    executable: string,
    probe: SystemExecutableProbe,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
  probeSystemExecutable(
    executable: string,
    probe: SystemExecutableProbe,
    signal?: AbortSignal,
  ): Promise<boolean>;
  resolveBundledBridge(
    policy: BridgePackagePolicy,
  ):
    | { readonly available: true; readonly entrypoint: string }
    | { readonly available: false; readonly reason: string };
  resolveNodePackageEntrypoint(
    policy: NodePackageEntrypointPolicy,
    override?: string,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
  resolveAdjacentNodePackage(
    policy: AdjacentNodePackagePolicy,
    override?: string,
    signal?: AbortSignal,
  ): Promise<AdjacentNodePackage | undefined>;
}
