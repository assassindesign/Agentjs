/**
 * agent.js
 * Node.js ES5 ReAct Agent
 * 目标：使用 Node.js 标准库 + ES5 复刻 ReAct Agent 的核心行为
 */

var fs = require('fs');
var path = require('path');
var http = require('http');
var readline = require('readline');
var child_process = require('child_process');

var REACT_SYSTEM_PROMPT_TEMPLATE =
    "你需要解决一个问题。为此，你需要将问题分解为多个步骤。对于每个步骤，首先使用 <thought> 思考要做什么，然后使用可用工具之一决定一个 <action>。接着，你将根据你的行动从环境/工具中收到一个 <observation>。持续这个思考和行动的过程，直到你有足够的信息来提供 <final_answer>。\n\n" +
    "所有步骤请严格使用以下 XML 标签格式输出：\n" +
    "- <question> 用户问题\n" +
    "- <thought> 思考\n" +
    "- <action> 采取的工具操作\n" +
    "- <observation> 工具或环境返回的结果\n" +
    "- <final_answer> 最终答案\n\n" +
    "⸻\n\n" +
    "例子 1:\n\n" +
    "<question>埃菲尔铁塔有多高？</question>\n" +
    "<thought>我需要找到埃菲尔铁塔的高度。可以使用搜索工具。</thought>\n" +
    "<action>get_height(\"埃菲尔铁塔\")</action>\n" +
    "<observation>埃菲尔铁塔的高度约为330米（包含天线）。</observation>\n" +
    "<thought>搜索结果显示了高度。我已经得到答案了。</thought>\n" +
    "<final_answer>埃菲尔铁塔的高度约为330米。</final_answer>\n\n" +
    "⸻\n\n" +
    "例子 2:\n\n" +
    "<question>帮我找一个简单的番茄炒蛋食谱，并看看家里的冰箱里有没有西红柿。</question>\n" +
    "<thought>这个任务分两步。第一步，找到番茄炒蛋的食谱。第二步，检查冰箱里是否有西红柿。我先用 find_recipe 工具找食谱。</thought>\n" +
    "<action>find_recipe(dish=\"番茄炒蛋\")</action>\n" +
    "<observation>简单的番茄炒蛋食谱：将2个鸡蛋打散，2个番茄切块。热油，先炒鸡蛋，盛出。再热油，炒番茄至软烂，加入鸡蛋，放盐调味即可。</observation>\n" +
    "<thought>好的，我已经有食谱了。食谱需要西红柿。现在我需要用 check_fridge 工具看看冰箱里有没有西红柿。</thought>\n" +
    "<action>check_fridge(item=\"西红柿\")</action>\n" +
    "<observation>冰箱检查结果：有3个西红柿。</observation>\n" +
    "<thought>我找到了食谱，并且确认了冰箱里有西红柿。可以回答问题了。</thought>\n" +
    "<final_answer>简单的番茄炒蛋食谱是：鸡蛋打散，番茄切块。先炒鸡蛋，再炒番茄，混合后加盐调味。冰箱里有3个西红柿。</final_answer>\n\n" +
    "⸻\n\n" +
    "请严格遵守：\n" +
    "- 你每次回答都必须包括两个标签，第一个是 <thought>，第二个是 <action> 或 <final_answer>\n" +
    "- 输出 <action> 后立即停止生成，等待真实的 <observation>，擅自生成 <observation> 将导致错误\n" +
    "- 如果 <action> 中的某个工具参数有多行的话，请使用 \\n 来表示，如：<action>write_to_file(\"${project_directory}/test.txt\", \"a\\nb\\nc\")</action>\n" +
    "- 工具参数中的文件路径请使用绝对路径，且必须位于项目目录下：${project_directory}。不要写入 /tmp 或其他目录。\n\n" +
    "⸻\n\n" +
    "本次任务可用工具：\n" +
    "${tool_list}\n\n" +
    "⸻\n\n" +
    "环境信息：\n\n" +
    "操作系统：${operating_system}\n" +
    "当前目录下文件列表：${file_list}\n";

