# Node.js ES5 ReAct Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js->=12.0.0-green.svg)](https://nodejs.org/)

一个极简但完整的 **ReAct (Reasoning and Acting) Agent** 实现。使用纯 Node.js ES5 标准库构建，无任何第三方依赖。配合本地大语言模型（如：Qwen3-Coder），可实现最小化的代码生成（最小化OpenCode）、文件读写和任务执行能力。

## ✨ 核心特性

- **🧠 ReAct 范式**：完整实现 Thought-Action-Observation 循环
- **📦 零依赖**：仅使用 Node.js 标准库，无需 `npm install`
- **🛠 可扩展工具系统**：支持自定义工具注册
- **🔒 安全沙箱**：文件操作限制在项目目录内，防止路径穿越
- **🤖 模型兼容**：支持所有 OpenAI 兼容 API（LM Studio, Ollama, vLLM 等）

## 🚀 快速开始

### 1. 环境准备
确保已安装 Node.js (v12+) 并启动了本地 LLM 服务（默认端口 `1234`）。

### 2. 获取代码
git clone https://github.com/assassindesign/Agentjs

### 3. 运行 Agent
node agent.js /path/to/your/project

### 4. 输入任务示例
启动后，输入您的任务需求如：我要实现一个贪吃蛇游戏，请使用html、css、js来实现，需要有完整的游戏界面。


Agent 将自动执行以下步骤：

1. 💭 **思考**：分解任务为创建 HTML、CSS、JS 三个步骤
2. 🔧 **行动**：调用 `write_to_file` 工具创建文件
3. 🔍 **观察**：确认文件写入成功
4. ✅ **完成**：生成最终答案

## 🛠 内置工具

| 工具名称 | 函数签名 | 功能说明 |
| :--- | :--- | :--- |
| **read_file** | `(file_path)` | 读取指定路径的文件内容 |
| **write_to_file** | `(file_path, content)` | 将内容写入指定文件（自动处理换行符） |
| **run_terminal_command** | `(command)` | 执行终端命令（需用户交互确认） |

## ⚙️ 配置说明

### 修改模型接口

默认连接本地 `http://localhost:1234`，您可以在 `main()` 函数中修改：

var agent = new ReActAgent({
  model: ‘qwen/qwen3-coder-30b’,
  projectDirectory: projectDir,
  endpoint: ‘http://localhost:1234/v1/chat/completions’
});

### 注册新工具
agent.registerTool(
    'search_web',
    '(query)',
    '在网络上搜索信息',
    function(query, callback) {
        // 实现搜索逻辑
        callback(null, '搜索结果...');
    }
);

### 修改系统提示词
编辑 REACT_SYSTEM_PROMPT_TEMPLATE 变量以调整 Agent 行为。


