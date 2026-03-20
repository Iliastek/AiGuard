// Fixture: unsafe coding patterns
// Expected issues: eval, prototype pollution, unhandled promise, weak hash

import crypto from "crypto";

function runUserScript(userInput: string): unknown {
  // line 6 — eval() with unsanitized user input (code injection)
  return eval(userInput);
}

function mergeConfig(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    // line 12 — prototype pollution: no check for __proto__ or constructor
    (target as Record<string, unknown>)[key] = source[key];
  }
}

async function fetchUserData(userId: string): Promise<void> {
  // line 18 — floating promise: no await, no .catch()
  fetch(`https://api.example.com/users/${userId}`)
    .then((r) => r.json())
    .then((data) => console.log(data));
}

function hashPassword(password: string): string {
  // line 24 — MD5 used for password hashing (cryptographically broken)
  return crypto.createHash("md5").update(password).digest("hex");
}

function parseJSON(input: string): unknown {
  // line 29 — no try/catch around JSON.parse (throws on invalid input)
  return JSON.parse(input);
}