function ReActAgent(options) {
    this.model = options.model;
    this.projectDirectory = options.projectDirectory;
    this.endpoint = options.endpoint || 'http://localhost:1234/v1/chat/completions';
    this.endpointUrl = new URL(this.endpoint);
    this.maxFormatRetries = 2;
    this.tools = {};
    this.toolMeta = [];
}

ReActAgent.prototype.registerTool = function (name, signature, doc, fn) {
    this.tools[name] = fn;
    this.toolMeta.push({
        name: name,
        signature: signature,
        doc: doc
    });
};

ReActAgent.prototype.ensureProjectPath = function (filePath) {
    if (!this.projectDirectory) {
        throw new Error('PROJECT_DIR 未初始化');
    }

    var base = path.resolve(this.projectDirectory);
    var candidate = path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
    candidate = path.resolve(candidate);

    if (candidate !== base && candidate.indexOf(base + path.sep) !== 0) {
        throw new Error('只允许在项目目录下读写文件: ' + base);
    }

    return candidate;
};

ReActAgent.prototype.getOperatingSystemName = function () {
    var map = {
        darwin: 'macOS',
        win32: 'Windows',
        linux: 'Linux'
    };
    return map[process.platform] || 'Unknown';
};

ReActAgent.prototype.getToolList = function () {
    var lines = [];
    var i;
    for (i = 0; i < this.toolMeta.length; i++) {
        lines.push('- ' + this.toolMeta[i].name + this.toolMeta[i].signature + ': ' + this.toolMeta[i].doc);
    }
    return lines.join('\n');
};

ReActAgent.prototype.renderSystemPrompt = function () {
    var list = fs.readdirSync(this.projectDirectory);
    var absList = [];
    var i;

    for (i = 0; i < list.length; i++) {
        absList.push(path.resolve(path.join(this.projectDirectory, list[i])));
    }

    return REACT_SYSTEM_PROMPT_TEMPLATE
        .split('${operating_system}').join(this.getOperatingSystemName())
        .split('${tool_list}').join(this.getToolList())
        .split('${file_list}').join(absList.join(', '))
        .split('${project_directory}').join(this.projectDirectory);
};

ReActAgent.prototype.callModel = function (messages, callback) {
    function formatNetworkError(err) {
        var parts = [];
        var i;

        if (!err) return '未知错误';
        if (err.errors && err.errors.length) {
            for (i = 0; i < err.errors.length; i++) {
                if (err.errors[i] && err.errors[i].message) {
                    parts.push(err.errors[i].message);
                }
            }
            if (parts.length) return parts.join('; ');
        }
        if (err.message) return err.message;
        return String(err);
    }

    console.log('\n\n正在请求模型，请稍等...');

    var payload = JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: -1,
        stream: false
    });

    var req = http.request(
        {
            hostname: this.endpointUrl.hostname || 'localhost',
            port: this.endpointUrl.port || 80,
            path: (this.endpointUrl.pathname || '/v1/chat/completions') + (this.endpointUrl.search || ''),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        },
        function (res) {
            var body = '';
            res.on('data', function (chunk) {
                body += chunk;
            });
            res.on('end', function () {
                if (res.statusCode >= 400) {
                    callback(new Error('本地模型请求失败：' + body));
                    return;
                }

                try {
                    var responseJson = JSON.parse(body);
                    var content = responseJson.choices[0].message.content;
                    messages.push({ role: 'assistant', content: content });
                    callback(null, content);
                } catch (e) {
                    callback(new Error('模型响应解析失败：' + e.message));
                }
            });
        }
    );

    req.setTimeout(120000, function () {
        req.destroy(new Error('请求超时'));
    });

    req.on('error', function (err) {
        callback(new Error('无法连接本地模型服务：' + formatNetworkError(err)));
    });

    req.write(payload);
    req.end();
};

