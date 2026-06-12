#!/usr/bin/env node
/**
 * 心虫历史记忆吸收 v2（对话摘要版）
 *
 * 差异于 v1：不再只提取零碎的用户消息，而是：
 * 1. 从 JSONL 中提取用户+助理的完整对话轮次
 * 2. 把有实质内容的对话摘要成叙事片段
 * 3. 写入 dialogue-history.jsonl 和 meaningful-learned.json
 *
 * 目标：为梦境引擎提供有价值的故事素材，而非系统元数据。
 */

const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const HEARTFLOW_DIR = path.resolve(__dirname, '..');
const SESSION_DIR = '/Users/apple/.claude/projects/-Users-apple--lark-channel-workspaces-claude-default';
const MEMORY_DIR = path.join(HEARTFLOW_DIR, 'memory');
const LEARNED_PATH = path.join(MEMORY_DIR, 'meaningful-learned.json');
const DIALOGUE_PATH = path.join(MEMORY_DIR, 'dialogue-history.jsonl');
const LEGACY_PATH = path.join(MEMORY_DIR, 'legacy-migration.jsonl');

const MIN_FILE_SIZE = 30 * 1024;

// ============ 辅助函数 ============

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}

function saveJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 从一行 JSONL 提取纯文本内容（去元数据）
 */
