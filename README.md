# Qoder CLI

Qoder CLI 是Qoder品牌下的 CLI
AI 编程助手，将强大的 AI 编程能力直接带入你的终端。

## 🚀 Why Qoder CLI?

- **🧠 强大的 AI 模型** — 支持多种大语言模型，百万级 token 上下文窗口
- **🔧 内置工具** — 文件操作、Shell 命令执行、Web 搜索、代码搜索
- **🔌 可扩展** — 支持 MCP (Model Context Protocol) 协议，轻松接入自定义工具
- **💻 终端优先** — 为命令行开发者设计，高效交互

## 📦 安装

**需要 Node.js >= 20.0.0**

全局安装：

```sh
npm install -g @qoder-ai/qodercli
```

## 📋 发布渠道

### Stable（稳定版）

```sh
npm install -g @qoder-ai/qodercli@latest
```

### Node原生兼容版（beta）

```sh
npm install -g @qoder-ai/qodercli@beta
```

## 🚀 快速开始

### 基本用法

在当前目录启动交互式会话：

```sh
qodercli
```

指定模型：

```sh
qodercli -m <model-name>
```

非交互模式（适合脚本调用）：

```sh
qodercli -p "解释这个代码仓库的架构"
```

### 使用示例

**分析现有代码：**

```sh
cd your-project/
qodercli
> 给我总结一下昨天的所有代码变更
```

**生成代码：**

```sh
qodercli
> 帮我写一个 Express 中间件，实现请求频率限制
```

**调试问题：**

```sh
qodercli
> 这个测试为什么会失败？帮我修复它
```

### 列出可用模型

```sh
qodercli --list-models  # 表格输出当前账号可用的模型
```

未登录时以非零退出码报错。

## 📋 核心功能

### 代码理解与生成

- 查询和编辑大型代码库
- 支持多模态输入（图片、PDF 等）生成代码
- 自然语言调试

### 自动化与集成

- 自动化 Git 操作、PR 处理等任务
- 通过 MCP 服务器扩展能力
- 支持非交互模式在脚本中运行

### 高级能力

- Web 搜索获取实时信息
- 会话检查点（保存/恢复对话）
- 自定义上下文文件，定制项目行为

## 🔐 认证配置

Qoder CLI 使用自有认证体系，支持以下认证方式：

### 方式一：浏览器登录（推荐）

```sh
qodercli
# 首次运行自动打开浏览器引导登录
```

或显式执行登录命令：

```sh
qodercli login
```

后台每 30 分钟自动刷新 token，无需手动干预

> 如果环境不支持自动打开浏览器，设置 `NO_BROWSER=1`
> 后 CLI 会打印 URL 供手动访问。

### 方式二：Personal Access Token (PAT)

适用于 CI/CD 流水线或无浏览器环境：

```sh
export QODER_PERSONAL_ACCESS_TOKEN="your-pat-token"
qodercli
```

PAT 可在 Qoder 账号设置页 (`https://qoder.com/account/integrations`) 创建和管理。

### 认证相关环境变量

| 环境变量                      | 说明                              |
| ----------------------------- | --------------------------------- |
| `QODER_PERSONAL_ACCESS_TOKEN` | PAT 令牌，设置后自动使用 PAT 认证 |
| `NO_BROWSER`                  | 设置后禁止自动打开浏览器          |

### 配置目录环境变量

两类变量控制不同的路径维度：完整路径变量把它的值作为整个用户配置根目录；目录名称变量提供一个经过校验的单层目录名。没有完整路径覆盖时，该目录名用于组成默认用户配置根目录；无论是否存在完整路径覆盖，它都会决定项目资源目录和附加目录中已支持资源的目录名称。

| 站点    | 完整路径变量         | 目录名称变量              |
| ------- | -------------------- | ------------------------- |
| Qoder   | `QODER_CONFIG_DIR`   | `QODER_CONFIG_DIR_NAME`   |
| QoderCN | `QODERCN_CONFIG_DIR` | `QODERCN_CONFIG_DIR_NAME` |

目录名称变量的非空值会先规范化为 Unicode NFC 形式，再通过校验并作为目录名使用。除 NFC 规范化外，CLI 不会 trim、自动补点或改变大小写。例如，`abc` 使用目录 `abc`，`.abc` 使用目录 `.abc`。将当前站点的目录名称变量设置为 `abc` 后，各范围使用下表中的路径：

| 范围                 | Qoder 默认路径                 | QoderCN 默认路径               | 目录名称设置为 `abc` 后     |
| -------------------- | ------------------------------ | ------------------------------ | --------------------------- |
| 用户配置根目录       | `~/.qoder`                     | `~/.qoder-cn`                  | `~/abc`                     |
| 项目资源目录         | `<cwd>/.qoder`                 | `<cwd>/.qoder`                 | `<cwd>/abc`                 |
| 附加目录中的资源目录 | `<additionalDirectory>/.qoder` | `<additionalDirectory>/.qoder` | `<additionalDirectory>/abc` |

上表中的用户路径假设未设置完整路径变量、`--config-dir` 或 `QODER_CLI_HOME` / `QODERCN_CLI_HOME`。用户配置根目录按以下优先级确定：

