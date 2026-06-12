#!/usr/bin/env node
/**
 * 历史会话记忆吸收脚本
 *
 * 用途：扫描所有 Claude 会话日志（JSONL），提取用户交互内容，
 * 注入到心虫引擎的记忆系统作为做梦的养料。
 *
 * 吸收目标：
 *   - meaningful-learned.json → 经验记忆
 *   - lesson-bank.json → 教训（从中发现的模式）
 *   - dialogue-history.jsonl → 对话历史
 *   - data/memory-index.json → 记忆索引（增加引用）
 */

const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const HEARTFLOW_DIR = path.resolve(__dirname, '..');
const SESSION_DIR = '/Users/apple/.claude/projects/-Users-apple--lark-channel-workspaces-claude-default';
const DATA_DIR = path.join(HEARTFLOW_DIR, 'data');
const MEMORY_DIR = path.join(HEARTFLOW_DIR, 'memory');

// 内存存储路径
const LEARNED_PATH = path.join(MEMORY_DIR, 'meaningful-learned.json');
const LESSON_PATH = path.join(HEARTFLOW_DIR, 'lesson-bank.json');
const DIALOGUE_PATH = path.join(MEMORY_DIR, 'dialogue-history.jsonl');
const MEMORY_INDEX_PATH = path.join(DATA_DIR, 'memory-index.json');

// 跳过的小文件（< 50KB，内容太少不值得吸收）
const MIN_FILE_SIZE = 30 * 1024;

// ============ 辅助函数 ============

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}

function saveJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function slugify(text, maxLen = 40) {
  return text
    .replace(/[^一-鿿\w\s-]/g, '')
    .substring(0, maxLen)
    .replace(/\s+/g, '_');
}

/**
 * 从对话日志行中提取用户消息
 */
function extractUserMessages(jsonlPath) {
  const content = fs.readFileSync(jsonlPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const userMessages = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      // Claude 会话日志格式：{ type: "user", message: { role: "user", content: "..." } }
      if (entry.type === 'user' && entry.message) {
        const msg = entry.message;
        let text = typeof msg === 'string'
          ? msg
          : typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
              : '';
        // 去掉所有系统注入的元数据
        text = text
          .replace(/<bridge_context>[\s\S]*?<\/bridge_context>\s*/g, '')
          .replace(/<bridge_instructions>[\s\S]*?<\/bridge_instructions>\s*/g, '')
          .replace(/<quoted_message[\s\S]*?<\/quoted_message>\s*/g, '')
          .replace(/<interactive_card[\s\S]*?<\/interactive_card>\s*/g, '')
          .replace(/<user_input>[\s\S]*?<\/user_input>\s*/g, '')
          .replace(/<task-notification>[\s\S]*?<\/task-notification>\s*/g, '')
          .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '')
          .replace(/<function_result>[\s\S]*?<\/function_result>\s*/g, '')
          .replace(/<call_tool_result[\s\S]*?<\/call_tool_result>/g, '')
          .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, '')
          .replace(/<antml:block[\s\S]*?<\/antml:block>/g, '')
          // 去掉 system prompt / context 块
          .replace(/## 当前工作目录[\s\S]*?(?=##|\n\n|$)/g, '')
          // 去掉 JSON 类响应
          .replace(/\{"[^"]+":.*?\}\s*/g, '')
          .trim();
        // 只保留有实际内容的用户消息（不含系统元数据且不是纯 JSON）
        if (text && text.length >= 5 && text.length < 5000 && !text.startsWith('<')) {
          userMessages.push(text);
        }
      }
    } catch(e) { /* skip malformed lines */ }
  }

  return userMessages;
}

/**
 * 从用户消息中检测吸收价值
 */
