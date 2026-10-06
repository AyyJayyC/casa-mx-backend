import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("B3 - no hardcoded credentials or PII", () => {
  const cases: Array<{ file: string; forbidden: string[] }> = [
    {
      file: "scripts/create-admin.ts",
      forbidden: ["CasaMX2026!", "5axelj@gmail.com"],
    },
    { file: "src/routes/admin.ts", forbidden: ["CasaMX2026!"] },
    {
      file: "prisma/seed.ts",
      forbidden: ["admin123", "seller123", "buyer123"],
    },
    { file: "scripts/smoke-test.ts", forbidden: ["5axelj@gmail.com"] },
    { file: ".env.example", forbidden: ["5axelj@gmail.com"] },
    { file: "scripts/e2e-workflow-test.js", forbidden: ['"admin123"'] },
  ];

  for (const c of cases) {
    it(`${c.file} contains no leaked credentials`, () => {
      const content = read(c.file);
      for (const token of c.forbidden) {
        expect(content, `${c.file} must not contain "${token}"`).not.toContain(
          token,
        );
      }
    });
  }

  it("create-admin.ts requires env credentials (no literal password)", () => {
    const content = read("scripts/create-admin.ts");
    expect(content).not.toMatch(/password\s*=\s*["'][^"']+["']/);
    expect(content).toContain("ADMIN_INITIAL_PASSWORD");
  });
});