ReActAgent.prototype.parseSingleArg = function (argStr) {
    var s = argStr.trim();
    var namedMatch = s.match(/^[A-Za-z_]\w*\s*=\s*([\s\S]+)$/);
    var first = s.charAt(0);
    var last = s.charAt(s.length - 1);

    // 支持 key=value 形式参数，保留 value 部分
    if (namedMatch) {
        s = namedMatch[1].trim();
        first = s.charAt(0);
        last = s.charAt(s.length - 1);
    }

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        var inner = s.slice(1, -1);
        inner = inner.split('\\"').join('"');
        inner = inner.split("\\'").join("'");
        inner = inner.split('\\n').join('\n');
        inner = inner.split('\\t').join('\t');
        inner = inner.split('\\r').join('\r');
        inner = inner.split('\\\\').join('\\');
        return inner;
    }

    if (/^-?\d+(\.\d+)?$/.test(s)) {
        return Number(s);
    }
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === 'None') return null;

    return s;
};

ReActAgent.prototype.extractTaggedContent = function (text, tagName) {
    var tag = String(tagName);
    var pattern = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i');
    var match = text.match(pattern);
    var openStart;
    var openEnd;
    var closeStart;

    if (match) return match[1].trim();

    // 容错：缺少结束标签时，截取到下一个 XML 标签前
    pattern = new RegExp('<' + tag + '>', 'i');
    match = text.match(pattern);
    if (!match) return null;

    openStart = text.search(pattern);
    openEnd = openStart + match[0].length;
    closeStart = text.slice(openEnd).search(/<\w+>/);

    if (closeStart === -1) {
        return text.slice(openEnd).trim();
    }
    return text.slice(openEnd, openEnd + closeStart).trim();
};

ReActAgent.prototype.findFunctionCallSnippet = function (text) {
    var toolNames = Object.keys(this.tools);
    var i;
    var j;
    var start;
    var openPos;
    var inString;
    var quote;
    var escape;
    var depth;
    var ch;

    for (i = 0; i < toolNames.length; i++) {
        start = text.indexOf(toolNames[i] + '(');
        if (start === -1) continue;

        openPos = start + toolNames[i].length;
        inString = false;
        quote = null;
        escape = false;
        depth = 0;

        for (j = openPos; j < text.length; j++) {
            ch = text.charAt(j);

            if (inString) {
                if (escape) {
                    escape = false;
                    continue;
                }
                if (ch === '\\') {
                    escape = true;
                    continue;
                }
                if (ch === quote) {
                    inString = false;
                    quote = null;
                }
                continue;
            }

            if (ch === '"' || ch === "'") {
                inString = true;
                quote = ch;
                continue;
            }

            if (ch === '(') {
                depth += 1;
                continue;
            }
            if (ch === ')') {
                depth -= 1;
                if (depth === 0) {
                    return text.slice(start, j + 1).trim();
                }
            }
        }
    }

    return null;
};

ReActAgent.prototype.extractActionPayload = function (content) {
    var actionBody = this.extractTaggedContent(content, 'action');
    var lineMatch;
    var jsonMatch;
    var fallbackCall;
    var lines;
    var i;

    if (actionBody) return actionBody;

    // 容错：$action> xxx 或 action: xxx
    lines = content.split(/\r?\n/);
    for (i = 0; i < lines.length; i++) {
        lineMatch = lines[i].match(/^\s*\$?action>\s*(.+)\s*$/i);
        if (lineMatch) return lineMatch[1].trim();
        lineMatch = lines[i].match(/^\s*action\s*[:：]\s*(.+)\s*$/i);
        if (lineMatch) return lineMatch[1].trim();
    }

    // 容错：JSON action 输出
    jsonMatch = content.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];

    // 最后兜底：直接在全文里找工具调用
    fallbackCall = this.findFunctionCallSnippet(content);
    if (fallbackCall) return fallbackCall;

    return null;
};