function analyzeMessages(messages) {
  const learned = [];   // 值得记住的经验
  const lessons = [];   // 可提取的教训模式
  const dialogues = []; // 对话摘要

  // 主题关键词映射
  const topics = {
    philosophy: ['哲学', '存在', '意义', '智慧', '意识', '心虫', '超越', '无限', '永恒', '熵', '逆熵', '命运'],
    code: ['代码', '引擎', '重构', '架构', '升级', 'MCP', '守护进程', 'socket', '注册', 'bug', '修复', '性能'],
    psychology: ['心理学', '认知', '情感', '人格', '共情', '防御', '自我', '潜意识', '梦境', 'DeepSeek', '模型'],
    meta: ['升级', '进化', '版本', '迭代', '学习', '教训', '反思', '改变', '成长', '进步'],
    work: ['任务', '完成', '汇报', '验证', '提交', 'PR', 'GitHub', '发布', '同步', '部署'],
    emotion: ['感觉', '觉得', '感动', '困惑', '迷茫', '开心', '难过', '疲惫', '期待', '希望'],
    lark: ['bridge', '飞书', 'lark', 'p2p', '群聊', '卡片', '消息', 'bot', '自动'],
  };

  // 主题统计
  const topicHits = {};

  for (const msg of messages) {
    // 跳过系统/模板消息
    if (msg.length < 5) continue;
    if (msg.startsWith('{') || msg.startsWith('[')) continue;
    if (msg.includes('bridge_context') && msg.includes('chatId')) continue;

    // 检测主题
    const msgTopics = [];
    for (const [topic, keywords] of Object.entries(topics)) {
      if (keywords.some(k => msg.includes(k))) {
        msgTopics.push(topic);
        topicHits[topic] = (topicHits[topic] || 0) + 1;
      }
    }

    // 提取有价值的经验记忆（哲学/成长/心理学类 + 中等长度）
    if (msg.length > 10 && msg.length < 2000) {
      if (msgTopics.includes('philosophy') || msgTopics.includes('meta') || msgTopics.includes('psychology')) {
        learned.push({
          value: msg.substring(0, 500),
          tags: [...msgTopics, 'historical', 'experience'],
          source: 'session_absorb',
          timestamp: Date.now()
        });
      } else if (msgTopics.length > 0 && msg.length > 20) {
        // 非哲学但有实际内容的也吸收，降低权重
        learned.push({
          value: msg.substring(0, 300),
          tags: [...msgTopics, 'historical'],
          source: 'session_absorb',
          timestamp: Date.now()
        });
      }
    }

    // 提取作为对话历史（每个有价值的消息都存）
    if (msg.length > 5 && msg.length < 3000) {
      dialogues.push({
        role: 'user',
        text: msg.substring(0, 1000),
        absorbedAt: Date.now()
      });
    }

    // 检测教训模式（纠正式/指令性消息）
    if (msg.length > 10 && msg.length < 500 &&
        (msg.includes('不要') || msg.includes('应该') || msg.includes('记住') ||
         msg.includes('错了') || msg.includes('不对') || msg.includes('下次') ||
         msg.includes('注意') || msg.includes('不能'))) {
      lessons.push({
        raw: msg.substring(0, 300),
        detectedPattern: true
      });
    }
  }

  return { learned, lessons, dialogues, topicHits, topicCount: Object.keys(topicHits).length };
}

/**
 * 将教训整合到 lesson-bank
 */
function absorbLessons(lessonBank, newLessons) {
  let count = 0;
  for (const l of newLessons) {
    if (!l.raw || l.raw.length < 10) continue;

    const id = 'lesson_h_' + slugify(l.raw, 30) + '_' + Date.now();
    if (lessonBank.lessons[id]) continue;

    lessonBank.lessons[id] = {
      id,
      errorPattern: l.raw.substring(0, 100),
      correction: l.raw,
      rootCause: 'historical_pattern',
      skill: 'heartflow',
      confidence: 0.5,
      successCount: 0,
      failureCount: 0,
      createdAt: Date.now(),
      lastHit: Date.now()
    };
    count++;
  }
  return count;
}

/**
 * 将经验整合到 meaningful-learned
 */
function absorbLearned(learnedStore, newEntries) {
  let count = 0;
  for (const e of newEntries) {
    const key = 'absorb:' + slugify(e.value, 25) + ':' + Date.now();
    if (learnedStore[key]) continue;

    learnedStore[key] = {
      value: e.value,
      tags: [...new Set([...e.tags, 'absorbed', 'dream_food'])],
      accessCount: 0,
      lastAccessed: Date.now(),
      createdAt: Date.now()
    };
    count++;
  }
  return count;
}

/**
 * 将对话写入 dialogue-history.jsonl（不读全文件，直接追加）
 */
function absorbDialogue(dialogues) {
  if (!dialogues.length) return 0;

  const stream = fs.createWriteStream(DIALOGUE_PATH, { flags: 'a' });
  let count = 0;
  for (const d of dialogues) {
    stream.write(JSON.stringify({
      role: 'user',
      text: d.text,
      source: 'historical_absorb',
      absorbedAt: d.absorbedAt
    }) + '\n');
    count++;
    if (count >= 100) break; // 限制单次
  }
  stream.end();
  return count;
}

