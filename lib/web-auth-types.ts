export type GateStatusKind = "enabled" | "disabled" | "unconfigured" | "error";

export type GatePublicStatus = {
  status: GateStatusKind;
  configPath: string;
};

export type GateConfig =
  | { status: "enabled"; configPath: string; password: string }
  | { status: "disabled"; configPath: string }
  | { status: "unconfigured"; configPath: string }
  | { status: "error"; configPath: string; logMessage: string };

export type GateStatusResponse = GatePublicStatus;

export type LoginSuccessResponse = { ok: true; next: string };
export type LoginFailureResponse = {
  ok: false;
  error: string;
  status?: Exclude<GateStatusKind, "enabled">;
  retryAfterSeconds?: number;
};

export type ReadGateConfigOptions = {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  readFile?: (path: string, encoding: BufferEncoding) => string;
};
