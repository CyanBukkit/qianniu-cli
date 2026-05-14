# QianNiuCli

`QianNiuCli` 是一个面向淘宝 / 天猫客服场景的终端工作台。

它把千牛自动化、会话结构化、AI 回复校验、挂起回复处理和实时 TUI 状态面板放到同一条 CLI 工作流里，适合想要在 macOS 上用终端把客服协同跑起来的人。

## Why QianNiuCli

- **Terminal-first**: 默认进入 TUI，直接看当前买家、会话状态、挂起回复和活动流
- **Session-aware**: 不再把整段聊天原文直接丢给模型，而是先做当前会话解析和指纹校验
- **Safer automation**: AI 返回后会再次校验前台会话，避免串客户误发
- **Pending workflow**: 会话切换、校验失败、需要人工确认的回复会进入挂起区
- **macOS-native hacks that actually ship**: 基于 AppleScript、`cliclick`、剪贴板和终端交互，在现有限制下尽量把流程做顺

## Features

- **Live TUI**: 实时查看监控状态、当前会话、挂起回复、活动流
- **Pending detail flow**: 选中挂起回复后进入详情页，支持复制原文、删除待处理项
- **Clipboard-first chat reading**: 以全选复制为主链路，OCR 只做兜底
- **AI reply pipeline**: 结构化会话 -> AI 草稿 -> 前台会话二次校验 -> 安全发送 / 挂起
- **Rule engine**: 支持关键词规则、默认回复、启停切换
- **Point recorder**: 支持 `ratio / fixed / offset` 三种录制模式

## Quick Start

### Install

```bash
npm install
```

### Run

```bash
# 默认进入 TUI
npm run dev

# 显式进入 TUI
npm run dev tui

# 纯日志监听模式
npm run dev monitor
```

### What You Get

启动后，`QianNiuCli` 会：

1. 监听新的客户咨询
2. 尝试切到当前会话
3. 读取聊天内容并结构化解析
4. 生成 AI 草稿并校验前台会话
5. 在安全时自动发送，不安全时进入挂起回复

## TUI

TUI 是这个项目的默认入口，不是附属功能。

主界面会展示：

- 当前监控状态
- 当前买家与会话签名
- 最近聊天预览
- AI 草稿
- 挂起回复列表
- 活动流

挂起回复支持：

- 列表高亮选中
- `Enter` 进入详情页
- `c` 复制原始会话文本
- `d` 删除挂起回复
- `q` 返回主界面或退出

也可以直接运行打包后的二进制：

```bash
./qianniu-macos tui
```

## 命令列表

### 核心功能

| 命令 | 说明 |
|------|------|
| `npm run dev` | 默认进入终端 TUI |
| `npm run dev monitor` | 监听模式（纯日志） |
| `npm run dev tui` | 终端面板模式（实时状态 + 监听） |
| `npm run dev patrol` | 巡店模式 |
| `npm run dev read` | 读取当前消息 |
| `npm run dev send "内容"` | 发送消息 |

### 回复规则管理

| 命令 | 说明 |
|------|------|
| `npm run dev rules` | 列出所有规则 |
| `npm run dev rule-add "关键词1,关键词2" "回复内容"` | 添加规则 |
| `npm run dev rule-del <规则ID>` | 删除规则 |
| `npm run dev rule-toggle <规则ID> <on\|off>` | 启用/禁用规则 |
| `npm run dev rule-test "测试消息"` | 测试规则匹配 |
| `npm run dev reply-on` | 恢复监听任务 |
| `npm run dev reply-off` | 暂停整个监听任务 |

### 挂起回复

| 命令 | 说明 |
|------|------|
| `npm run dev pending` | 查看当前挂起回复 |
| `npm run dev pending-update <ID> <状态> [备注]` | 更新挂起回复状态 |

### 坐标录制

| 命令 | 说明 |
|------|------|
| `npm run dev record` | 录制点击坐标 |
| `npm run dev replay <名称>` | 回放录制点 |
| `npm run dev points` | 列出录制点 |
| `npm run dev test-points` | 测试所有录制点 |

录制模式说明：
- `名称` - 比例模式 (ratio)，相对于窗口的比例
- `名称@fixed` - 固定坐标模式，屏幕绝对坐标
- `名称@offset` - 窗口偏移模式，相对于窗口的像素偏移

示例：`聊天记录@fixed` 录制聊天记录区域的固定坐标

