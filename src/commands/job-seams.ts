// Test seams for the job commands (extract, kit, wait): the fake Taste Engine seeded from the recorded
// fixtures, an instant sleep and a clock that only moves when the poller sleeps.
import { fixtureState, loadFixtures } from "../api/fixtures.ts";
import { createFakeApi } from "../api/fake-api.ts";
import type { FakeApi, FakeState } from "../api/fake-api.ts";
import { SUBMISSION_RESULT } from "../api/schemas.ts";
import type { SubmissionResult } from "../api/schemas.ts";
import type { Io } from "../io.ts";

const fixtures = loadFixtures();

function recorded(recipe: string): SubmissionResult {
  return SUBMISSION_RESULT.parse(fixtures[recipe]?.data.result);
}

function jobSeams(state: Partial<FakeState> = {}, overrides: Partial<Io> = {}) {
  const api: FakeApi = createFakeApi({ ...fixtureState(fixtures), ...state });
  let now = 0;
  const io: Partial<Io> = {
    api,
    now: () => now,
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
    ...overrides,
  };
  return { api, io };
}

export { fixtures, jobSeams, recorded };
