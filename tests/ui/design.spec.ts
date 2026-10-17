import { test, expect } from './test';
const prototype = '/docs/design/skill-generation-wireframes/index-v12.html';

test('original design entry includes an interactive publishing flow', async ({ page }) => {
  await page.goto('/docs/design/skill-generation-wireframes/index.html#saved');
  await page.getByRole('link', { name: '下一步：发布与分享', exact: true }).click();
  const publishing = page.frameLocator('iframe.publish-frame');
  await expect(publishing.locator('[data-channel="feishu"]')).toBeVisible();
  await publishing.locator('#output').selectOption('skill');
  await publishing.getByRole('button', { name: '下一步：发布与分享' }).click();
  await expect(publishing.locator('[data-channel="skillhub"]')).toBeVisible();
  await expect(publishing.locator('[data-channel="workmate"]')).toBeVisible();
  await page.getByRole('button', { name: '流程总览', exact: true }).click();
  await expect(page.locator('#publish-gallery .tile')).toHaveCount(7);
  await page.locator('#publish-gallery .tile').filter({ hasText: '发布 Skill：Workmate' }).click();
  await expect(publishing.locator('[data-channel="workmate"]')).toHaveAttribute('aria-pressed', 'true');
});

test('design routes documents to knowledge destinations and skills to skill platforms', async ({ page }) => {
  await page.goto(`${prototype}#publish`);
  await expect(page.locator('[data-channel="feishu"]')).toBeVisible();
  await expect(page.locator('[data-channel="wiki"]')).toBeVisible();
  await expect(page.locator('[data-channel="skillhub"], [data-channel="workmate"]')).toHaveCount(0);
  await page.locator('#output').selectOption('skill');
  await page.getByRole('button', { name: '下一步：发布与分享' }).click();
  await expect(page.locator('[data-channel="skillhub"]')).toBeVisible();
  await expect(page.locator('[data-channel="workmate"]')).toBeVisible();
  await expect(page.locator('[data-channel="feishu"], [data-channel="wiki"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发布到SkillHub', exact: true })).toBeDisabled();
  await page.locator('#confirm').check();
  await expect(page.getByRole('button', { name: '发布到SkillHub', exact: true })).toBeEnabled();
  await page.locator('[data-channel="workmate"]').click();
  await expect(page.locator('#confirm')).not.toBeChecked();
  await page.locator('#output').selectOption('manual');
  await page.getByRole('button', { name: /4 发布/ }).click();
  await expect(page.getByRole('heading', { name: '先完成内容审核' })).toBeVisible();
  await page.locator('#scenario').selectOption('publish');
  await expect(page.locator('[data-channel="feishu"]')).toBeVisible();
  await expect(page.locator('#confirm')).not.toBeChecked();
  await expect(page.locator('#destination')).toHaveValue('');
});

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