1. `--config-dir`；
2. Qoder 的 `QODER_CONFIG_DIR`，或 QoderCN 的 `QODERCN_CONFIG_DIR`；
3. Qoder 的 `QODER_CLI_HOME`，或 QoderCN 的 `QODERCN_CLI_HOME`，再加所选目录名；
4. 系统用户目录再加所选目录名。

目录名称变量不会覆盖完整路径变量，也不会从完整路径的最后一级反推目录名。例如，同时设置 `QODER_CONFIG_DIR_NAME=abc` 和 `QODER_CONFIG_DIR=/data/qoder-config` 时，用户配置根目录为 `/data/qoder-config`，项目资源目录仍为 `<cwd>/abc`，附加资源目录仍为 `<additionalDirectory>/abc`。

Qoder 和 QoderCN 使用同一套目录名称规则。NFC 规范化后的名称长度必须为 1～64 个 Unicode 字符，可以包含 Unicode 字母、数字、组合字符、点号、下划线、连字符和名称中间的普通空格。`abc`、`.abc`、`agents`、`.agents`、`联想配置` 和 `team config` 都是合法名称。由 `e` 加组合重音构成的 `équipe` 会规范化为 NFC 形式的 `équipe`，用户、项目和附加目录统一使用该结果。

名称不能带前导或尾随空格，不能以点号结尾，也不能包含允许范围之外的字符。`CON`、`PRN`、`AUX`、`NUL`、`COM1`～`COM9`、`LPT1`～`LPT9` 等保留名称及其带扩展名形式同样不允许使用。因此，` abc`、`abc `、`abc.`、`abc/def`、`abc@def` 和 `NUL.txt` 都会被拒绝。

以下目录名称受到保护，不能用作配置目录：`.git`、`.svn`、`.hg`、`.vscode`、`.idea`、`.husky`、`.github`、`node_modules` 和 `bower_components`。保护规则采用不区分大小写的精确匹配，因此 `.GIT` 和 `Node_Modules` 也会被拒绝，而 `.github-backup`、`my.git`、`config-service` 和 `.agents` 仍然合法。变量未设置或值为严格的空字符串时使用当前站点的默认目录名；其他非法值或受保护名称会导致 CLI 启动失败并显示错误，不会静默回退到默认目录。

即使名称未被强制禁止，也不建议选择构建产物、缓存、凭据目录或其他由外部工具管理的目录，这些目录可能被覆盖或清理，进而导致 Qoder 配置或运行数据丢失。

设置目录名称后，CLI 不会合并或回退读取旧目录：Qoder 用户目录不回退到 `~/.qoder`，QoderCN 用户目录不回退到 `~/.qoder-cn`，项目和附加目录不回退到同级 `.qoder`。

附加目录仍只提供其原本支持的资源，例如 skills、commands，以及受现有开关控制的 rules 和上下文资源；不会新增加载 settings、agent 定义、output styles 或 workflows。

CLI 默认不把 `.agents/skills` 作为独立兼容来源。如需加载既有 `.agents/skills`，可以在 CLI 中执行 `/settings`，然后：

1. 选择 `User Settings` 或 `Project Settings`；
2. 搜索并开启 `Load Skills from .agents/skills`；
3. 按界面提示重启 CLI。

`User Settings` 对当前用户的所有项目生效；`Project Settings` 只对当前项目生效，并按现有 settings 合并规则覆盖用户设置。项目设置仍受工作区信任限制。

也可以直接编辑最终生效的 `settings.json`，或通过 `--settings` 传入相同配置：

```json
{
  "skills": {
    "loadFromAgentsDirectory": true
  }
}
```

开启后，CLI 会加载用户、项目和附加目录中的 `.agents/skills`，监听用户和项目的 `.agents/skills`，并恢复工作区子目录的祖先 `.agents/skills` 动态发现。该开关只恢复兼容来源，不会绕过现有的项目可信判断或来源限制：工作区未受信任时，用户级 `.agents/skills` 仍可加载，项目和附加目录中的 `.agents/skills` 不会加载。该开关也不会从 `.agents` 加载其他资源。将目录名称显式设置为 `.agents` 属于正常配置目录用法，不依赖此兼容开关。

### 启动参数环境变量

这些环境变量对标同名启动参数，优先级低于命令行参数。

| 环境变量                | 对标参数            | 说明                                   |
| ----------------------- | ------------------- | -------------------------------------- |
| `QODER_MODEL`           | `-m, --model`       | 当前会话使用的模型名                   |
| `QODER_MCP_CONFIG`      | `--mcp-config`      | MCP JSON 文件路径或 inline JSON 字符串 |
| `QODER_WORKING_DIR`     | `-w, --cwd`         | 启动前切换工作目录                     |
| `QODER_SESSION_ID`      | `--session-id`      | 使用指定 session ID                    |
| `QODER_SESSION_NAME`    | `-n, --name`        | 设置会话显示名                         |
| `QODER_PERMISSION_MODE` | `--permission-mode` | 设置权限模式                           |

### 会话内命令

| 命令                    | 说明               |
| ----------------------- | ------------------ |
| `/login` 或 `/signin`   | 在会话中执行登录   |
| `/logout` 或 `/signout` | 退出登录（需确认） |

## 🔌 MCP 扩展

在配置文件中添加 MCP 服务器，扩展 CLI 的能力
