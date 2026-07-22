import { createHmac, randomUUID } from "node:crypto";
import {
  chmod as fsChmod,
  readFile as fsReadFile,
  rename as fsRename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { statSync } from "node:fs";
import webpush from "web-push";
import { getPushStatePath } from "./push-paths";

export type VapidKeys = { publicKey: string; privateKey: string };

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
  authFingerprint: string;
};

export type PushStateFile = {
  version: 1;
  vapid: VapidKeys;
  subscriptions: StoredPushSubscription[];
};

export type BrowserPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Optional filesystem seam for tests; production uses node:fs/promises. */
export type PushStoreFs = {
  readFile: typeof fsReadFile;
  writeFile: typeof fsWriteFile;
  rename: typeof fsRename;
  unlink: typeof fsUnlink;
  chmod: typeof fsChmod;
};

export type PushStoreOptions = {
  statePath?: string;
  now?: () => Date;
  generateVapidKeys?: () => VapidKeys;
  /** Test-only: override selected filesystem operations for failure injection. */
  fs?: Partial<PushStoreFs>;
};

export class PushStoreLockedError extends Error {
  readonly code = "PUSH_STORE_LOCKED";

  constructor(message = "Push store is locked") {
    super(message);
    this.name = "PushStoreLockedError";
  }
}

const MAX_SUBSCRIPTIONS = 20;

const STATE_KEYS = new Set(["version", "vapid", "subscriptions"]);
const VAPID_KEYS = new Set(["publicKey", "privateKey"]);
const SUBSCRIPTION_KEYS = new Set([
  "endpoint",
  "p256dh",
  "auth",
  "createdAt",
  "authFingerprint",
]);

