import path from 'path';
import { expect, test } from '@playwright/test';
import { DEFAULT_LOGIN_URL, VALID_PASSWORD, VALID_USERNAME } from '../credentials/loginCredentials';
import { LoginPage } from '../pages/LoginPage';
import { TasksPage } from '../pages/TasksPage';
import {
  LONG_DESCRIPTION,
  LONG_TITLE,
  TASK_DESCRIPTION,
  TASK_LIST_DESCRIPTION,
  TASK_LIST_TITLE,
  TASK_TITLE,
  UPDATED_TASK_DESCRIPTION,
  UPDATED_TASK_LIST_DESCRIPTION,
  UPDATED_TASK_LIST_TITLE,
  UPDATED_TASK_TITLE,
  uniqueTitle,
} from '../utils/tasksTestData';

function buildScreenshotPath(testInfo: any, outcome: 'passed' | 'failed') {
  const safeName = `${testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  return path.resolve(process.cwd(), 'screenshots', outcome, safeName);
}

/**
 * IMPORTANT: every test in this file reads/writes the Task and Task List
 * data of the SAME shared staging account, the same way tests/notes.spec.ts
 * does for Notes -- see that file's header comment for the full rationale.
 * Always run this file with a single worker: `npm run test:tasks` (which
 * passes --workers=1) or `npx playwright test tests/tasks.spec.ts --workers=1`.
 */
test.use({ video: 'off', trace: 'off' });

test.describe('My Tasks module automation', { tag: ['@regression', '@tasks'] }, () => {
  // Same combined login + onboarding-dismissal budget as notes.spec.ts /
  // pulse.spec.ts on this same slow staging environment.
  test.describe.configure({ timeout: 90000 });

  let tasksPage: TasksPage;
  // Titles created during a test are tracked here so afterEach can clean
  // them up, keeping the shared staging account free of leftover data --
  // mirrors notes.spec.ts's createdTitles.
  let createdTaskTitles: string[];
  let createdListTitles: string[];

  test.beforeAll(async ({ browser }) => {
    // Same reasoning as notes.spec.ts's beforeAll: guarantee a clean slate
    // once, up front, with its own much larger timeout, rather than having
    // any single test absorb an unpredictable amount of leftover mess from
    // a prior interrupted run.
    test.setTimeout(300000);

    const context = await browser.newContext();
    const page = await context.newPage();

    const loginPage = new LoginPage(page);
    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    const cleanupTasksPage = new TasksPage(page);
    await cleanupTasksPage.open();
    await cleanupTasksPage.deleteAllTasksAndLists();

    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    createdTaskTitles = [];
    createdListTitles = [];

    const loginPage = new LoginPage(page);
    await loginPage.goto(DEFAULT_LOGIN_URL);
    await loginPage.login(VALID_USERNAME, VALID_PASSWORD);
    await loginPage.assertLoginSuccess();

    tasksPage = new TasksPage(page);
    await tasksPage.open();
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Cleanup gets its own budget on top of the test's own -- see
    // notes.spec.ts's afterEach for the full rationale. It matters more here:
    // this teardown drains TWO collections (task lists, then tasks), and it
    // was a test in this file that blew the shared 90s limit inside afterEach
    // on run 30323518312 and cascaded into the beforeAll retry failures.
    testInfo.setTimeout(testInfo.timeout + 45000);

    // Same "reload back to a clean view before cleanup" reasoning as
    // notes.spec.ts's afterEach -- a stuck panel/dialog left open in an
    // invalid state should not be allowed to block cleanup.
    await tasksPage.reload().catch(() => undefined);

    for (const title of createdListTitles) {
      await tasksPage.deleteTaskListIfExists(title).catch((error) => {
        console.warn(`[tasks.spec] afterEach list cleanup failed for "${title}":`, error?.message ?? error);
      });
    }

    for (const title of createdTaskTitles) {
      await tasksPage.deleteTaskIfExists(title).catch((error) => {
        console.warn(`[tasks.spec] afterEach task cleanup failed for "${title}":`, error?.message ?? error);
      });
    }

    if (testInfo.status === 'passed') {
      return;
    }

    const screenshotPath = buildScreenshotPath(testInfo, 'failed');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('tasks-page-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test.describe('Navigation', () => {
    test('My Tasks page loads successfully from the sidebar', { tag: '@smoke' }, async () => {
      // beforeEach already navigated to My Tasks; assert the "Add Task" entry point.
      await tasksPage.assertTasksPageLoaded();
    });

    test('"Add Task" button exists and offers New Task / New List', async () => {
      await expect(tasksPage.addTaskButton).toBeVisible();
      await tasksPage.addTaskButton.click();
      await expect(tasksPage.newTaskMenuItem).toBeVisible();
      await expect(tasksPage.newListMenuItem).toBeVisible();
      await tasksPage.page.keyboard.press('Escape');
    });
  });

  test.describe('Task', () => {
    test.describe('Create', () => {
      test('user can create a task with a valid title and description', { tag: '@smoke' }, async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);

        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.assertTaskVisible(title);
      });

      test('newly created task persists after refreshing the page', async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);

        await tasksPage.createTask(title, TASK_DESCRIPTION);
        await tasksPage.assertTaskVisible(title);

        await tasksPage.reload();
        await tasksPage.assertTaskVisible(title);
      });

      test('user cannot save a completely empty task', async () => {
        await tasksPage.startNewTask();
        await tasksPage.assertCreateTaskDisabled();
      });

      test('user cannot save a task without a title (description only)', async () => {
        await tasksPage.startNewTask();
        await tasksPage.fillNewTaskDescription('Description without a title.');
        await tasksPage.assertCreateTaskDisabled();
      });

      /**
       * Documented deviation from the assumed spec, mirroring
       * notes.testplan.md's equivalent finding for Notes: a task CAN be
       * saved with a title and no description. Verified live via
       * Playwright MCP inspection on 2026-07-23 -- Create Task enables as
       * soon as a title is entered.
       */
      test('user can save a task with a title and no description (description is optional)', async () => {
        const title = uniqueTitle(`${TASK_TITLE} Title Only`);
        createdTaskTitles.push(title);

        await tasksPage.createTask(title);

        await tasksPage.assertTaskVisible(title);
      });

      test('long title and description input is handled without error', async ({}, testInfo) => {
        testInfo.setTimeout(testInfo.timeout + 30000);

        const title = uniqueTitle(LONG_TITLE);
        createdTaskTitles.push(title);

        await tasksPage.createTask(title, LONG_DESCRIPTION);

        await tasksPage.assertTaskVisible(title);
      });
    });

    test.describe('Read', () => {
      test('user can open an existing task and see the correct title and description', async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.openTask(title);

        await expect(tasksPage.page.getByRole('heading', { level: 5, name: title, exact: true })).toBeVisible();
        await expect(tasksPage.taskDescriptionText(TASK_DESCRIPTION)).toBeVisible({ timeout: 15000 });
      });

      test('tasks persist and remain readable after a page refresh', async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.reload();

        await tasksPage.openTask(title);
        await expect(tasksPage.taskDescriptionText(TASK_DESCRIPTION)).toBeVisible({ timeout: 15000 });
      });

      test('a large task renders its full description correctly when opened', async ({}, testInfo) => {
        testInfo.setTimeout(testInfo.timeout + 30000);

        const title = uniqueTitle(`${TASK_TITLE} Large`);
        createdTaskTitles.push(title);
        await tasksPage.createTask(title, LONG_DESCRIPTION);

        await tasksPage.openTask(title);

        await expect(tasksPage.taskDescriptionText(LONG_DESCRIPTION)).toBeVisible({ timeout: 15000 });
      });

      /**
       * Self-contained the same way notes.spec.ts's equivalent test is:
       * clears any leftover items first rather than assuming the account
       * already happens to be empty when this test runs.
       */
      test('empty state is displayed when no tasks or task lists exist', async () => {
        await tasksPage.deleteAllTasksAndLists();

        await expect(tasksPage.emptyState).toBeVisible({ timeout: 15000 });
        await expect(tasksPage.emptyStateTaskCard).toBeVisible({ timeout: 15000 });
        await expect(tasksPage.emptyStateTaskListCard).toBeVisible({ timeout: 15000 });
      });
    });

    test.describe('Update', () => {
      test('user can edit the title of an existing task', async () => {
        const title = uniqueTitle(TASK_TITLE);
        const updatedTitle = uniqueTitle(UPDATED_TASK_TITLE);
        createdTaskTitles.push(title, updatedTitle);

        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.editTask(title, { title: updatedTitle });

        await tasksPage.assertTaskVisible(updatedTitle);
        await tasksPage.assertTaskNotVisible(title);
      });

      test('user can edit the description of an existing task', async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.editTask(title, { description: UPDATED_TASK_DESCRIPTION });

        await tasksPage.openTask(title);
        await expect(tasksPage.taskDescriptionText(UPDATED_TASK_DESCRIPTION)).toBeVisible({
          timeout: 15000,
        });
      });

      test('updated title and description persist after refreshing the page', async () => {
        const title = uniqueTitle(TASK_TITLE);
        const updatedTitle = uniqueTitle(UPDATED_TASK_TITLE);
        createdTaskTitles.push(title, updatedTitle);

        await tasksPage.createTask(title, TASK_DESCRIPTION);
        await tasksPage.editTask(title, { title: updatedTitle, description: UPDATED_TASK_DESCRIPTION });

        await tasksPage.reload();

        await tasksPage.openTask(updatedTitle);
        await expect(tasksPage.taskDescriptionText(UPDATED_TASK_DESCRIPTION)).toBeVisible({
          timeout: 15000,
        });
      });

      /**
       * Assumption carried over by analogy from Notes' identical rule (Save
       * disabled once the title is cleared) -- not independently re-verified
       * live for Task specifically. If this assumption is wrong, this test
       * will fail fast and should be corrected to match actual behavior.
       */
      test('user cannot save an existing task after clearing its title', async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.openTask(title);
        await tasksPage.clearOpenTaskTitle();

        await tasksPage.assertEditTaskSaveDisabled();
      });
    });

    test.describe('Delete', () => {
      test('confirmation appears when deleting a task', async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.openTask(title);
        await tasksPage.panelActionButtons.nth(1).click();

        await expect(tasksPage.deleteWarningHeading).toBeVisible();
        await expect(tasksPage.deleteWarningMessage).toBeVisible();

        // Leave the task intact for afterEach cleanup by cancelling here.
        await tasksPage.deleteWarningCancelButton.click();
      });

      test('user can cancel a delete and the task remains', async () => {
        const title = uniqueTitle(TASK_TITLE);
        createdTaskTitles.push(title);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.deleteTaskThenCancel(title);

        await tasksPage.assertTaskVisible(title);
      });

      test('user can confirm deletion and the task disappears from the list', { tag: '@smoke' }, async () => {
        const title = uniqueTitle(TASK_TITLE);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.deleteTask(title);

        await tasksPage.assertTaskNotVisible(title);
      });

      test('refreshing the page does not restore a deleted task', async () => {
        const title = uniqueTitle(TASK_TITLE);
        await tasksPage.createTask(title, TASK_DESCRIPTION);

        await tasksPage.deleteTask(title);
        await tasksPage.assertTaskNotVisible(title);

        await tasksPage.reload();

        await tasksPage.assertTaskNotVisible(title);
      });
    });
  });

  test.describe('Task List', () => {
    test.describe('Create', () => {
      test('user can create a task list with a valid title and description', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        createdListTitles.push(title);

        // createTaskList() already reloads internally (see
        // EMPTY_LIST_RENDER_RELOAD_MS in TasksPage.ts) so this assertion is
        // exercising the real, persisted, post-reload state.
        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);

        await tasksPage.assertTaskListVisible(title);
      });

      test('newly created task list persists after a second refresh', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        createdListTitles.push(title);

        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);
        await tasksPage.assertTaskListVisible(title);

        await tasksPage.reload();
        await tasksPage.assertTaskListVisible(title);
      });

      test('user cannot save a completely empty task list', async () => {
        await tasksPage.startNewTaskList();
        await tasksPage.assertCreateListDisabled();
      });

      test('user cannot save a task list without a title (description only)', async () => {
        await tasksPage.startNewTaskList();
        await tasksPage.fillNewTaskListDescription('Description without a title.');
        await tasksPage.assertCreateListDisabled();
      });

      test('user can save a task list with a title and no description (description is optional)', async () => {
        const title = uniqueTitle(`${TASK_LIST_TITLE} Title Only`);
        createdListTitles.push(title);

        await tasksPage.createTaskList(title);

        await tasksPage.assertTaskListVisible(title);
      });
    });

    test.describe('Update', () => {
      test('user can rename an existing task list', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        const updatedTitle = uniqueTitle(UPDATED_TASK_LIST_TITLE);
        createdListTitles.push(title, updatedTitle);

        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);

        await tasksPage.renameTaskList(title, updatedTitle);

        await tasksPage.assertTaskListVisible(updatedTitle);
        await tasksPage.assertTaskListNotVisible(title);
      });

      test('renamed task list persists after refreshing the page', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        const updatedTitle = uniqueTitle(UPDATED_TASK_LIST_TITLE);
        createdListTitles.push(title, updatedTitle);

        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);
        await tasksPage.renameTaskList(title, updatedTitle);

        await tasksPage.reload();

        await tasksPage.assertTaskListVisible(updatedTitle);
      });

      /**
       * Same "assumption by analogy, not independently re-verified" caveat
       * as the equivalent Task test above.
       */
      test('user cannot save an existing task list after clearing its title', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        createdListTitles.push(title);
        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);

        await tasksPage.openTaskListTitleForEdit(title);
        await tasksPage.clearOpenTaskListTitle();

        await tasksPage.assertRenameListSaveDisabled();
      });
    });

    test.describe('Delete', () => {
      test('confirmation appears when deleting a task list', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        createdListTitles.push(title);
        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);

        await tasksPage.taskListDeleteButton(title).click();

        await expect(tasksPage.deleteTaskListHeading).toBeVisible();
        await expect(tasksPage.deleteTaskListMessage).toBeVisible();

        // Leave the list intact for afterEach cleanup by cancelling here.
        await tasksPage.deleteTaskListCancelButton.click();
      });

      test('user can cancel a delete and the task list remains', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        createdListTitles.push(title);
        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);

        await tasksPage.deleteTaskListThenCancel(title);

        await tasksPage.assertTaskListVisible(title);
      });

      test('user can confirm deletion and the task list disappears from the list', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);

        await tasksPage.deleteTaskList(title);

        await tasksPage.assertTaskListNotVisible(title);
      });

      test('refreshing the page does not restore a deleted task list', async () => {
        const title = uniqueTitle(TASK_LIST_TITLE);
        await tasksPage.createTaskList(title, TASK_LIST_DESCRIPTION);

        await tasksPage.deleteTaskList(title);
        await tasksPage.assertTaskListNotVisible(title);

        await tasksPage.reload();

        await tasksPage.assertTaskListNotVisible(title);
      });
    });
  });
});
