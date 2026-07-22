export type PwaControllerChange = "reload" | "prompt";

export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function isStandaloneDisplay(matchesStandalone: boolean, navigatorStandalone = false): boolean {
  return matchesStandalone || navigatorStandalone;
}

export function controllerChangeAction(reloadRequested: boolean): PwaControllerChange {
  return reloadRequested ? "reload" : "prompt";
}
