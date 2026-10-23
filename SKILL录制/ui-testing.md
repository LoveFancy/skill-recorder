# 页面自动化测试：Playwright

项目页面回归统一入口为 `npm run test:ui`。测试加载真实 React 组件及应用 CSS，在浏览器中执行；Electron IPC 通过浏览器初始化脚本提供合成替身。发布设计稿也纳入独立用例。测试不启动 Electron 主进程、不读取个人配置、不调用 Claude/MCP，不发布真实文档。

## 安装与运行

沿用项目 Node/npm 版本要求，先安装依赖，再安装测试浏览器：

```sh
npm ci
npm run test:ui:install
npm run typecheck:ui
npm run test:ui
```

Linux 首次运行可用 `npx playwright install --with-deps chromium` 安装系统依赖。CI 已配置该步骤。

macOS/Windows 已安装 Chrome 时，可直接复用系统浏览器，避免额外下载 Chromium（环境变量语法按 shell 调整）：

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:ui
```

常用命令：

```sh
npm run test:ui -- --project=chromium tests/ui/library.spec.ts
npm run test:ui -- --project=narrow
npm run test:ui:headed
npm run test:ui:debug
npm run test:ui:report
```

默认使用 `127.0.0.1:4178` 的专用 Vite 服务，不加载项目 Electron 启动插件。端口被占用时明确失败，不复用不明服务；可设置 `PLAYWRIGHT_PORT` 改端口。Playwright 管理测试服务生命周期，测试退出后回收。每个用例独立浏览器上下文，IPC 状态和文档修订互不污染。

## 覆盖范围

| 用例文件 | 检查内容 |
| --- | --- |
| `tests/ui/documents.spec.ts` | SOP/手册直接生成、SOP 默认配置、内容审核、模拟导出、历史版本只读、手册直接显示完整 Markdown、生成失败及显式重试、取消、底栏可见与横向溢出 |
| `tests/ui/skill.spec.ts` | 一键生成完整 Skill、正文失败重试、两阶段取消、预览精确导出、调整内容使旧预览失效 |
| `tests/ui/library.spec.ts` | 真实 Library 中通过产物选择器连续切换手册/SOP、切换不自动生成 |
| `tests/ui/publish.spec.ts` | 产品第四步入口、无成果状态、文档/技能渠道分流、真实保存修订、保存失败不跳转、切换清除配置、未接入禁用、窄屏摘要与底栏 |
| `tests/ui/design.spec.ts` | v12 合成设计稿的生成审核发布流程、目标位置门槛、示例链接复制、窄窗口摘要、文档/技能发布渠道分流及切换后确认清除 |

桌面项目为 1280×900；窄窗口项目为 480×800，仍是桌面 Chromium，针对 Electron 窄窗口，不冒称手机设备或 WebKit 验证。当前共 36 次执行（桌面 21，窄窗口 15）。

## 失败定位与断言约定

- 默认无重试，本地失败直接暴露；CI 最多重试一次，HTML 报告保留 flaky 标记。
- 失败截图和 trace 在 `test-results/playwright/`，HTML 报告在 `playwright-report/`，都不提交 Git。CI 上传并保留 14 天。
- trace 可用 `npx playwright show-trace <trace.zip>` 打开；请求、DOM 快照和点击动作一起检查。
- 优先按角色、标签及可见文本定位；等待 `expect` 的状态断言，不用固定 sleep。
- 不把截图“文件生成成功”当布局测试。底部按钮可见、无水平溢出等用浏览器几何断言验证；视觉截图用于审阅和定位。此处尚未建立跨平台像素基准。
- 新增流程应测试用户实际入口，例如切换回归必须走 Library，不能只挂载独立文档组件。
- 合成 IPC 返回结构化产物，关键调用计数通过 `window.__uiTest.calls` 检查；不得给生产代码添加测试全局。
- 用例只允许访问专用本地服务。测试页面的未捕获 JavaScript 异常会导致失败。

## 与原测试的关系及边界

原 `test:documents-ui`、`test:auto-analysis-ui`、`test:settings-ui` 暂保留为 JSDOM 快速检查；它们仍需要外部 JSDOM 路径，不是新 Playwright 测试的前置条件。单元/后端测试入口 `npm test` 保留，浏览器测试由独立 CI 工作流执行。

这组测试验证渲染与交互契约；模拟导出不证明系统保存对话框可用，模拟模型不证明生成质量，设计稿发布成功不证明实际渠道已接通。Electron preload/IPC、真实 Claude 质量、第三方发布与安装仍需对应的集成验收。

配置见 `playwright.config.ts`，浏览器夹具见 `tests/ui/fixtures/`，CI 见 `.github/workflows/ui.yml`。
