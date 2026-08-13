# Test tags

Every test carries tags so you can run a slice of the suite instead of all 68 tests
(~43 min serial). Tags are Playwright's native `tag` option, so they work with
`--grep` / `--grep-invert` and show up in the HTML report.

## The tags

| Tag | Tests | What it means |
|---|---|---|
| `@regression` | 68 | The whole suite. Every test has it — this is the default full run. |
| `@smoke` | 12 | Thin critical path: can you log in, load each module, and create/delete in it. |
| `@login` | 9 | `login.spec.ts` |
| `@dashboard` | 4 | `dashboard.spec.ts` |
| `@notes` | 21 | `notes.spec.ts` |
| `@tasks` | 32 | `tasks.spec.ts` |
| `@pulse` | 2 | `pulse.spec.ts` |
| `@known-issue` | 1 | Fails for a known *product* reason, not flake. See below. |

`@smoke` is a subset of `@regression`, so a `@regression` run includes the smoke
tests. Module tags are one-per-file, so `@notes` and `@tasks` sum with the others
to the full 68.

## Running them

    npm run test:smoke        # 12 tests, the fast confidence check
    npm run test:regression   # all 68
    npm run test:notes        # notes only (file-scoped, unchanged)
    npm run test:tasks        # tasks only (file-scoped, unchanged)
    npm run test:dashboard
    npm run test:pulse
    npm run test:stable       # everything except @known-issue

Or directly:

    npx playwright test --grep @smoke
    npx playwright test --grep-invert @known-issue
    npx playwright test --grep "@notes|@tasks"     # regex: either

From CI, use the Actions tab → *Playwright Tests* → *Run workflow*, and pick a
`tag`. Leaving it on `all` runs the full suite exactly as scheduled runs do.

## Adding a tag to a new test

Tags go in an options object between the title and the body:

    test('does the thing', { tag: '@smoke' }, async ({ page }) => { ... });

    test.describe('My module', { tag: ['@regression', '@mymodule'] }, () => { ... });

Tags on a `describe` are inherited by every test inside it, so a new test added to
an existing module file picks up `@regression` and its module tag automatically —
you only need to add `@smoke` if it belongs on the critical path.

**Every test must carry `@regression`.** That is what makes `test:regression` mean
"the whole suite" rather than "whatever happened to be tagged". If you add a new
spec file, tag its top-level describe with `@regression` plus a new module tag,
and add the module here.

## `@known-issue`

`pulse.spec.ts` → *schedule an event inside a pulse, then delete it* is tagged
`@known-issue` for **TM2-T015**. It fails whenever the run starts inside
22:31–23:59 PHT — that is the product bug firing, and it has never survived that
window in 40 recorded executions. It is not flake.

Do **not** "stabilise" it with a wait, a retry, or `test.skip`. The tag exists so
you can exclude it deliberately (`npm run test:stable`) while leaving the failure
visible in the full run, which is what keeps the ticket honest. Remove the tag
when TM2-T015 is fixed.

## Caveat: `--grep` matches titles too

Playwright's `--grep` is a regex over the test title *and* its tags, not tags
alone. A test whose title contains an `@`-word can be picked up by a tag filter
that was not meant for it. Keep `@` out of test titles.
