import { test, expect } from './test';
import type { Page } from '@playwright/test';

async function openSkill(page: Page) {
  await page.goto('/tests/ui/fixtures/?view=library&skill=1#library');
  await page.getByRole('button', { name: /3 生成/ }).click();
  await page.getByRole('button', { name: /通用 Skill/ }).click();
  await expect(page.getByRole('button', { name: '生成 Skill', exact: true })).toBeVisible();
}

test('one click produces the final Skill; saving uses that exact preview', async ({ page }) => {
  await openSkill(page);
  await page.getByRole('button', { name: '生成 Skill', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skill 已生成' })).toBeVisible();
  await expect(page.getByLabel('生成的 SKILL.md')).toContainText('读取用户指定的页面');
  await expect(page.locator('.skill-content-adjustments')).not.toHaveAttribute('open', '');
  const calls = await page.evaluate(() => (window as any).__uiTest.calls);
  expect(calls.filter((c: any) => c.kind === 'buildSkill')).toHaveLength(1);
  expect(calls.find((c: any) => c.kind === 'buildSkill').architecture).toBe('agent-skill');
  expect(calls.filter((c: any) => c.kind === 'prepareSkill')).toHaveLength(1);
  expect(calls.some((c: any) => c.kind === 'createSkill')).toBe(false);
  await page.getByRole('button', { name: '导出技能', exact: true }).click();
  await expect(page.getByRole('heading', { name: '技能已导出' })).toBeVisible();
  const saved = await page.evaluate(() => (window as any).__uiTest.calls.find((c: any) => c.kind === 'createSkill'));
  expect(saved.previewId).toBe('exact-skill-preview');
});

test('body failure does not expose a mandatory plan step or export a partial skill', async ({ page }) => {
  await openSkill(page);
  await page.evaluate(() => { (window as any).__uiTest.failNext = 'prepareSkill'; });
  await page.getByRole('button', { name: '生成 Skill', exact: true }).click();
  await expect(page.getByText('合成测试：正文生成失败', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成 Skill', exact: true })).toBeEnabled();
  await expect(page.locator('.sb-plan')).toHaveCount(0);
  await page.getByRole('button', { name: '生成 Skill', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skill 已生成' })).toBeVisible();
});

for (const stage of ['buildSkill', 'prepareSkill']) {
  test(`cancel during ${stage} stops the pipeline without saving`, async ({ page }) => {
    await openSkill(page);
    await page.evaluate(stage => { (window as any).__uiTest.holdSkill = stage; }, stage);
    await page.getByRole('button', { name: '生成 Skill', exact: true }).click();
    await expect.poll(() => page.evaluate(stage => (window as any).__uiTest.calls.some((c: any) => c.kind === stage), stage)).toBe(true);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__uiTest.calls.some((c: any) => c.kind === 'createSkill'))).toBe(false);
    if (stage === 'buildSkill') expect(await page.evaluate(() => (window as any).__uiTest.calls.some((c: any) => c.kind === 'prepareSkill'))).toBe(false);
  });
}

test('optional content changes invalidate the old preview before saving', async ({ page }) => {
  await openSkill(page);
  await page.getByRole('button', { name: '生成 Skill', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skill 已生成' })).toBeVisible();
  await page.getByText('调整技能内容（可选）', { exact: true }).click();
  await page.locator('.sb-title').click();
  await page.getByLabel('技能标题', { exact: true }).fill('重新整理页面');
  await page.getByLabel('技能标题', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: '导出技能', exact: true })).toBeDisabled();
  await expect(page.getByLabel('生成的 SKILL.md')).toHaveCount(0);
  await page.getByRole('button', { name: '重新生成 Skill', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: '导出技能', exact: true })).toBeEnabled();
  const requests = await page.evaluate(() => (window as any).__uiTest.calls.filter((c: any) => c.kind === 'prepareSkill'));
  expect(requests.at(-1).plan.title).toBe('重新整理页面');
});
