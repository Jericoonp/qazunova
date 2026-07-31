import { test as base } from '@playwright/test';
import { accountForWorker, type StagingAccount } from '../credentials/loginCredentials';

/**
 * The suite's shared `test` object.
 *
 * It adds ONE worker-scoped fixture, `account`: the staging account this
 * worker owns for the whole of its life. Every spec that signs in should
 * import `test` from here and use `account.username` / `account.password`
 * instead of the module-level VALID_USERNAME / VALID_PASSWORD constants --
 * those two are now only for the login suite's own credential assertions.
 *
 * Worker scope, not test scope, is the point: it means the account is picked
 * once per worker process and every test that worker runs stays on it, so the
 * "one account, one thing happening to it at a time" guarantee that the
 * destructive beforeAll hooks rely on still holds under parallelism.
 *
 * See credentials/loginCredentials.ts for how the pool is assembled and why
 * this is keyed on parallelIndex.
 */
export const test = base.extend<{}, { account: StagingAccount }>({
  account: [
    async ({}, use, workerInfo) => {
      await use(accountForWorker(workerInfo.parallelIndex));
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
export type { Page, Response } from '@playwright/test';
