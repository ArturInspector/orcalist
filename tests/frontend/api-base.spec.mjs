/**
 * Логика как в soltoken-frontend/js/formNew/steps.v2.js (API_BASE).
 * Запуск: npm run test:frontend
 */
import test from "node:test";
import assert from "node:assert/strict";

function resolveApiBase(metaContent, loc) {
  try {
    if (metaContent && String(metaContent).trim()) {
      return String(metaContent).trim().replace(/\/$/, "");
    }
    const port = Number(loc.port || (loc.protocol === "https:" ? 443 : 80));
    if (port === 3000) {
      return `${loc.protocol}//${loc.hostname}:8000`;
    }
    if (port === 80 || port === 443) {
      return "";
    }
    return "";
  } catch (_e) {
    return "";
  }
}

test("meta api-base wins", () => {
  assert.equal(
    resolveApiBase("http://127.0.0.1:8000/", { protocol: "http:", hostname: "x", port: "3000" }),
    "http://127.0.0.1:8000"
  );
});

test("port 3000 → same host :8000", () => {
  assert.equal(
    resolveApiBase("", { protocol: "http:", hostname: "127.0.0.1", port: "3000" }),
    "http://127.0.0.1:8000"
  );
  assert.equal(
    resolveApiBase("", { protocol: "http:", hostname: "localhost", port: "3000" }),
    "http://localhost:8000"
  );
});

test("443 / 80 → relative (nginx)", () => {
  assert.equal(resolveApiBase("", { protocol: "https:", hostname: "tokenx.run", port: "" }), "");
  assert.equal(
    resolveApiBase("", { protocol: "https:", hostname: "tokenx.run", port: "443" }),
    ""
  );
});

test("no bogus empty API_BASE from undefined loc (regression)", () => {
  // Раньше в steps.v2 был `loc` без объявления → catch → ""
  assert.doesNotThrow(() => resolveApiBase("", { protocol: "http:", hostname: "localhost", port: "3000" }));
});
