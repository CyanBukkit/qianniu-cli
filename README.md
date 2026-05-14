# 千牛自动化

淘宝/天猫商家客服自动化工具，监听买家消息、结构化当前会话，并支持终端 TUI 实时查看状态。

## 功能特性

- 📋 **消息读取** - 全选复制剪贴板读取聊天记录
- 🔔 **新消息监听** - 定时轮询检测消息提醒
- 🤖 **自动回复** - 关键词匹配规则引擎自动回复
- 🖥️ **终端 TUI** - 在终端实时查看监控状态、当前会话、挂起回复、事件日志
- 🧠 **会话校验** - AI 回复返回后再次校验当前客户，避免串客户误发
- 📋 **规则管理** - 自定义回复规则（支持随机回复）
- 📍 **坐标录制** - 录制/回放点击坐标（支持 ratio/fixed 模式）

## 快速开始

### 安装依赖

```bash
npm install
```

### 监听模式（自动回复）

```bash
# 默认进入 TUI
npm run dev

# 显式进入 TUI
npm run dev tui

# 纯日志监听模式
npm run dev monitor

# 或使用打包后的二进制
./qianniu-macos tui
```

启动后会：
1. 检测消息提醒窗口，点击进入聊天
2. 发送随机回复（引导客户）
3. 全选复制读取聊天内容
4. 按 `Ctrl + C` 停止

### TUI 模式

```bash
npm run dev tui
```

TUI 会在终端内实时显示：

1. 当前监控是否运行
2. 自动回复开关状态
3. 当前识别到的买家与会话签名
4. 最近聊天预览与 AI 草稿
5. 挂起回复和事件日志

快捷键：

- `a` 切换自动回复开关
- `r` 手动刷新界面
- `q` 退出 TUI
- `Ctrl + C` 退出 TUI

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
| `npm run dev reply-on` | 启用自动回复 |
| `npm run dev reply-off` | 禁用自动回复 |

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
4. **自动回复**：默认会先发送快捷安抚语，再请求 AI
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
