---
name: claw-cli
description: 通过 claw-cli 管理 OpenClaw Skills 和 Agents 的安装、发布、搜索。触发词：安装agent、安装skill、claw install、场景安装、发布skill、场景配置、scene add、scene validate、scene list。
---

# Claw CLI - OpenClaw 包管理器

通过 `claw` CLI 管理 Skills（能力模块）和 Agents（角色模板）的搜索、安装、发布。

## CLI 路径

```bash
CLAW_CLI="node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js"
# 或如果已 npm link：
# CLAW_CLI="claw"
```

## 常用命令

### 搜索
```bash
$CLAW_CLI search [query]
```

### 安装
```bash
$CLAW_CLI install <package>          # 安装 skill 或 agent
$CLAW_CLI agent install <name>       # 安装 agent
```

### 发布
```bash
$CLAW_CLI publish <source-dir> [--scope <skill|agent>]
```

### 查看已安装
```bash
$CLAW_CLI list
$CLAW_CLI verify
```

### 卸载
```bash
$CLAW_CLI uninstall <name>
```

### 离线打包
```bash
$CLAW_CLI pack <name> [--output <dir>]
$CLAW_CLI install-pack <tarball>
```

### 场景管理
```bash
$CLAW_CLI scene init <name> [--desc "description"]  # 初始化场景
$CLAW_CLI scene add <package>                        # 添加到场景
$CLAW_CLI scene remove <package>                     # 从场景移除
$CLAW_CLI scene install [--dir <path>]               # 按场景批量安装
$CLAW_CLI scene list                                 # 查看场景
$CLAW_CLI scene validate                             # 验证配置
```

### Agent 管理
```bash
$CLAW_CLI agent install <name>   # 安装 Agent
$CLAW_CLI agent soul <name>      # 查看 Agent 人设
```

### 环境管理
```bash
$CLAW_CLI doctor
$CLAW_CLI env check
$CLAW_CLI env setup
```

## 场景配置文件 (claw.scene.json)

```json
{
  "name": "stock-trader",
  "description": "A股投资分析工作台",
  "agents": ["stock-analyst"],
  "skills": ["findata-toolkit", "bollinger-analyzer"],
  "env": {
    "DATA_PROXY": "http://localhost:7890"
  }
}
```

## AI 调用示例

```bash
# 搜索金融相关 skill
node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js search stock

# 安装一个 skill
node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js install findata-toolkit

# 查看已安装
node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js list

# 初始化场景并安装
node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js scene init trader --desc "交易工作台"
node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js scene add stock-analyst
node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js scene add findata-toolkit
node ~/.openclaw/workspace/projects/claw-cli-ts/dist/cli.js scene install
```

## 注意事项
- 使用前确保已 `npm run build` 构建项目
- publish 会自动扫描敏感信息并环境变量化（只修改 registry 副本）
- 场景安装时 env 会合并到项目目录的 `.env` 文件
