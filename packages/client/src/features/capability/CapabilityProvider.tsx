import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  DEFAULT_READONLY_CAPABILITIES,
  hasCapability,
  isAgentEnabled,
  type HostCapability,
  type HostInfo,
  type HostMode,
} from "@/protocol-shim";

export interface CapabilityContextValue {
  mode: HostMode;
  capabilities: readonly HostCapability[];
  /** True when host granted the `agent` capability. */
  canAgent: boolean;
  /** Inverse of canAgent — shell should present readonly UX. */
  isReadonly: boolean;
  can: (capability: HostCapability) => boolean;
  host: HostInfo;
}

const CapabilityContext = createContext<CapabilityContextValue | null>(null);

export interface CapabilityProviderProps {
  children: ReactNode;
  /** When omitted, defaults to readonly (no agent). */
  host?: Partial<HostInfo> | null;
}

export function CapabilityProvider({
  children,
  host,
}: CapabilityProviderProps) {
  const value = useMemo<CapabilityContextValue>(() => {
    const mode: HostMode = host?.mode ?? "local";
    const capabilities =
      host?.capabilities ?? DEFAULT_READONLY_CAPABILITIES;
    const canAgent = isAgentEnabled(capabilities);
    return {
      mode,
      capabilities,
      canAgent,
      isReadonly: !canAgent,
      can: (capability) => hasCapability(capabilities, capability),
      host: { mode, capabilities },
    };
  }, [host]);

  return (
    <CapabilityContext.Provider value={value}>
      {children}
    </CapabilityContext.Provider>
  );
}

export function useCapabilities(): CapabilityContextValue {
  const ctx = useContext(CapabilityContext);
  if (!ctx) {
    throw new Error("useCapabilities must be used within CapabilityProvider");
  }
  return ctx;
}
