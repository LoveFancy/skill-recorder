import { test, expect } from './test';

test('real Library survives manual → SOP → manual and returns from target picker', async ({ page }) => {
  await page.goto('/tests/ui/fixtures/?view=library#library');
  await page.getByRole('button', { name: /3 生成/ }).click();
  for (const kind of ['manual', 'sop', 'manual']) {
    const picker = page.locator('.workflow-stage:not([hidden]) .output-product-grid');
    await expect(picker.getByRole('button')).toHaveCount(3);
    await picker.getByRole('button', { name: kind === 'manual' ? /产品使用手册/ : /SOP 操作说明/ }).click();
    await expect(page.getByRole('heading', { name: kind === 'manual' ? '使用手册' : 'SOP 操作说明', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回产物选择', exact: true }).click();
  }
  expect(await page.evaluate(() => (window as any).__uiTest.calls.some((c: any) => c.kind === 'generate'))).toBe(false);
});
