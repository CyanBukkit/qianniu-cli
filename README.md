# 千牛自动化

淘宝/天猫商家客服自动化工具，监听买家消息并自动回复。

## 功能特性

- 📖 **消息读取** - 截图 + OCR 识别买家消息
- 🔔 **新消息监听** - 定时轮询检测新消息
- 🤖 **自动回复** - 关键词匹配规则引擎自动回复
- 📋 **规则管理** - 自定义回复规则
- 🛠️ **模板匹配** - 截图保存模板、屏幕定位
- 📍 **坐标录制** - 录制/回放点击坐标

## 快速开始

### 安装依赖

```bash
npm install
```

### 监听模式（自动回复）

```bash
npm run dev monitor
```

启动后会：
1. 激活千牛工作台窗口
2. 每 5 秒检查一次消息
3. 检测到新消息自动匹配规则并发送回复
4. 按 `Ctrl + C` 停止

## 命令列表

### 核心功能

| 命令 | 说明 |
|------|------|
| `npm run dev monitor` | 监听模式（自动回复） |
| `npm run dev patrol` | 巡店模式（遍历所有买家） |
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

### 模板功能

| 命令 | 说明 |
|------|------|
| `npm run dev capture <名称>` | 选区截图保存模板 |
| `npm run dev templates` | 列出所有模板 |
| `npm run dev find <名称>` | 查找模板在屏幕上的位置 |
| `npm run dev open-template <名称>` | 打开模板查看 |
| `npm run dev delete-template <名称>` | 删除模板 |

### 坐标录制

| 命令 | 说明 |
|------|------|
| `npm run dev record` | 录制点击坐标 |
| `npm run dev replay <名称>` | 回放录制点 |
| `npm run dev points` | 列出录制点 |
| `npm run dev test-points` | 测试所有录制点 |

### 窗口操作

| 命令 | 说明 |
|------|------|
| `npm run dev windows` | 列出窗口 |
| `npm run dev buyers` | 列出买家列表 |

## 默认回复规则

已内置 20+ 条规则，覆盖常见场景：

| 类别 | 场景 | 示例关键词 |
|------|------|-----------|
| 问候 | 你好、在吗 | 你好、您好、在吗、hello |
| 询价 | 价格、优惠 | 多少钱、便宜、打折 |
| 规格 | 尺寸、颜色 | 尺寸、大小、颜色 |
| 物流 | 发货、快递 | 发货、单号、物流 |
| 售后 | 退货、换货 | 退货、质量问题 |
| 购买 | 下单、支付 | 怎么买、货到付款 |
| 感谢 | 谢谢、再见 | 谢谢、再见 |

### 添加自定义规则

```bash
# 添加规则
npm run dev rule-add "VIP,会员" "亲，您是我们的VIP会员，享受专属折扣哦"

# 测试规则
npm run dev rule-test "我是VIP客户"
```

### 规则配置

规则配置文件位于：`data/reply-config.json`

每个规则包含：
- `id` - 唯一标识
- `name` - 规则名称
- `keywords` - 匹配关键词数组（任一匹配）
- `excludeKeywords` - 排除关键词
- `reply` - 回复内容
- `priority` - 优先级（越大越优先）
- `enabled` - 是否启用

## 项目结构

```
qianniu-automation/
├── src/
│   ├── index.ts          # 主入口
│   ├── ocr.ts            # OCR 识别
│   ├── template.ts       # 模板匹配
│   ├── recorder.ts       # 坐标录制
│   ├── reply/            # 回复引擎
│   │   ├── engine.ts     # 规则引擎核心
│   │   └── rules.ts      # 默认规则
│   └── ...
├── data/                 # 数据目录
│   ├── templates/        # 截图模板
│   └── reply-config.json # 回复规则配置
└── package.json
```

## 注意事项

1. **窗口位置**：确保千牛接待中心窗口在默认位置，首次使用可能需要校准坐标
2. **OCR 依赖**：需要安装 tesseract 或使用 tesseract.js（内置）
3. **模板匹配**：需要安装 OpenCV (`pip3 install opencv-python`)
4. **自动回复**：默认全自动发送，建议先测试 `rule-test` 确认规则正确

## OCR 语言包安装（重要！）

如果 OCR 识别中文失败，需要手动下载中文语言包：

### 方式一：使用 tesseract.js（推荐，内置）

```bash
# 创建语言包目录
mkdir -p ~/tessdata

# 下载中文简体语言包（约44MB）
curl -L -o ~/tessdata/chi_sim.traineddata \
  https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata

# 下载英文语言包（约4MB）
curl -L -o ~/tessdata/eng.traineddata \
  https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata

# 压缩为 .gz 格式（tesseract.js 需要）
gzip -k ~/tessdata/chi_sim.traineddata
gzip -k ~/tessdata/eng.traineddata

# 验证
ls -la ~/tessdata/
```

### 方式二：使用命令行 tesseract

```bash
# 安装 tesseract
brew install tesseract tesseract-chi-sim

# 验证安装
tesseract --version
tesseract --list-langs  # 应该看到 chi_sim 和 eng
```

### 验证 OCR 是否正常工作

```bash
# 测试 OCR 识别
npm run dev ocr-test
```

## 扩展

后续可升级为真正的 AI 回复：
- DeepSeek API
- Claude API
- Ollama 本地大模型
