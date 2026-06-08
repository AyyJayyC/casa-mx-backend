/**
 * Smoke test — verifies critical production paths are healthy.
 *
 * Run via cron (e.g. GitHub Actions scheduled workflow) to catch silent failures.
 * Tests:
 *   1. Health endpoint returns ok
 *   2. ADMIN_EMAIL user can log in
 *   3. Admin role is approved after login
 *   4. Email service is configured
 */

const BACKEND_URL = process.env.BACKEND_URL || "https://api.casa-mx.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "5axelj@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

interface SmokeResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: SmokeResult[] = [];
let exitCode = 0;

function record(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  return fn()
    .then(() => {
      results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
    })
    .catch((err: Error) => {
      results.push({
        name,
        passed: false,
        error: err.message,
        duration: Date.now() - start,
      });
      console.log(`  ❌ ${name}: ${err.message}`);
      exitCode = 1;
    });
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  console.log(`\n🔍 Smoke test — ${new Date().toISOString()}\n`);

  // 1. Health check
  await record("GET /health returns ok", async () => {
    const data = await fetchJson(`${BACKEND_URL}/health`);
    if (data.status !== "ok")
      throw new Error(
        `Status: ${data.status}, checks: ${JSON.stringify(data.checks)}`,
      );
    if (data.checks.database !== "ok") throw new Error("Database down");
    if (data.checks.email === "not_configured")
      throw new Error("Email not configured");
  });

  // 2. Admin login
  await record("Admin user can log in", async () => {
    if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD env var not set");
    const data = await fetchJson(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!data.success) throw new Error("Login failed");
    const roles = data.user.roles || [];
    const adminRole = roles.find((r: any) => r.roleName === "admin");
    if (!adminRole) throw new Error("No admin role found");
    if (adminRole.status !== "approved")
      throw new Error(`Admin role is ${adminRole.status}, expected approved`);
  });

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log(
    `\n─── Results: ${passed}/${results.length} passed, ${failed} failed (${totalDuration}ms) ───\n`,
  );

  if (failed > 0 && SLACK_WEBHOOK) {
    const failedList = results
      .filter((r) => !r.passed)
      .map((r) => `❌ ${r.name}: ${r.error}`)
      .join("\n");
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 casa-mx-backend smoke test FAILED:\n${failedList}`,
      }),
    }).catch(() => {});
  }

  process.exit(exitCode);
}

main();
