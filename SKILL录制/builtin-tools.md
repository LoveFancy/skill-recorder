# 内置工具与本地扩展

应用包含两个 MCP 服务，和用户全局 MCP / Skills 一起出现在智能处理的能力来源中。内置不代表自动访问：第一次在“刷新能力来源”后勾选、保存，并检查连接。用户本地特殊 MCP / Skill 的发现与加载方式保留。

## 浏览器

`recorder-browser` 通过随应用安装的 `playwright-core` 使用本机 Chrome，无需安装独立 MCP 或下载浏览器。首次实际调用才启动浏览器；浏览器资料保存在应用 processing/browser-profile，可在独立窗口手动登录。录制器不会接管用户正在浏览的标签页。

提供 navigate、snapshot、screenshot、click、fill。深度分析仅选择前三种读取能力。导航本身可能触发目标网站的行为，读取工具不等于对网站副作用的保证。

## 邮箱

`recorder-mail` 支持一个通用 IMAP/SMTP 账号。IMAP 使用 TLS（通常 993）；SMTP 使用隐式 TLS（465）或强制 STARTTLS（通常 587）。邮箱账号必须已开启对应服务，授权码由服务商提供。密码通过 Electron safeStorage 加密保存，设置响应、能力来源与录制结果不包含明文密码。

搜索和读取以只读模式打开邮箱，使用 UID，不设置已读状态。读取时获取最多 256KB 的原始邮件并解析正文，返回正文最多 50K 字符，不返回附件内容。发送通过独立 `mail_send` 工具提供；深度分析会在服务端可见列表和 Claude 工具拒绝列表中排除它。第一版不包含 OAuth 邮箱登录向导、多账号管理及附件发送。

## 任务调用

所有能力统一进入现有 capability snapshot。内置工具的读写属性由应用代码声明，第三方工具继续使用既有权限核验流程。任务只获得选中的工具；修改邮箱配置会改变来源哈希，必须刷新并保存后使用。关闭 MCP stdin 会释放浏览器和网络连接。

Claude 的模型连接复用全局认证存储，并从全局 settings.json 中仅提取认证令牌、API 地址及模型名称（包括自定义服务的 ANTHROPIC_AUTH_TOKEN）。不继承其他环境变量、hooks 或权限配置。显式环境变量优先。结构化输出使用当前 CLI 支持的 JSON Schema draft-07。旧任务重试时自动补齐独立设置文件；已成功创建的旧隔离会话若绑定变化，需要建立新任务。

## 验证

`npm run test:builtin-tools` 验证加密存储、来源选择和工具权限。`npm run test:builtin-mcp` 在已构建产物上执行 MCP 协议：使用真实 Chrome 验证导航、快照、截图；邮箱使用模拟传输验证 IMAP/SMTP 适配和真实 MIME 解析，不向真实收件人发送邮件。真实邮箱连接需用户配置账号后验证。
