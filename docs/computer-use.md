# Computer Use：复用上游 CLI

当前采用 [awlevin/typesafe-computer-use](https://github.com/awlevin/typesafe-computer-use) 的原版 Python CLI，独立安装在 Skill Recorder 同级目录。撤回未完成的自研 jev 适配器和示例命令。软件内入口尚未接入。

本次安装的上游提交为 `44ca11f0935b021b73020825da054b5c92cc1288`，包版本 `0.2.0`。上游源码没有修改，MIT 许可证随仓库保留。

## 本机使用

项目目录：`/Users/qinxiao/WorkSpace/open/typesafe-computer-use`。

```sh
cd /Users/qinxiao/WorkSpace/open/typesafe-computer-use
uv run --frozen python -m typesafe_computer_use --help
```

锁定依赖已安装在该项目自己的 `.venv`。配置文件 `.env` 已从上游示例创建，密钥为空，需要自行填写：

- `TYPESAFE_API_KEY`：必需，供 jev 决策使用。
- `ANTHROPIC_API_KEY`：可选，供默认 Writer 生成文字、提出 URL 和读取最终截图。也可按上游 `docs/writer-endpoints.md` 配置 OpenAI 兼容 Writer；Skill Recorder 的 AI 设置不会自动传入这个独立程序。
- `CLICKER_BROWSER`：可选，默认 `Google Chrome`。

macOS 还需要给运行终端授予录屏与辅助功能权限。

```sh
# 以下命令读取真实屏幕、请求模型并保存运行记录。
# 默认执行一次观察和决策，不点击或输入。
uv run --frozen python -m typesafe_computer_use "打开浏览器设置" --steps 1

# --act 才执行真实鼠标键盘操作。
uv run --frozen python -m typesafe_computer_use "打开浏览器设置" --act --steps 20
```

在终端按 Ctrl-C，或将鼠标移到主显示器左上角，可停止上游 macOS 任务循环。记录位于上游 `runs/`，与 Skill Recorder 的录制会话独立。当前不协调自动控制与录制的并发。

## 验证范围

已验证依赖安装、CLI 帮助和受保护的离线测试。尚未执行真实桌面任务，也未验证 API 密钥或模型请求。Windows 是上游实验适配器，尚无真实 Windows 验证；这里的安装不等于 Windows 发行包。

后续先复用原版任务循环，再补软件内入口、进度展示和进程管理，不从逆向结果重写一套执行器。详细源码评估见 [typesafe-computer-use-review.md](typesafe-computer-use-review.md)。
