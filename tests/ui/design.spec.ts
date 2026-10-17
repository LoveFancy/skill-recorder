import { test, expect } from './test';
const prototype = '/docs/design/skill-generation-wireframes/index-v12.html';

test('design prototype gates publishing by source approval and destination', async ({ page }) => {
  await page.goto(`${prototype}#setup`);
  await expect(page.getByRole('button', { name: '生成 SOP', exact: true })).toBeEnabled();
  await expect(page.locator('#confirm')).toHaveCount(0);
  await page.getByRole('button', { name: '生成 SOP', exact: true }).click();
  await page.getByRole('button', { name: '演示：处理完成' }).click();
  await page.locator('#confirm').check();
  await page.getByRole('button', { name: '确认并保存，去发布' }).click();
  await page.locator('#confirm').check();
  await expect(page.getByRole('button', { name: '发布到飞书文档', exact: true })).toBeDisabled();
  await page.locator('#destination').selectOption('sales');
  await page.getByRole('button', { name: '发布到飞书文档', exact: true }).click();
  await page.getByRole('button', { name: '演示：处理完成' }).click();
  await expect(page.getByRole('heading', { name: '已发布，可以分享了' })).toBeVisible();
  await page.getByRole('button', { name: '复制链接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('示例链接');
});

test('design publishing layout has no overflow and preserves mobile summary', async ({ page }, testInfo) => {
  await page.goto(`${prototype}#publish`);
  await expect(page.getByRole('button', { name: '发布到飞书文档', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.workspace').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  if (testInfo.project.name === 'narrow') {
    await page.getByText('查看本次发布内容', { exact: true }).click();
    await expect(page.locator('.summary-mobile .publish-summary')).toBeVisible();
  }
});
