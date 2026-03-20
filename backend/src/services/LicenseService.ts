// Hardcoded valid license keys for initial development.
// Replace with database/JWT validation before production.
const VALID_KEYS = new Set<string>([
  "dev-key-001",
  "dev-key-002",
  "test-license-aiguard",
]);

export class LicenseService {
  validate(key: string): boolean {
    return VALID_KEYS.has(key);
  }
}