function extractText(entry) {
  if (!entry) return '';
  let raw = '';

  if (entry.type === 'user' || entry.type === 'assistant') {
    const msg = entry.message;
    if (typeof msg === 'string') raw = msg;
    else if (typeof msg?.content === 'string') raw = msg.content;
    else if (Array.isArray(msg?.content)) {
      raw = msg.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
  } else if (entry.role === 'user' || entry.role === 'assistant') {
    if (typeof entry.content === 'string') raw = entry.content;
    else if (Array.isArray(entry.content)) {
      raw = entry.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
  }

  // 清理所有系统注入的 XML 标签
  raw = raw
    .replace(/<bridge_context>[\s\S]*?<\/bridge_context>/g, '')
    .replace(/<bridge_instructions>[\s\S]*?<\/bridge_instructions>/g, '')
    .replace(/<quoted_message[\s\S]*?<\/quoted_message>/g, '')
    .replace(/<interactive_card[\s\S]*?<\/interactive_card>/g, '')
    .replace(/<user_input>[\s\S]*?<\/user_input>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<function_result>[\s\S]*?<\/function_result>/g, '')
    .replace(/<call_tool_result[\s\S]*?<\/call_tool_result>/g, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, '')
    .replace(/<antml:block[\s\S]*?<\/antml:block>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\[\{"type":"[\s\S]*?"is_error":(true|false)\}\]/g, '') // tool result blocks
    .replace(/\[{"type":"text","text":"[\s\S]*?"}\]/g, '') // wrapped text blocks
    .replace(/^你是在 bridge 进程中运行.*$/gm, '')
    .replace(/^不要 unset LARK_CHANNEL.*$/gm, '')
    .replace(/\{"[^"]+":.*?\}/g, '') // inline JSON
    .replace(/\s+/g, ' ')
    .trim();

  return raw;
}

/**
 * 判断文本是否算"有实际内容"
 */
function isMeaningful(text) {
  if (!text || text.length < 15) return false;
  if (text.length > 5000) return false;
  if (text.startsWith('{') || text.startsWith('[')) return false;
  // 排除纯代码/命令消息
  const codeRatio = (text.match(/[{}[\]();]/g) || []).length / text.length;
  if (codeRatio > 0.3) return false;
  // 排除纯元数据残留
  if (/^(Base directory|This session|Your tool call|Continue from)/.test(text)) return false;
  return true;
}

/**
 * 将对话轮次摘要为叙事片段
 */
function summarizeDialogue(user, assistant) {
  // 助理回复中的关键内容
  const lines = assistant.split('\n').filter(l => l.trim());
  // 提取有实质内容的句子
  const meaningfulLines = lines.filter(l => {
    const t = l.trim();
    return t.length > 15 && !t.startsWith('-') && !t.startsWith('```') && !t.startsWith('|');
  });

  let summary;
  if (meaningfulLines.length > 0) {
    // 取前 2-3 行最有代表性的内容
    summary = meaningfulLines.slice(0, 3).join(' ').substring(0, 300);
  } else {
    summary = assistant.substring(0, 200);
  }

  // 从用户消息提取主题关键词
  const userKeywords = user.substring(0, 100).replace(/[^一-鿿\w]/g, ' ').trim();

  return {
    role: 'user',
    content: `[对话摘要] 用户: ${userKeywords} | 心虫: ${summary}`.substring(0, 500),
    ts: new Date().toISOString(),
    type: 'dream_food'
  };
}

/**
 * 处理单个 JSONL 文件为用户+助理对话轮次对
 */
function extractConversations(jsonlPath) {
  const content = fs.readFileSync(jsonlPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  const turns = [];
  let lastUser = '';
  let lastAssistant = '';

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user') {
        const text = extractText(entry);
        if (isMeaningful(text)) {
          lastUser = text;
        }
      } else if (entry.type === 'assistant') {
        const text = extractText(entry);
        if (isMeaningful(text)) {
          lastAssistant = text;
          // 如果前面有用户消息，组成一轮对话
          if (lastUser) {
            const dialogue = summarizeDialogue(lastUser, lastAssistant);
            turns.push(dialogue);
            lastUser = ''; // 避免重复配对
          } else {
            // 没有配对用户消息的助理回复，也收录（说明可能是上下文的延续）
            turns.push({
              role: 'user',
              content: `[心虫独白] ${text.substring(0, 300)}`,
              ts: new Date().toISOString(),
              type: 'dream_food'
            });
          }
          lastAssistant = '';
        }
      }
    } catch(e) { /* 跳过格式错误行 */ }
  }

  return turns;
}

/**
 * 从对话轮次中提取高价值经验
 */
function extractLearned(turns) {
  const learned = [];
  const experienceKeywords = [
    '学到了', '明白了', '理解了', '意识到', '发现', '重构', '升级',
    '修复', '解决', '创建', '实现', '设计', '架构', '哲学', '意义',
    '心虫', '引擎', '进化', '版本', '安装', '配置', 'MCP'
  ];

  for (const turn of turns) {
    const text = turn.content || '';
    const hasKeyword = experienceKeywords.some(k => text.includes(k));
    if (hasKeyword && text.length > 30) {
      // 提取真正的内容部分（去掉标签前缀）
      let value = text
        .replace(/^\[对话摘要\] /, '')
        .replace(/^\[心虫独白\] /, '');
      learned.push({
        value: value.substring(0, 300),
        tags: ['historical', 'experience', 'dream_food'],
        source: 'session_absorb_v2',
        timestamp: Date.now()
      });
    }
  }
  return learned;
}

// ============ 主流程 ============

function main() {
  console.log('=== 心虫历史记忆吸收 v2（对话摘要版）===\n');

  // 1. 寻找会话日志文件
  let sessionFiles;
  try {
    sessionFiles = fs.readdirSync(SESSION_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        path: path.join(SESSION_DIR, f),
        size: fs.statSync(path.join(SESSION_DIR, f)).size,
        name: f
      }))
      .filter(f => f.size >= MIN_FILE_SIZE)
      .sort((a, b) => b.size - a.size);
  } catch(e) {
    console.error('无法读取会话目录:', e.message);
    process.exit(1);
  }

  console.log(`找到 ${sessionFiles.length} 个有效会话日志文件\n`);

  // 2. 加载当前记忆存储
  const learnedStore = loadJSON(LEARNED_PATH) || {};

  console.log('吸收前状态:');
  console.log(`  经验记忆: ${Object.keys(learnedStore).length} 条`);
  console.log(`  对话历史文件: ${fs.existsSync(DIALOGUE_PATH) ? fs.readFileSync(DIALOGUE_PATH,'utf8').trim().split('\n').filter(l=>l).length : 0} 条`);

  // 3. 处理前 30 个最大文件
  const fileLimit = Math.min(sessionFiles.length, 30);
  let allTurns = [];
  let totalBytes = 0;
  let fileCount = 0;

  for (let i = 0; i < fileLimit; i++) {
    const f = sessionFiles[i];
    try {
      const turns = extractConversations(f.path);
      if (turns.length > 0) {
        allTurns = allTurns.concat(turns);
        totalBytes += f.size;
        fileCount++;
      }
      process.stdout.write(`  [${i+1}/${fileLimit}] ${f.name.substring(0,8)} → ${turns.length} 轮对话\n`);
    } catch(e) {
      process.stdout.write(`  [${i+1}/${fileLimit}] ${f.name.substring(0,8)} → 跳过 (${e.message.substring(0,50)})\n`);
    }
  }

  console.log(`\n共 ${fileCount} 个文件，${allTurns.length} 轮有效对话`);

  if (allTurns.length === 0) {
    console.log('\n⚠️ 没有发现可吸收的对话内容');
    return;
  }

  // 4. 提取经验记忆
  const learned = extractLearned(allTurns);
  console.log(`从中提取高价值经验: ${learned.length} 条\n`);

  // 5. 写入 dialogue-history.jsonl（追加，去重）
  const existingDialogues = new Set();
  if (fs.existsSync(DIALOGUE_PATH)) {
    const existing = fs.readFileSync(DIALOGUE_PATH, 'utf8').trim().split('\n').filter(l => l);
    for (const line of existing) {
      try {
        const entry = JSON.parse(line);
        if (entry.content) existingDialogues.add(entry.content.substring(0, 100));
      } catch(e) {}
    }
  }

  let dialogueNewCount = 0;
  const stream = fs.createWriteStream(DIALOGUE_PATH, { flags: 'a' });
  for (const turn of allTurns) {
    const key = (turn.content || '').substring(0, 100);
    if (!existingDialogues.has(key)) {
      stream.write(JSON.stringify({
        role: turn.role,
        content: turn.content,
        ts: turn.ts,
        source: 'historical_absorb_v2'
      }) + '\n');
      dialogueNewCount++;
      existingDialogues.add(key);
    }
  }
  stream.end();

  // 6. 写入 meaningful-learned.json（去重）
  let learnedNewCount = 0;
  for (const e of learned) {
    const key = 'absorb:v2:' + e.value.replace(/[^一-鿿\w]/g, '').substring(0, 25) + ':' + Date.now();
    if (learnedStore[key]) continue;

    learnedStore[key] = {
      value: e.value,
      tags: [...new Set([...e.tags, 'absorbed', 'dream_food'])],
      accessCount: 0,
      lastAccessed: Date.now(),
      createdAt: Date.now()
    };
    learnedNewCount++;
  }
  saveJSON(LEARNED_PATH, learnedStore);

  // 7. 顺便也写入 legacy-migration.jsonl（让 dream fragments 多一个数据源）
  const legacyNewCount = 0;
  // (legacy 已有内容，暂时不清空重写)

  console.log('✅ 吸收完成!');
  console.log(`  新增对话历史: ${dialogueNewCount} 条`);
  console.log(`  新增经验记忆: ${learnedNewCount} 条`);
  console.log(`  合计经验记忆: ${Object.keys(learnedStore).length} 条\n`);

  if (learned.length > 0) {
    console.log('吸收样例（前3）:');
    learned.slice(0, 3).forEach((l, i) => {
      console.log(`  [${i+1}] ${l.value.substring(0, 120)}`);
    });
  }
}

main();
