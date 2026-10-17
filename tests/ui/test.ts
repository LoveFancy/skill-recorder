import { test as base, expect } from '@playwright/test';
import { installMockIPC } from './fixtures/mock-ipc';

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Browser tests can only reach the local fixture server, including prototype pages.
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await installMockIPC(page);
    await use(page);
    expect(errors, 'uncaught browser errors').toEqual([]);
  },
});
export { expect };
