// Scan quality test — verifies GPT returns correct line ranges and valid replacement code.
// Usage: npx ts-node test/scan-quality.ts
// Requires: backend running on localhost:3000 with a valid OPENAI_API_KEY

import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000/v1";
const LICENSE_KEY = "dev-key-001";

interface FixRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface CodeIssue {
  id: string;
  line: number;
  endLine: number;
  severity: "info" | "warning" | "error";
  message: string;
  originalCode: string;
  fixability: "auto" | "manual" | "suggestion";
  fix?: {
    type: string;
    range: FixRange;
    replacement: string;
  };
}

interface AnalyzeResponse {
  issues: CodeIssue[];
  scanDurationMs: number;
}

// Expectations: each entry describes an issue we MUST find in the fixture.
interface Expectation {
  description: string;
  // GPT line numbers are 0-based after conversion in analyze.ts
  nearLine: number; // issue.line must be within ±1 of this
  severityMin: "info" | "warning" | "error";
  mustHaveFix: boolean;
  // When mustHaveFix=true, replacement must NOT match these patterns (comments, prose)
  badReplacementPatterns?: RegExp[];
}

const FIXTURES: Array<{
  file: string;
  language: string;
  expectations: Expectation[];
}> = [
  {
    file: "credentials.ts",
    language: "typescript",
    expectations: [
      {
        description: "hardcoded DB_PASSWORD constant",
        nearLine: 4,
        severityMin: "error",
        mustHaveFix: false,
      },
      {
        description: "Math.random() for session token",
        nearLine: 9,
        severityMin: "warning",
        mustHaveFix: true,
        badReplacementPatterns: [/\/\//, /TODO/, /consider/i, /use crypto/i],
      },
      {
        description: "deprecated createCipher or hardcoded encryption key",
        nearLine: 20,
        severityMin: "warning",
        mustHaveFix: false,
      },
    ],
  },
  {
    file: "express-app.ts",
    language: "typescript",
    expectations: [
      {
        description: "SQL injection via string concatenation",
        nearLine: 13,
        severityMin: "error",
        mustHaveFix: true,
        badReplacementPatterns: [/\/\//, /TODO/, /parameterize/i],
      },
      {
        description: "XSS via raw user input in HTML",
        nearLine: 20,
        severityMin: "error",
        mustHaveFix: false,
      },
      {
        description: "no authorization check on DELETE",
        nearLine: 24,
        severityMin: "warning",
        mustHaveFix: false,
      },
    ],
  },
  {
    file: "unsafe-patterns.ts",
    language: "typescript",
    expectations: [
      {
        description: "eval() with user input",
        nearLine: 6,
        severityMin: "error",
        mustHaveFix: false,
      },
      {
        description: "MD5 for password hashing",
        nearLine: 24,
        severityMin: "error",
        mustHaveFix: true,
        badReplacementPatterns: [/\/\//, /TODO/, /use bcrypt/i],
      },
      {
        description: "JSON.parse without try/catch",
        nearLine: 29,
        severityMin: "warning",
        mustHaveFix: true,
        badReplacementPatterns: [/\/\//, /TODO/],
      },
    ],
  },
];

function severityRank(s: "info" | "warning" | "error"): number {
  return s === "error" ? 2 : s === "warning" ? 1 : 0;
}

async function analyze(code: string, language: string): Promise<AnalyzeResponse> {
  const res = await fetch(`${BASE_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LICENSE_KEY}`,
    },
    body: JSON.stringify({ code, language, filePath: "test-fixture" }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as AnalyzeResponse;
}

function checkExpectation(issues: CodeIssue[], exp: Expectation): string[] {
  const failures: string[] = [];

  // Find nearest issue within ±2 lines (0-based)
  const match = issues.find((i) => Math.abs(i.line - exp.nearLine) <= 2);

  if (!match) {
    const lines = issues.map((i) => i.line).join(", ");
    failures.push(
      `  MISS: "${exp.description}" — expected near line ${exp.nearLine}, got issues at lines [${lines}]`,
    );
    return failures;
  }

  if (severityRank(match.severity) < severityRank(exp.severityMin)) {
    failures.push(
      `  SEVERITY: "${exp.description}" — expected >=${exp.severityMin}, got ${match.severity}`,
    );
  }

  if (exp.mustHaveFix && match.fixability !== "auto") {
    failures.push(
      `  NO FIX: "${exp.description}" — expected auto fix, got fixability=${match.fixability}`,
    );
  }

  if (exp.mustHaveFix && match.fix) {
    const replacement = match.fix.replacement;
    if (!replacement.trim()) {
      failures.push(`  EMPTY REPLACEMENT: "${exp.description}"`);
    }
    for (const pattern of exp.badReplacementPatterns ?? []) {
      if (pattern.test(replacement)) {
        failures.push(
          `  BAD REPLACEMENT: "${exp.description}" — replacement matches forbidden pattern ${pattern}: ${JSON.stringify(replacement)}`,
        );
      }
    }
    // Validate line range is sane (non-negative, start <= end)
    const { startLine, endLine } = match.fix.range;
    if (startLine > endLine) {
      failures.push(
        `  BAD RANGE: "${exp.description}" — startLine(${startLine}) > endLine(${endLine})`,
      );
    }
  }

  return failures;
}

async function runFixture(fixture: (typeof FIXTURES)[number]): Promise<boolean> {
  const fixturePath = path.join(__dirname, "fixtures", fixture.file);
  const code = fs.readFileSync(fixturePath, "utf8");

  console.log(`\n--- ${fixture.file} ---`);

  let response: AnalyzeResponse;
  try {
    response = await analyze(code, fixture.language);
  } catch (err) {
    console.error(`  ERROR calling /analyze:`, err);
    return false;
  }

  console.log(
    `  Scan: ${response.scanDurationMs}ms, ${response.issues.length} issues found`,
  );

  // Print all issues for inspection
  for (const issue of response.issues) {
    const fixTag = issue.fixability === "auto" ? "[FIX]" : "     ";
    console.log(
      `  ${fixTag} L${issue.line + 1} [${issue.severity}] ${issue.message}`,
    );
    if (issue.fix) {
      const r = issue.fix.range;
      console.log(
        `         patch: lines ${r.startLine + 1}-${r.endLine + 1} → ${JSON.stringify(issue.fix.replacement.slice(0, 80))}`,
      );
    }
  }

  let passed = true;
  const allFailures: string[] = [];

  for (const exp of fixture.expectations) {
    const failures = checkExpectation(response.issues, exp);
    allFailures.push(...failures);
    if (failures.length === 0) {
      console.log(`  PASS: ${exp.description}`);
    }
  }

  for (const f of allFailures) {
    console.log(f);
    passed = false;
  }

  return passed;
}

async function main(): Promise<void> {
  console.log("AiGuard scan quality test");
  console.log("=".repeat(40));

  let totalPassed = 0;
  let totalFailed = 0;

  for (const fixture of FIXTURES) {
    const ok = await runFixture(fixture);
    if (ok) {
      totalPassed++;
    } else {
      totalFailed++;
    }
  }

  console.log("\n" + "=".repeat(40));
  console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
