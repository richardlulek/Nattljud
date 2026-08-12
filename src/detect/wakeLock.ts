/**
 * Wake Lock-hjälpare: håller skärmen tänd i vaktläget och återtar låset
 * automatiskt när fliken blir synlig igen (iOS/Chrome släpper låset när
 * sidan hamnar i bakgrunden).
 */
export class WakeLockKeeper {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  onChange?: (active: boolean) => void;

  private visHandler = () => {
    if (this.wanted && document.visibilityState === "visible") {
      void this.request();
    }
  };

  static get supported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  async acquire(): Promise<boolean> {
    this.wanted = true;
    document.addEventListener("visibilitychange", this.visHandler);
    return this.request();
  }

  private async request(): Promise<boolean> {
    if (!WakeLockKeeper.supported) return false;
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.sentinel.addEventListener("release", () => {
        this.onChange?.(false);
      });
      this.onChange?.(true);
      return true;
    } catch {
      this.onChange?.(false);
      return false;
    }
  }

  release(): void {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.visHandler);
    void this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
    this.onChange?.(false);
  }
}