ReActAgent.prototype.parseAction = function (codeStr) {
    var cleaned = String(codeStr || '').trim();
    var jsonAction;
    var match;
    var funcName;
    var argsStr;
    var args;
    var currentArg;
    var inString;
    var stringChar;
    var i;
    var parenDepth;
    var braceDepth;
    var bracketDepth;
    var ch;

    // 去除代码块包裹
    if (/^```[\w-]*\s*[\r\n]/.test(cleaned) && /```$/.test(cleaned)) {
        cleaned = cleaned.replace(/^```[\w-]*\s*[\r\n]/, '').replace(/```$/, '').trim();
    }

    // 支持 JSON action：{"action":"write_to_file","args":[...]}
    if (cleaned.charAt(0) === '{' && cleaned.charAt(cleaned.length - 1) === '}') {
        try {
            jsonAction = JSON.parse(cleaned);
            if (jsonAction && (jsonAction.action || jsonAction.tool || jsonAction.name)) {
                return {
                    name: jsonAction.action || jsonAction.tool || jsonAction.name,
                    args: Object.prototype.toString.call(jsonAction.args) === '[object Array]'
                        ? jsonAction.args
                        : []
                };
            }
        } catch (_ignored) {
            // 继续走函数调用解析
        }
    }

    match = cleaned.match(/^\s*(\w+)\(([\s\S]*)\)\s*$/);
    if (!match) {
        throw new Error('Invalid function call syntax');
    }

    funcName = match[1];
    argsStr = match[2].trim();
    args = [];
    currentArg = '';
    inString = false;
    stringChar = null;
    i = 0;
    parenDepth = 0;
    braceDepth = 0;
    bracketDepth = 0;

    while (i < argsStr.length) {
        ch = argsStr.charAt(i);

        if (!inString) {
            if (ch === '"' || ch === "'") {
                inString = true;
                stringChar = ch;
                currentArg += ch;
            } else if (ch === '(') {
                parenDepth += 1;
                currentArg += ch;
            } else if (ch === ')') {
                parenDepth -= 1;
                currentArg += ch;
            } else if (ch === '{') {
                braceDepth += 1;
                currentArg += ch;
            } else if (ch === '}') {
                braceDepth -= 1;
                currentArg += ch;
            } else if (ch === '[') {
                bracketDepth += 1;
                currentArg += ch;
            } else if (ch === ']') {
                bracketDepth -= 1;
                currentArg += ch;
            } else if (ch === ',' && parenDepth === 0) {
                if (braceDepth === 0 && bracketDepth === 0) {
                    args.push(this.parseSingleArg(currentArg.trim()));
                    currentArg = '';
                } else {
                    currentArg += ch;
                }
            } else if (ch === '，' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
                // 容错中文逗号
                args.push(this.parseSingleArg(currentArg.trim()));
                currentArg = '';
            } else {
                currentArg += ch;
            }
        } else {
            currentArg += ch;
            if (ch === stringChar && (i === 0 || argsStr.charAt(i - 1) !== '\\')) {
                inString = false;
                stringChar = null;
            }
        }

        i += 1;
    }

    if (currentArg.trim()) {
        args.push(this.parseSingleArg(currentArg.trim()));
    }

    return {
        name: funcName,
        args: args
    };
};

ReActAgent.prototype.askContinueForCommand = function (callback) {
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('\n\n是否继续？（Y/N）', function (answer) {
        rl.close();
        callback(String(answer || '').toLowerCase() === 'y');
    });
};

ReActAgent.prototype.executeTool = function (toolName, args, callback) {
    var tool = this.tools[toolName];
    var invokeArgs;

    if (!tool) {
        callback(null, '工具执行错误：未知工具: ' + toolName);
        return;
    }

    invokeArgs = args.slice();
    invokeArgs.push(function (err, result) {
        if (err) {
            callback(null, '工具执行错误：' + err.message);
            return;
        }
        callback(null, result);
    });

    try {
        tool.apply(this, invokeArgs);
    } catch (e) {
        callback(null, '工具执行错误：' + e.message);
    }
};

