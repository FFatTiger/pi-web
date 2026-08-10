import type { HttpClient } from "./http-client";
import { urls } from "./urls";

export interface GateStatus {
  required: boolean;
  authenticated: boolean;
  /** Optional host hint; may be absent on older hosts. */
  mode?: "local" | "lan";
}

export interface GateLoginInput {
  password: string;
}

export interface GateLoginResult {
  ok: boolean;
  message?: string;
}

export function createGateApi(http: HttpClient) {
  return {
    status: (signal?: AbortSignal) =>
      http.get<GateStatus>(urls.gate.status(), { signal }),
    login: (input: GateLoginInput, signal?: AbortSignal) =>
      http.post<GateLoginResult>(urls.gate.login(), input, {
        signal,
        skipAuthRedirect: true,
      }),
    logout: (signal?: AbortSignal) =>
      http.post<{ ok: boolean }>(urls.gate.logout(), {}, { signal }),
  };
}

export type GateApi = ReturnType<typeof createGateApi>;
