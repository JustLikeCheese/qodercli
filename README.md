# Qoder CLI

Qoder CLI 是Qoder品牌下的 CLI AI 编程助手，将强大的 AI 编程能力直接带入你的终端。

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

Qoder CLI 使用自有认证体系（已移除所有 Gemini 原生认证），支持以下认证方式：

### 方式一：浏览器登录（推荐）


```sh
qodercli
# 首次运行自动打开浏览器引导登录
```

或显式执行登录命令：

```sh
qodercli login
```

后台每 30 分钟自动刷新 token（通过 `/api/v1/deviceToken/refresh`），无需手动干预

> 如果环境不支持自动打开浏览器，设置 `NO_BROWSER=1` 后 CLI 会打印 URL 供手动访问。

### 方式二：Personal Access Token (PAT)

适用于 CI/CD 流水线或无浏览器环境：

```sh
export QODER_PERSONAL_ACCESS_TOKEN="your-pat-token"
qodercli
```

PAT 可在 Qoder 账号设置页 (`https://qoder.com/account/integrations`) 创建和管理。


### 认证相关环境变量

| 环境变量 | 说明 |
|---------|------|
| `QODER_PERSONAL_ACCESS_TOKEN` | PAT 令牌，设置后自动使用 PAT 认证 |
| `QODER_CONFIG_DIR` | 自定义配置目录（默认 `~/.qoder`） |
| `NO_BROWSER` | 设置后禁止自动打开浏览器 |


### 会话内命令

| 命令 | 说明 |
|------|------|
| `/login` 或 `/signin` | 在会话中执行登录 |
| `/logout` 或 `/signout` | 退出登录（需确认） |

## 🔌 MCP 扩展

在配置文件中添加 MCP 服务器，扩展 CLI 的能力