### 窗口操作

| 命令 | 说明 |
|------|------|
| `npm run dev windows` | 列出窗口 |
| `npm run dev buyers` | 列出买家列表 |

## 消息读取方式

采用**全选复制剪贴板**为主、结构化解析为辅的方式读取聊天记录，OCR 只作为兼容兜底：

1. 点击聊天记录区域
2. Command+A 全选
3. Command+C 复制
4. 读取剪贴板内容
5. 再点击一下结束选中状态

当前版本会尝试把聊天原文解析为：

- 卖家消息
- 买家消息
- 消息时间
- 当前会话指纹

AI 回复时会基于“当前买家 + 最近会话 + 最近买家重点消息”构造 prompt，而不是直接把整段原文无差别丢给模型。

## 录制点位

需要录制以下关键点位（使用 `npm run dev record`）：

| 点位名称 | 类型 | 说明 |
|---------|------|------|
| 新的客户咨询 | ratio | 消息提醒弹窗中的"新的客户咨询"按钮 |
| 聊天区域 | ratio | 输入框位置（发送回复时点击） |
| 聊天记录 | ratio | 聊天消息区域（读取内容时点击） |
| 关闭这个消息提醒 | fixed | 关闭消息提醒弹窗的按钮 |

## 回复规则配置

规则配置文件位于：`data/reply-config.json`

示例配置：
```json
{
  "id": "yinyou-random",
  "name": "引流-随机回复",
  "keywords": ["在吗", "你好", "价格"],
  "reply": "RANDOM",
  "randomReplies": [
    "亲~我们是官方工作室，更多案例可以看：https://space.bilibili.com/60051886",
    "您好~定制插件软件可以直接看案例：https://space.bilibili.com/60051886"
  ],
  "priority": 50,
  "enabled": true
}
```

## 项目结构

```
qianniu-automation/
├── src/
│   ├── index.ts          # 主入口
│   ├── clipboard.ts      # 剪贴板聊天读取
│   ├── recorder.ts       # 坐标录制
│   ├── runtime/          # 监控/读取/发送/窗口控制
│   ├── session/          # 聊天解析、会话签名、挂起回复
│   ├── tui/              # 终端 TUI
│   ├── reply/            # 回复引擎
│   │   ├── engine.ts     # 规则引擎核心
│   │   └── rules.ts      # 默认规则
│   └── ...
├── data/                 # 数据目录
│   ├── recordings.json   # 录制的坐标点
│   ├── reply-config.json # 回复规则配置
│   ├── pending-replies.json # 挂起回复
│   └── sent-messages.json # 已发送消息记录
├── package.json
└── qianniu-macos         # 打包后的二进制文件
```

## 打包二进制

```bash
# 安装 pkg
npm install -D pkg

# 打包 macOS 版本
npm run binary
```

## 注意事项

1. **窗口匹配**：使用精确窗口名称匹配，避免中文转义问题
2. **坐标录制**：首次使用需要录制关键点位
3. **千牛窗口**：确保千牛接待中心窗口已打开
4. **监听任务**：关闭后会直接暂停整条自动化链路，不再点击、读取、请求 AI 或发送消息
5. **客户串线风险**：AI 返回后会再次校验当前会话，校验失败会转为挂起回复，不会直接发出

## 技术说明

### 窗口查找逻辑

遍历所有窗口获取名称和位置，精确匹配录制的 windowName：
- 避免直接使用中文窗口名称导致的 AppleScript 转义问题
- 支持 ratio/fixed/offset 三种坐标模式

### 聊天内容读取

使用剪贴板方式作为主链路：
- 不依赖 OCR 作为主识别能力
- 先全选复制，再做结构化聊天解析
- 生成当前会话指纹，用于 AI 返回后的二次校验

### TUI 设计思路

当前项目的硬约束仍然是：

- 千牛控制主要依赖 AppleScript 和 `cliclick`
- OCR 不稳定，不能当主链路
- 真正的风险是串客户和误发

因此 TUI 的目标不是做炫技界面，而是把以下信息实时拉到终端里：

- 监控现在处于哪一步
- 当前识别到的是哪个买家
- 最近会话内容是什么
- AI 最近一次生成了什么
- 有没有因为会话切换而被挂起的回复

这比直接做 Web 面板更贴合当前仓库和运行方式，也便于以后继续扩展成人工/AI 协同界面。
