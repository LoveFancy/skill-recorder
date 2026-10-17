import { test, expect } from './test';
import type { Page } from '@playwright/test';

const fixture = '/tests/ui/fixtures/?view=library&skill=1#library';
async function openPublishing(page: Page) {
  await page.getByRole('button', { name: /4 发布与分享/ }).click();
  await expect(page.getByRole('heading', { name: '让这份成果被使用' })).toBeVisible();
}
async function seedDocument(page: Page, kind: 'sop' | 'manual' = 'sop') {
  await page.evaluate(async kind => {
    const api = (window as any).skillRecorder;
    let r = await api.document({ kind: 'generate', sessionId: 'synthetic-recording', request: { kind, audience: '读者', scope: '录制范围' } });
    if (!r.document.artifact.content) r = await api.document({ kind: 'outline', sessionId: 'synthetic-recording', artifactId: r.document.artifact.id, revision: 1, outline: r.document.artifact.outline });
    await api.document({ kind: 'edit', sessionId: 'synthetic-recording', artifactId: r.document.artifact.id, revision: r.document.artifact.revision, content: r.document.artifact.content, reviewed: true });
  }, kind);
}

test('publishing without an artifact offers generation without making model requests', async ({ page }) => {
  await page.goto(fixture);
  await openPublishing(page);
  await expect(page.getByRole('heading', { name: '先生成一份成果' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^发布到/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__uiTest.calls.every((c: any) => c.kind === 'list'))).toBe(true);
  await page.getByRole('button', { name: '去生成', exact: true }).click();
  await expect(page.getByRole('button', { name: /SOP 操作说明/ })).toBeVisible();
});

test('reviewed documents expose only document channels and never publish', async ({ page }, testInfo) => {
  await page.goto(fixture);
  await seedDocument(page);
  await seedDocument(page, 'manual');
  await openPublishing(page);
  const workspace = page.locator('.publication-workspace');
  await expect(workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /飞书云文档/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /SkillHub|Workmate/ })).toHaveCount(0);
  await workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /Wiki 知识库/ }).click();
  await expect(page.getByLabel('知识库平台')).toHaveValue('飞书知识库');
  await expect(page.getByLabel('知识空间与父页面')).toBeDisabled();
  await page.getByLabel('发布标题').fill('新的分享标题');
  await expect(workspace.getByRole('button', { name: '发布到Wiki 知识库', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await expect(page.getByText('暂无发布记录。渠道接入后，这里将显示远端版本与分享链接。')).toBeVisible();
  const choices = page.getByLabel('本次产物', { exact: true });
  // One latest revision per artifact, rather than generated + reviewed history duplicates.
  await expect(choices.locator('option')).toHaveCount(2);
  await choices.selectOption({ index: 1 });
  await expect(page.getByLabel('发布标题')).toHaveValue('网页回复邮件');
  await expect(workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /飞书云文档/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('目标文件夹')).toHaveValue('');
  const generateCount = await page.evaluate(() => (window as any).__uiTest.calls.filter((c: any) => c.kind === 'generate').length);
  expect(generateCount).toBe(2);
  expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(workspace.getByRole('button', { name: '发布到飞书云文档', exact: true })).toBeInViewport({ ratio: 1 });
  if (testInfo.project.name === 'narrow') {
    await page.getByText('查看本次发布内容', { exact: true }).click();
    await expect(page.locator('.publication-summary-mobile').getByLabel('本次发布摘要')).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('publishing.png') });
});

test('save failures keep the user on the document without implying publication', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: /3 生成/ }).click();
  await page.getByRole('button', { name: /SOP 操作说明/ }).click();
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.evaluate(() => { (window as any).__uiTest.failNext = 'edit'; });
  await page.getByRole('button', { name: '确认并保存，去发布', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.publication-workspace')).toHaveCount(0);
  await expect(page.getByRole('article', { name: '生成的文档' })).toBeVisible();
});

test('saving a document enters publishing with its exact reviewed revision', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: /3 生成/ }).click();
  await page.getByRole('button', { name: /SOP 操作说明/ }).click();
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存，去发布', exact: true }).click();
  await expect(page.getByRole('heading', { name: '让这份成果被使用' })).toBeVisible();
  await expect(page.getByLabel('本次产物', { exact: true })).toContainText('修订 2');
  await page.getByRole('button', { name: '返回生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步：发布与分享', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__uiTest.calls.filter((c: any) => c.kind === 'generate').length)).toBe(1);
});

test('saved skills route to skill platforms and switching to documents clears configuration', async ({ page }) => {
  await page.goto(fixture);
  await seedDocument(page);
  await page.getByRole('button', { name: /3 生成/ }).click();
  await page.getByRole('button', { name: /通用 Skill/ }).click();
  await page.getByRole('button', { name: '生成 Skill', exact: true }).click();
  await page.getByRole('button', { name: '导出技能', exact: true }).click();
  await page.getByRole('button', { name: '下一步：发布与分享', exact: true }).click();
  const workspace = page.locator('.publication-workspace');
  await expect(workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /SkillHub/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /飞书云文档|Wiki 知识库/ })).toHaveCount(0);
  await workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /Workmate/ }).click();
  await page.getByLabel('可见范围', { exact: true }).selectOption('link');
  await expect(page.getByRole('button', { name: '发布到Workmate', exact: true })).toBeDisabled();
  const selector = page.getByLabel('本次产物', { exact: true });
  await selector.selectOption({ index: 0 });
  await expect(workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /飞书云文档/ })).toBeVisible();
  await selector.selectOption('skill');
  await expect(page.getByLabel('可见范围', { exact: true })).toHaveValue('workspace');
  await expect(workspace.getByRole('group', { name: '发布渠道' }).getByRole('button', { name: /SkillHub/ })).toHaveAttribute('aria-pressed', 'true');
});
