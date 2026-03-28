# 千牛自动化项目 - 工作记忆

## 项目说明
- 位置: /Users/liuyuxuanyi/Documents/qianniu-automation
- 功能: 千牛消息自动读取与回复

## 技术方案

### 窗口管理
- 使用 `activateReception()` 函数直接激活千牛应用
- 千牛打开后会自动显示上次关闭时的窗口（包括接待中心）

### 回复流程
1. 激活接待中心窗口
2. 点击"新的客户咨询"按钮（从 recordings.json 读取坐标）
3. 点击聊天区域（消息输入框）
4. 复制文本到剪贴板
5. Command+V 粘贴
6. Enter 发送

### 关键坐标点 (来自 recordings.json)
- "新的客户咨询": 在"消息提醒"弹窗中
- "聊天区域": 接待中心窗口内的消息输入框位置

### 配置文件
- `data/calibrate.json`: 聊天区域绝对坐标或偏移量
- `data/reply-config.json`: 自动回复规则
- `data/recordings.json`: 记录的坐标点
- `data/sent-messages.json`: 已发送消息记录（防止重复发送）

### OCR 方案
- 使用 tesseract.js (WebAssembly版本)
- 语言包路径: `~/tessdata/chi_sim.traineddata` + `eng.traineddata`
- 需要手动下载语言包（参考 README）

### 最新修复 (2026-03-28)
1. **escape变量错误** - 修复AppleScript中窗口名称中文转义问题，改用窗口索引
2. **重复发送** - 添加已发送消息记录，冷却时间内不重复发送
3. **OCR优化** - 改用 tesseract.js + 本地语言包，支持中文识别
4. **y轴偏移** - calibrate.json 中 offsetY 从 169 改为 145（减少24）
5. **弹窗检测** - 新增detectPopup() OCR检测函数，只有检测到弹窗时才点击关闭按钮
