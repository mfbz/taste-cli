import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { readRepoFile } from "./repo.ts";

type Step = { name?: string; run?: string };
type Workflow = {
  on: Record<string, { types?: string[] } | null>;
  jobs: Record<string, { steps?: Step[] }>;
};

const ci = parse(readRepoFile(".github", "workflows", "ci.yml")) as Workflow;

// The one required check: it passes only if every job it waits for passed or was skipped.
function gate(results: string): number | null {
  const script =
    ci.jobs.ci?.steps?.find((step) => step.name === "Every job passed")?.run ??
    "";
  return spawnSync("bash", ["-e", "-c", script], {
    env: { ...process.env, RESULTS: results },
  }).status;
}

describe("the CI workflow", () => {
  it("runs again when a pull request's title or description is edited (they become the squash commit)", () => {
    expect(ci.on.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened", "edited"])
    );
  });

  it("audits every dependency, development ones included: the SDK is one, and it ships in the bundle", () => {
    const audit =
      ci.jobs.checks?.steps?.find((step) => step.name === "Audit dependencies")
        ?.run ?? "";
    expect(audit).toContain("npm audit --audit-level=moderate");
    expect(audit).not.toContain("--omit=dev");
  });

  it("installs the packed CLI on every OS and checks that an unknown flag is a usage error (exit 2)", () => {
    const run = (ci.jobs.package?.steps ?? [])
      .map((s) => s.run ?? "")
      .join("\n");
    expect(run).toContain("taste --version");
    expect(run).toContain("taste --help");
    expect(run).toContain('[ "$code" -eq 2 ]');
  });

  // The script is bash, as on GitHub's runners; Windows machines may have none.
  it.skipIf(process.platform === "win32")(
    "passes the required check only when every job passed or was skipped",
    () => {
      expect(gate("success success success")).toBe(0);
      expect(gate("success skipped success")).toBe(0);
      // Jobs that never got a runner end as "abandoned": that is not a pass.
      for (const bad of ["failure", "cancelled", "abandoned", "timed_out"])
        expect(gate(`success ${bad} success`), bad).not.toBe(0);
      expect(gate(""), "no results").not.toBe(0);
    }
  );
});

describe("the release workflow", () => {
  const release = parse(
    readRepoFile(".github", "workflows", "release.yml")
  ) as Workflow;

  it("refuses to publish while the repository is private, before it builds anything", () => {
    const steps = release.jobs.build?.steps ?? [];
    const guard = steps.findIndex(
      (step) => step.name === "Refuse while the repository is private"
    );
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(steps[guard]?.run).toContain('[ "$PRIVATE" = false ]');
    expect(guard).toBeLessThan(
      steps.findIndex((step) => step.name === "Stamp the version")
    );
  });
});
