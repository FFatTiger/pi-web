export type PwaControllerChange = "reload" | "prompt" | "ignore";

export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function isStandaloneDisplay(matchesStandalone: boolean, navigatorStandalone = false): boolean {
  return matchesStandalone || navigatorStandalone;
}

/**
 * Decide what a tab should do on controllerchange.
 * - hadController=false: first control acquisition (install + clients.claim) → ignore
 * - hadController=true + reloadRequested: this tab confirmed SKIP_WAITING → reload
 * - hadController=true + !reloadRequested: another tab activated the worker → prompt
 *
 * Second arg defaults to true so the original one-arg call sites still mean
 * "already-controlled tab".
 */
export function controllerChangeAction(
  reloadRequested: boolean,
  hadController = true,
): PwaControllerChange {
  if (!hadController) return "ignore";
  return reloadRequested ? "reload" : "prompt";
}
