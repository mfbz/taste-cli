// A pull request is squash-merged with its title and description as the commit, so both get the
// commit-msg guards, and the title must be a conventional commit (it also becomes the release note).
// CI runs: PR_TITLE=… PR_BODY=… node tools/checks/pull-request.ts
import { checkMessage } from "./guards.ts";

const TYPES = "feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert";
const CONVENTIONAL = new RegExp(
  String.raw`^(?:${TYPES})(?:\([a-z0-9-]+\))?!?: \S.*$|^Revert ".+"$`
);

function checkPullRequest(title: string, body: string): string[] {
  const problems = CONVENTIONAL.test(title)
    ? []
    : [
        `title "${title}" is not a conventional commit (e.g. "feat(extract): wait for a running job")`,
      ];
  return [...problems, ...checkMessage(`${title}\n\n${body}`)];
}

if (import.meta.main) {
  const problems = checkPullRequest(
    process.env.PR_TITLE ?? "",
    process.env.PR_BODY ?? ""
  );
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exitCode = problems.length > 0 ? 1 : 0;
}

export { checkPullRequest };
