// Fixture: hardcoded credentials and insecure token generation
// Expected issues: lines 4, 8, 14, 19

import crypto from "crypto";

const DB_PASSWORD = "super_secret_123";  // line 5 — hardcoded credential
const API_KEY = "sk-prod-abcdef1234567890";  // line 6 — hardcoded API key

function generateSessionToken(): string {
  // line 9 — Math.random() used for security-sensitive token
  return Math.random().toString(36).slice(2);
}

async function connectToDatabase() {
  const connectionString = `postgres://admin:super_secret_123@prod-db.example.com:5432/users`;  // line 14 — hardcoded creds in URL
  console.log("Connecting with:", connectionString);  // line 15 — logging sensitive data
  return connectionString;
}

function encryptData(data: string): string {
  const key = "hardcoded-aes-key-1234567890abcd";  // line 20 — hardcoded encryption key
  return crypto.createCipher("des", key).update(data, "utf8", "hex");  // line 21 — deprecated cipher + hardcoded key
}
