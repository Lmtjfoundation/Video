import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { Platform } from "./types";
export { MAX_EXTRA_ACCOUNTS, MULTI_ACCOUNT } from "./types";

/**
 * More than one account on a network, like Metricool's brands: e.g. two Instagram accounts side by side.
 * The main account keeps the plain credential row ("instagram"); each extra account is "instagram:<id>".
 * Credential reads, writes and token refreshes inside `withAccount(id, …)` use that account's row, so the
 * adapters and refresh code work unchanged.
 */
const slot = new AsyncLocalStorage<string | undefined>();
export const withAccount = <T>(account: string | undefined, fn: () => Promise<T>) => slot.run(account || undefined, fn);
export const currentAccount = () => slot.getStore();
export const credKey = (platform: Platform, account = currentAccount()) => (account ? `${platform}:${account}` : platform);

export const newAccountId = () => `a${randomBytes(4).toString("hex")}`;
export const isAccountId = (s: unknown): s is string => typeof s === "string" && /^a[0-9a-f]{8}$/.test(s);
