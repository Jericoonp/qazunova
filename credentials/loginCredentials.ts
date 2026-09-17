function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in your shell or CI secrets before running the login suite.`
    );
  }

  return value;
}

export const DEFAULT_LOGIN_URL = requireEnv('LOGIN_PAGE_URL');
export const VALID_USERNAME = requireEnv('LOGIN_TEST_USER');
export const VALID_PASSWORD = requireEnv('LOGIN_TEST_PASSWORD');

export interface StagingAccount {
  username: string;
  password: string;
  /** The env var the username came from -- shows up in failure messages. */
  source: string;
}

/**
 * The pool of staging accounts available to run tests in parallel.
 *
 * WHY THIS EXISTS: notes.spec.ts and tasks.spec.ts bulk-clear their account
 * in beforeAll, and several tests assert on whole-list state ("empty state is
 * displayed when no notes exist"). Two workers sharing one account therefore
 * delete each other's fixtures mid-run. That -- not the config -- is what
 * pinned CI to `workers: 1` and made the suite cost the SUM of its 68 tests
 * (42.6 min on run 30604925581).
 *
 * Giving each worker its own account removes the shared mutable state, so
 * parallelism becomes safe. Slot N is claimed by the worker whose
 * `parallelIndex` is N (see utils/testFixtures.ts). parallelIndex -- not
 * workerIndex -- is deliberate: Playwright starts a fresh worker after a
 * failure, and only parallelIndex is stable across that restart, so the
 * replacement worker reclaims the same account instead of colliding with a
 * live one.
 *
 * SLOTS 2 AND 3 ARE THE EXISTING firefox/webkit ACCOUNTS. The browser matrix
 * is chromium-only by default (see playwright.config.ts), so those two
 * accounts sit idle; the _2/_3 names are the canonical ones going forward and
 * the _FIREFOX/_WEBKIT names are accepted as a fallback so no new secrets are
 * needed today. In a genuine multi-browser run those accounts belong to the
 * other shards, so the workflow only wires slots 2 and 3 for single-browser
 * runs -- and buildPool() de-duplicates by username as a second line of
 * defence.
 */
const ACCOUNT_SLOTS: Array<{ userVars: string[]; passwordVars: string[] }> = [
  { userVars: ['LOGIN_TEST_USER'], passwordVars: ['LOGIN_TEST_PASSWORD'] },
  {
    userVars: ['LOGIN_TEST_USER_2', 'LOGIN_TEST_USER_FIREFOX'],
    passwordVars: ['LOGIN_TEST_PASSWORD_2', 'LOGIN_TEST_PASSWORD_FIREFOX'],
  },
  {
    userVars: ['LOGIN_TEST_USER_3', 'LOGIN_TEST_USER_WEBKIT'],
    passwordVars: ['LOGIN_TEST_PASSWORD_3', 'LOGIN_TEST_PASSWORD_WEBKIT'],
  },
];

function firstSet(names: string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = process.env[name];

    if (value) {
      return { name, value };
    }
  }

  return undefined;
}

function buildPool(): StagingAccount[] {
  const pool: StagingAccount[] = [];
  const claimed = new Set<string>();

  for (const slot of ACCOUNT_SLOTS) {
    const user = firstSet(slot.userVars);
    const password = firstSet(slot.passwordVars);

    // A slot needs BOTH halves. A username with no password is a
    // half-configured secret, not an account -- skip it here rather than fail
    // a worker later with a login error that looks like a product bug.
    if (!user || !password) {
      continue;
    }

    // Never hand the same account to two workers, whatever the env says.
    // Silent sharing would look exactly like product flakiness.
    if (claimed.has(user.value)) {
      continue;
    }

    claimed.add(user.value);
    pool.push({ username: user.value, password: password.value, source: user.name });
  }

  return pool;
}

export const ACCOUNT_POOL: StagingAccount[] = buildPool();

/**
 * How many tests can safely run at once. playwright.config.ts uses this as
 * the worker count, which makes "workers never exceed isolated accounts" an
 * invariant of the config rather than something each caller has to remember.
 */
export const ACCOUNT_POOL_SIZE = ACCOUNT_POOL.length;

export function accountForWorker(parallelIndex: number): StagingAccount {
  const account = ACCOUNT_POOL[parallelIndex];

  // Loud on purpose. Wrapping the index instead would hand one account to two
  // workers, and that resurfaces as unexplained data loss in an unrelated
  // test rather than as a configuration error.
  if (!account) {
    throw new Error(
      `No staging account for worker ${parallelIndex}: only ${ACCOUNT_POOL_SIZE} account(s) are configured ` +
        `(${ACCOUNT_POOL.map((entry) => entry.source).join(', ')}). ` +
        `Either run with --workers=${ACCOUNT_POOL_SIZE} or add LOGIN_TEST_USER_2/_3 + LOGIN_TEST_PASSWORD_2/_3.`
    );
  }

  return account;
}
