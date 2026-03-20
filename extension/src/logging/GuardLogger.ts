export class GuardLogger {
  public static isVerboseEnabled(): boolean {
    return process.env.VERBOSE_GUARD === "true";
  }

  public static info(scope: string, message: string): void {
    console.log(`${this.timestamp()} [AI Guard][${scope}] ${message}`);
  }

  public static warn(scope: string, message: string): void {
    console.warn(`${this.timestamp()} [AI Guard][${scope}] ${message}`);
  }

  public static error(scope: string, message: string, error?: unknown): void {
    if (error) {
      console.error(
        `${this.timestamp()} [AI Guard][${scope}] ${message}`,
        error,
      );
      return;
    }

    console.error(`${this.timestamp()} [AI Guard][${scope}] ${message}`);
  }

  public static verbose(scope: string, message: string): void {
    if (!this.isVerboseEnabled()) {
      return;
    }

    this.info(scope, message);
  }

  private static timestamp(): string {
    return new Date().toLocaleTimeString();
  }
}
