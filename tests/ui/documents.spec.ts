import { test, expect } from './test';
const fixture = '/tests/ui/fixtures/';

test('SOP is one click; manual retains its source confirmation', async ({ page }) => {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: '生成 SOP', exact: true })).toBeEnabled();
  await expect(page.locator('.doc-customization, .doc-source-confirmation')).toHaveCount(0);
  await expect(page.getByLabel('适用读者')).toHaveCount(0);
  await page.goto(`${fixture}?kind=manual`);
  await expect(page.getByRole('button', { name: '生成覆盖目录', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: '生成覆盖目录', exact: true })).toBeEnabled();
  await page.goto(`${fixture}?kind=manual&confirmed=1`);
  await expect(page.getByRole('button', { name: '生成覆盖目录', exact: true })).toBeEnabled();
  await expect(page.locator('.doc-source-confirmation')).toHaveCount(0);
});

test('SOP generates once, preserves defaults, reviews, exports and retains history', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  await page.getByRole('button', { name: '生成 SOP', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑与审核', exact: true })).toBeVisible();
  const requests = await page.evaluate(() => (window as any).__uiTest.calls.filter((c: any) => c.kind === 'generate'));
  expect(requests).toHaveLength(1);
  expect(requests[0].request).toMatchObject({ kind: 'sop', audience: '业务操作者', scope: '本次录制及已确认材料覆盖的任务与功能' });
  await page.getByRole('button', { name: '确认内容并保存', exact: true }).click();
  await page.getByRole('button', { name: '导出文档', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已导出：/synthetic/document.md');
  const history = page.getByLabel('已保存文档与历史版本');
  await expect(history.locator('option')).toHaveCount(3);
  await history.selectOption({ index: 2 });
  await expect(page.getByText('历史版本只读；选择最新版本后可编辑或导出。')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认内容并保存', exact: true })).toBeDisabled();
});

test('manual requires directory approval before generating body', async ({ page }) => {
  await page.goto(`${fixture}?kind=manual&confirmed=1`);
  await page.getByLabel('适用读者').fill('新入职同事');
  await page.getByRole('button', { name: '生成覆盖目录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '审核目录与覆盖范围' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认内容并保存', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__uiTest.calls.some((c: any) => c.kind === 'outline'))).toBe(false);
  await page.getByRole('button', { name: '确认目录并生成正文', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑与审核', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__uiTest.calls.filter((c: any) => c.kind === 'outline').length)).toBe(1);
});

test('generation failure is recoverable without implicit retries', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  await page.evaluate(() => { (window as any).__uiTest.failNext = 'generate'; });
  await page.getByRole('button', { name: '生成 SOP', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('生成服务不可用');
  expect(await page.evaluate(() => (window as any).__uiTest.calls.filter((c: any) => c.kind === 'generate').length)).toBe(1);
  await page.getByRole('button', { name: '生成 SOP', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑与审核', exact: true })).toBeVisible();
});

test('canceling generation restores the action without creating a document', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  await page.evaluate(() => { (window as any).__uiTest.holdGeneration = true; });
  await page.getByRole('button', { name: '生成 SOP', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成 SOP', exact: true })).toHaveCount(0);
  await expect(page.locator('.doc-customization, .doc-source-confirmation')).toHaveCount(0);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成 SOP', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__uiTest.documents.length)).toBe(0);
});

test('generation footer stays in viewport without horizontal overflow', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  const button = page.getByRole('button', { name: '生成 SOP', exact: true });
  await expect(button).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
