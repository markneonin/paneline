const leaveListeners = new Map<string, () => void>();
let shown = "";
let isEntering = false;

export function noteShownTab(id: string): void {
  isEntering = shown !== id;
  if (isEntering) notifyLeft();
  shown = id;
}

export function isShownTab(id: string): boolean {
  return shown === id;
}

export function justEntered(id: string): boolean {
  return isEntering && shown === id;
}

export function onTabLeft(id: string, listener: () => void): void {
  leaveListeners.set(id, listener);
}

function notifyLeft(): void {
  leaveListeners.get(shown)?.();
}

export function forgetShownTab(): void {
  notifyLeft();
  shown = "";
  isEntering = false;
}