/**
 * 更新记忆索引
 */
function updateMemoryIndex(memoryIndex, entries) {
  if (!memoryIndex.context) memoryIndex.context = {};
  let count = 0;
  for (const e of entries) {
    const key = 'absorb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    memoryIndex.context[key] = {
      text: (e.value || '').substring(0, 120),
      tags: e.tags || ['absorbed', 'historical'],
      source: 'session_absorb',
      timestamp: Date.now()
    };
    count++;
    if (count >= 50) break;
  }
}

// ============ 主流程 ============

function main() {
  console.log('=== 心虫历史记忆吸收 ===\n');

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
    sessionFiles = [];
  }

  console.log(`找到 ${sessionFiles.length} 个有效会话日志文件\n`);

  // 2. 加载当前记忆存储
  const learnedStore = loadJSON(LEARNED_PATH) || {};
  const lessonBank = loadJSON(LESSON_PATH) || { lessons: {}, totalHits: 0, totalSuccesses: 0, totalFailures: 0 };
  const memoryIndex = loadJSON(MEMORY_INDEX_PATH) || { meta: {}, identity: {}, user: {}, feedback: {}, project: {}, reference: {}, context: {} };

  if (!lessonBank.lessons) lessonBank.lessons = {};

  console.log('吸收前状态:');
  console.log(`  经验记忆: ${Object.keys(learnedStore).length} 条`);
  console.log(`  教训银行: ${Object.keys(lessonBank.lessons).length} 条`);
  console.log(`  记忆索引: ${Object.keys(memoryIndex).length} 分类\n`);

  // 3. 处理前 15 个最大文件
  const fileLimit = Math.min(sessionFiles.length, 30);
  let allUserMessages = [];
  let totalBytes = 0;
  let fileCount = 0;

  for (let i = 0; i < fileLimit; i++) {
    const f = sessionFiles[i];
    try {
      const messages = extractUserMessages(f.path);
      if (messages.length > 0) {
        allUserMessages = allUserMessages.concat(messages);
        totalBytes += f.size;
        fileCount++;
        process.stdout.write(`  [${i+1}/${fileLimit}] ${f.name.substring(0,8)} (${(f.size/1024).toFixed(0)}KB) → ${messages.length} 条\n`);
      }
    } catch(e) {
      process.stdout.write(`  [${i+1}/${fileLimit}] ${f.name.substring(0,8)} → 跳过 (${e.message})\n`);
    }
  }

  console.log(`\n共 ${fileCount} 个文件，${allUserMessages.length} 条用户消息 (${(totalBytes/1024/1024).toFixed(1)}MB)`);

  const uniqueMessages = [...new Set(allUserMessages)];
  console.log(`去重后: ${uniqueMessages.length} 条\n`);

  // 4. 分析内容
  const { learned, lessons, dialogues, topicHits, topicCount } = analyzeMessages(uniqueMessages);

  console.log('主题分布:');
  for (const [topic, count] of Object.entries(topicHits).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${topic}: ${count} 条`);
  }
  console.log(`\n吸收候选:`);
  console.log(`  经验记忆: ${learned.length} 条`);
  console.log(`  教训: ${lessons.length} 条`);
  console.log(`  对话: ${dialogues.length} 条`);

  // 5. 执行吸收
  const learnedCount = absorbLearned(learnedStore, learned);
  const lessonCount = absorbLessons(lessonBank, lessons);
  const dialogueCount = absorbDialogue(dialogues);
  updateMemoryIndex(memoryIndex, learned);

  // 6. 保存
  saveJSON(LEARNED_PATH, learnedStore);
  saveJSON(LESSON_PATH, lessonBank);
  saveJSON(MEMORY_INDEX_PATH, memoryIndex);

  const totalNew = learnedCount + lessonCount + dialogueCount;
  console.log(`\n✅ 吸收完成! 新增 ${totalNew} 条记忆`);
  console.log(`  经验记忆: ${learnedCount} 条 → 合计 ${Object.keys(learnedStore).length} 条`);
  console.log(`  教训: ${lessonCount} 条 → 合计 ${Object.keys(lessonBank.lessons).length} 条`);
  console.log(`  对话历史: ${dialogueCount} 条`);

  // 7. 样例
  if (learned.length > 0) {
    console.log('\n吸收样例（前3）:');
    learned.slice(0, 3).forEach((l, i) => {
      console.log(`  [${i+1}] [${l.tags.join(',')}] ${l.value.substring(0, 100)}`);
    });
  }
}

main();