type GlobalPushStore = typeof globalThis & {
  __piPushStore?: PushStore;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(record: Record<string, unknown>, allowed: Set<string>): boolean {
  const keys = Object.keys(record);
  if (keys.length !== allowed.size) return false;
  return keys.every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * Strict schema for the private, server-owned state file.
 * Exact own-key sets only — unknown keys are rejected so later mutations cannot
 * silently normalize corruption. Used for both load and pre-persist validation.
 */
function validateState(value: unknown): PushStateFile {
  if (!isPlainObject(value) || !hasExactKeys(value, STATE_KEYS)) {
    throw new PushStoreLockedError();
  }
  if (value.version !== 1) throw new PushStoreLockedError();
  if (!isPlainObject(value.vapid) || !hasExactKeys(value.vapid, VAPID_KEYS)) {
    throw new PushStoreLockedError();
  }
  const vapid = value.vapid;
  if (!isNonEmptyString(vapid.publicKey) || !isNonEmptyString(vapid.privateKey)) {
    throw new PushStoreLockedError();
  }
  if (!Array.isArray(value.subscriptions)) throw new PushStoreLockedError();
  if (value.subscriptions.length > MAX_SUBSCRIPTIONS) throw new PushStoreLockedError();

  const endpoints = new Set<string>();
  const subscriptions: StoredPushSubscription[] = [];
  for (const item of value.subscriptions) {
    if (!isPlainObject(item) || !hasExactKeys(item, SUBSCRIPTION_KEYS)) {
      throw new PushStoreLockedError();
    }
    if (
      !isNonEmptyString(item.endpoint) ||
      !isNonEmptyString(item.p256dh) ||
      !isNonEmptyString(item.auth) ||
      !isNonEmptyString(item.createdAt) ||
      !isNonEmptyString(item.authFingerprint)
    ) {
      throw new PushStoreLockedError();
    }
    if (!isValidIsoDate(item.createdAt)) throw new PushStoreLockedError();
    if (endpoints.has(item.endpoint)) throw new PushStoreLockedError();
    endpoints.add(item.endpoint);
    subscriptions.push({
      endpoint: item.endpoint,
      p256dh: item.p256dh,
      auth: item.auth,
      createdAt: item.createdAt,
      authFingerprint: item.authFingerprint,
    });
  }

  return {
    version: 1,
    vapid: {
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
    subscriptions,
  };
}

/** Non-secret caller/input validation error (does not lock an existing store). */
function invalidInput(): never {
  throw new TypeError("Invalid push store input");
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (!isNonEmptyString(value)) invalidInput();
}

function assertBrowserSubscription(subscription: BrowserPushSubscription): void {
  if (!subscription || typeof subscription !== "object") invalidInput();
  assertNonEmptyString(subscription.endpoint);
  assertNonEmptyString(subscription.p256dh);
  assertNonEmptyString(subscription.auth);
}

export function computeAuthFingerprint(password: string, vapidPrivateKey: string): string {
  return createHmac("sha256", vapidPrivateKey)
    .update("pi-web-push-auth-v1")
    .update("\0")
    .update(password)
    .digest("base64url");
}

/**
 * Process-local Push subscription store.
 *
 * Concurrency: a single serialized mutation queue protects in-process writers
 * (including Next.js hot reload via `globalThis.__piPushStore`). There is no
 * cross-process file lock; multiple Node processes must not share one state
 * file for concurrent writes.
 *
 * Schema: load and persist both run the same strict exact-key validation.
 * Unknown top-level / vapid / subscription own keys are rejected (not ignored).
 */
export class PushStore {
  private readonly statePath: string;
  private readonly now: () => Date;
  private readonly generateVapidKeys: () => VapidKeys;
  private readonly fs: PushStoreFs;
  private state: PushStateFile | null = null;
  private loading: Promise<PushStateFile> | null = null;
  private locked = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options?: PushStoreOptions) {
    this.statePath = options?.statePath ?? getPushStatePath();
    this.now = options?.now ?? (() => new Date());
    this.generateVapidKeys = options?.generateVapidKeys ?? (() => webpush.generateVAPIDKeys());
    this.fs = {
      readFile: options?.fs?.readFile ?? fsReadFile,
      writeFile: options?.fs?.writeFile ?? fsWriteFile,
      rename: options?.fs?.rename ?? fsRename,
      unlink: options?.fs?.unlink ?? fsUnlink,
      chmod: options?.fs?.chmod ?? fsChmod,
    };
  }

  private lock(): never {
    this.locked = true;
    throw new PushStoreLockedError();
  }

  private async loadOrCreate(): Promise<PushStateFile> {
    if (this.locked) throw new PushStoreLockedError();

    let raw: string;
    try {
      raw = await this.fs.readFile(this.statePath, "utf8");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        // Confirm the path is not a directory (or other non-file).
        try {
          const st = statSync(this.statePath);
          if (st.isDirectory() || !st.isFile()) this.lock();
        } catch (statError) {
          const se = statError as NodeJS.ErrnoException;
          if (se.code !== "ENOENT") this.lock();
        }
        const generated = this.generateVapidKeys();
        // Fail closed before any write when the key source is invalid.
        if (!isNonEmptyString(generated.publicKey) || !isNonEmptyString(generated.privateKey)) {
          invalidInput();
        }
        const empty: PushStateFile = {
          version: 1,
          vapid: {
            publicKey: generated.publicKey,
            privateKey: generated.privateKey,
          },
          subscriptions: [],
        };
        await this.persist(empty);
        return empty;
      }
      this.lock();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.lock();
    }

    let state: PushStateFile;
    try {
      state = validateState(parsed);
    } catch (error) {
      if (error instanceof PushStoreLockedError) this.lock();
      throw error;
    }

    // Fail closed: do not operate on valid secrets at insecure permissions.
    try {
      await this.fs.chmod(this.statePath, 0o600);
    } catch {
      this.lock();
    }
    return state;
  }

  private async load(): Promise<PushStateFile> {
    if (this.locked) throw new PushStoreLockedError();
    if (this.state) return this.state;
    this.loading ??= this.loadOrCreate().catch((error) => {
      // Invalid generated keys / caller input must not permanently lock create path.
      if (!(error instanceof TypeError)) {
        this.locked = true;
      }
      this.loading = null;
      throw error;
    });
    this.state = await this.loading;
    return this.state;
  }

  private async persist(state: PushStateFile): Promise<void> {
    // Defense in depth: never serialize a draft the load path would reject.
    const validated = validateState(state);

    // Same-directory atomic write: pi-web-push.json.tmp-<pid>-<uuid>
    const temp = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`;
    let renamed = false;
    try {
      await this.fs.writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await this.fs.chmod(temp, 0o600);
      try {
        await this.fs.rename(temp, this.statePath);
        renamed = true;
      } catch (error) {
        await this.fs.unlink(temp).catch(() => {});
        throw error;
      }
      try {
        await this.fs.chmod(this.statePath, 0o600);
      } catch {
        // Durable content is already on disk; refuse further use without 0600.
        // Caller still applies draft so memory matches the committed file.
        this.locked = true;
        throw new PushStoreLockedError();
      }
    } catch (error) {
      if (!renamed) await this.fs.unlink(temp).catch(() => {});
      throw error;
    }
  }

  private async mutate<T>(fn: (draft: PushStateFile) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = this.mutationQueue.then(async () => {
      const base = await this.load();
      const draft = structuredClone(base);
      result = await fn(draft);
      try {
        await this.persist(draft);
        this.state = draft;
      } catch (error) {
        // If rename committed then post-chmod locked the store, keep memory
        // aligned with the durable draft so a later unlock/restart is consistent.
        if (this.locked) this.state = draft;
        throw error;
      }
    });
    // Recover the queue after a failed mutation so later writes can proceed
    // when the failure was transient (e.g. ENOSPC before rename).
    this.mutationQueue = operation.catch(() => {});
    await operation;
    return result;
  }

  async getVapidKeys(): Promise<VapidKeys> {
    const state = await this.load();
    return { publicKey: state.vapid.publicKey, privateKey: state.vapid.privateKey };
  }

  async getPublicKey(): Promise<string> {
    const state = await this.load();
    return state.vapid.publicKey;
  }

  async upsert(
    subscription: BrowserPushSubscription,
    password: string,
  ): Promise<"created" | "updated" | "limit"> {
    assertBrowserSubscription(subscription);
    assertNonEmptyString(password);
    return this.mutate((draft) => {
      const fingerprint = computeAuthFingerprint(password, draft.vapid.privateKey);
      const index = draft.subscriptions.findIndex((item) => item.endpoint === subscription.endpoint);
      const next: StoredPushSubscription = {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        createdAt: this.now().toISOString(),
        authFingerprint: fingerprint,
      };
      if (index >= 0) {
        draft.subscriptions[index] = next;
        return "updated";
      }
      if (draft.subscriptions.length >= MAX_SUBSCRIPTIONS) {
        return "limit";
      }
      draft.subscriptions.push(next);
      return "created";
    });
  }

  async remove(endpoint: string, password: string): Promise<boolean> {
    assertNonEmptyString(endpoint);
    assertNonEmptyString(password);
    return this.mutate((draft) => {
      const fingerprint = computeAuthFingerprint(password, draft.vapid.privateKey);
      const index = draft.subscriptions.findIndex(
        (item) => item.endpoint === endpoint && item.authFingerprint === fingerprint,
      );
      if (index < 0) return false;
      draft.subscriptions.splice(index, 1);
      return true;
    });
  }

  async findAuthorized(endpoint: string, password: string): Promise<StoredPushSubscription | null> {
    assertNonEmptyString(endpoint);
    assertNonEmptyString(password);
    const state = await this.load();
    const fingerprint = computeAuthFingerprint(password, state.vapid.privateKey);
    const match = state.subscriptions.find(
      (item) => item.endpoint === endpoint && item.authFingerprint === fingerprint,
    );
    return match ? structuredClone(match) : null;
  }

  async listAuthorized(password: string): Promise<StoredPushSubscription[]> {
    assertNonEmptyString(password);
    return this.mutate((draft) => {
      const fingerprint = computeAuthFingerprint(password, draft.vapid.privateKey);
      const authorized = draft.subscriptions.filter((item) => item.authFingerprint === fingerprint);
      draft.subscriptions = authorized;
      return structuredClone(authorized);
    });
  }

  async removeEndpoint(endpoint: string): Promise<void> {
    assertNonEmptyString(endpoint);
    await this.mutate((draft) => {
      draft.subscriptions = draft.subscriptions.filter((item) => item.endpoint !== endpoint);
    });
  }
}

export function getPushStore(): PushStore {
  const g = globalThis as GlobalPushStore;
  if (!g.__piPushStore) {
    g.__piPushStore = new PushStore();
  }
  return g.__piPushStore;
}
