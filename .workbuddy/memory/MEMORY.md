# 千牛自动化项目 - 工作记忆

## 项目说明
- 位置: /Users/liuyuxuanyi/Documents/qianniu-automation
- 功能: 千牛消息自动读取与回复

## 技术方案

### 窗口管理
- 使用 `activateReception()` 函数替代 `activateApp(ALIWORKBENCH)` 
- 该函数会先激活千牛应用，然后查找并激活"接待中心"窗口

### 回复流程 (2026-03-28 优化)
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
- `data/calibrate.json`: 聊天区域偏移量和大小
- `data/reply-config.json`: 自动回复规则
- `data/recordings.json`: 记录的坐标点
