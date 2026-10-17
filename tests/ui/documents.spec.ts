import { test, expect } from './test';
const fixture = '/tests/ui/fixtures/';

test('documents generate directly without a source or plan confirmation step', async ({ page }) => {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: '生成', exact: true })).toBeEnabled();
  await expect(page.locator('.doc-source-confirmation')).toHaveCount(0);
  await expect(page.getByLabel('适用读者')).toHaveCount(0);
  await page.goto(`${fixture}?kind=manual`);
  await expect(page.getByRole('button', { name: '生成', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('SOP generates once, preserves defaults, reviews, exports and retains history', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SOP 操作说明', exact: true })).toBeVisible();
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

test('manual directly produces readable Markdown with the chosen reader', async ({ page }) => {
  await page.goto(`${fixture}?kind=manual`);
  await page.getByLabel('适用读者').fill('新入职同事');
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await expect(page.getByRole('article', { name: '生成的文档' })).toContainText('填写回复内容');
  await expect(page.getByRole('button', { name: '确认内容并保存', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__uiTest.calls.some((c: any) => c.kind === 'outline'))).toBe(false);
  const request = await page.evaluate(() => (window as any).__uiTest.calls.find((c: any) => c.kind === 'generate'));
  expect(request.request.audience).toBe('新入职同事');
});

test('generation failure is recoverable without implicit retries', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  await page.evaluate(() => { (window as any).__uiTest.failNext = 'generate'; });
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('生成服务不可用');
  expect(await page.evaluate(() => (window as any).__uiTest.calls.filter((c: any) => c.kind === 'generate').length)).toBe(1);
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SOP 操作说明', exact: true })).toBeVisible();
});

test('canceling generation restores the action without creating a document', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  await page.evaluate(() => { (window as any).__uiTest.holdGeneration = true; });
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成', exact: true })).toHaveCount(0);
  await expect(page.locator('.doc-customization, .doc-source-confirmation')).toHaveCount(0);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__uiTest.documents.length)).toBe(0);
});

test('generation footer stays in viewport without horizontal overflow', async ({ page }) => {
  await page.goto(`${fixture}?confirmed=1`);
  const button = page.getByRole('button', { name: '生成', exact: true });
  await expect(button).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
