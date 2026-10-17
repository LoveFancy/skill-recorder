import { test, expect } from './test';

test('real Library survives manual → SOP → manual and returns from target picker', async ({ page }) => {
  await page.goto('/tests/ui/fixtures/?view=library#library');
  const output = page.getByLabel('本次产物');
  await page.getByRole('button', { name: /3 生成/ }).click();
  const picker = page.locator('.workflow-stage:not([hidden]) .output-product-grid');
  await expect(picker.getByRole('button')).toHaveCount(3);
  await expect(picker.getByRole('button', { name: /通用 Skill/ })).toBeVisible();
  await picker.getByRole('button', { name: /产品使用手册/ }).click();
  for (const kind of ['manual', 'sop', 'manual', 'sop']) {
    await output.selectOption(kind);
    const visible = page.locator('.workflow-stage:not([hidden])');
    await expect(visible.getByRole('heading', { name: kind === 'manual' ? '使用手册' : 'SOP 操作说明', exact: true })).toBeVisible();
    await expect(visible.getByRole('button', { name: kind === 'manual' ? '生成覆盖目录' : '生成 SOP', exact: true })).toBeVisible();
  }
  for (const kind of ['skill', 'undecided']) {
    await output.selectOption(kind);
    await expect(page.getByText('你希望基于这条录制创建什么？')).toBeVisible();
    await page.getByRole('button', { name: /产品使用手册/ }).click();
  }
  await output.selectOption('manual');
  await expect(page.getByRole('heading', { name: '使用手册', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__uiTest.calls.some((c: any) => c.kind === 'generate'))).toBe(false);
});