ReActAgent.prototype.run = function (userInput, done) {
    var self = this;
    var formatRetries = 0;
    var messages = [
        { role: 'system', content: self.renderSystemPrompt() },
        { role: 'user', content: '<question>' + userInput + '</question>' }
    ];

    function step() {
        self.callModel(messages, function (modelErr, content) {
            var thoughtMatch;
            var finalAnswerMatch;
            var actionPayload;
            var action;

            if (modelErr) {
                done(modelErr);
                return;
            }

            thoughtMatch = self.extractTaggedContent(content, 'thought');
            if (thoughtMatch) {
                console.log('\n\n💭 Thought: ' + thoughtMatch);
            }

            finalAnswerMatch = self.extractTaggedContent(content, 'final_answer');
            if (finalAnswerMatch !== null) {
                done(null, finalAnswerMatch);
                return;
            }

            actionPayload = self.extractActionPayload(content);
            if (!actionPayload) {
                if (formatRetries < self.maxFormatRetries) {
                    formatRetries += 1;
                    messages.push({
                        role: 'user',
                        content: '格式错误：请严格输出 <thought> 和 <action>（或 <final_answer>）。输出 <action> 后立即停止，不要伪造 <observation>。'
                    });
                    step();
                    return;
                }
                done(new Error('模型未输出可解析的 <action>'));
                return;
            }

            try {
                action = self.parseAction(actionPayload);
            } catch (e) {
                if (formatRetries < self.maxFormatRetries) {
                    formatRetries += 1;
                    messages.push({
                        role: 'user',
                        content: '你上一次的 <action> 格式无法解析。请仅输出合法函数调用，例如：<action>read_file("/abs/path.txt")</action>'
                    });
                    step();
                    return;
                }
                done(e);
                return;
            }
            formatRetries = 0;
            console.log('\n\n🔧 Action: ' + action.name + '(' + action.args.join(', ') + ')');

            function executeAndContinue() {
                self.executeTool(action.name, action.args, function (_toolErr, observation) {
                    console.log('\n\n🔍 Observation：' + observation);
                    messages.push({
                        role: 'user',
                        content: '<observation>' + observation + '</observation>'
                    });
                    step();
                });
            }

            if (action.name === 'run_terminal_command') {
                self.askContinueForCommand(function (ok) {
                    if (!ok) {
                        console.log('\n\n操作已取消。');
                        done(null, '操作被用户取消');
                        return;
                    }
                    executeAndContinue();
                });
                return;
            }

            executeAndContinue();
        });
    }

    step();
};

function registerDefaultTools(agent) {
    agent.registerTool(
        'read_file',
        '(file_path)',
        '用于读取文件内容',
        function (filePath, callback) {
            var safePath;
            try {
                safePath = agent.ensureProjectPath(filePath);
                callback(null, fs.readFileSync(safePath, 'utf8'));
            } catch (e) {
                callback(e);
            }
        }
    );

    agent.registerTool(
        'write_to_file',
        '(file_path, content)',
        '将指定内容写入指定文件',
        function (filePath, content, callback) {
            var safePath;
            var normalized = String(content).split('\\n').join('\n');
            try {
                safePath = agent.ensureProjectPath(filePath);
                fs.writeFileSync(safePath, normalized, 'utf8');
                callback(null, '写入成功');
            } catch (e) {
                callback(e);
            }
        }
    );

    agent.registerTool(
        'run_terminal_command',
        '(command)',
        '用于执行终端命令',
        function (command, callback) {
            child_process.exec(String(command), function (error, stdout, stderr) {
                if (error) {
                    callback(null, stderr || error.message);
                    return;
                }
                callback(null, '执行成功');
            });
        }
    );
}

function main() {
    var projectDir = process.argv[2];

    if (!projectDir) {
        console.error('用法: node agent.js <project_directory>');
        process.exit(1);
    }

    projectDir = path.resolve(projectDir);
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        console.error('路径不存在或不是目录: ' + projectDir);
        process.exit(1);
    }

    var agent = new ReActAgent({
        model: 'qwen/qwen3-coder-30b',
        projectDirectory: projectDir
    });
    registerDefaultTools(agent);

    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('请输入任务：', function (task) {
        rl.close();
        agent.run(task, function (err, finalAnswer) {
            if (err) {
                console.error(err.message);
                process.exit(1);
            }
            console.log('\n\n✅ Final Answer：' + finalAnswer);
        });
    });
}

main();
