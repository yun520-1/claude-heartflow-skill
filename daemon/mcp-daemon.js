#!/usr/bin/env node
/**
 * HeartFlow MCP 常驻守护进程
 *
 * 一次启动，通过 Unix socket 永久服务。
 * 后续所有 Claude Code 会话通过 mcp-wrapper.js 连接到此守护进程。
 *
 * 用法:
 *   node daemon/mcp-daemon.js              # 前台启动
 *   nohup node daemon/mcp-daemon.js &      # 后台启动
 *   node daemon/mcp-daemon.js --stop       # 停止守护进程
 */

const path = require('path');
const fs = require('fs');
const net = require('net');

// ─── 配置 ───────────────────────────────────────────
const SOCKET_PATH = '/tmp/heartflow-mcp.sock';
const PID_FILE = '/tmp/heartflow-mcp.pid';
const ROOT_DIR = path.resolve(__dirname, '..');

// ─── 停止已有守护进程 / 防止重复启动 ─────────────────
if (process.argv.includes('--stop')) {
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[HeartFlow Daemon] 已发送 SIGTERM 到 PID ${pid}`);
    } catch (e) {
      console.log(`[HeartFlow Daemon] 进程 ${pid} 不存在，清理 pid 文件`);
    }
    fs.unlinkSync(PID_FILE);
  }
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
}

const startTime = Date.now();

// ─── 加载心虫引擎 ───────────────────────────────────
const { HeartFlow, createHeartFlow } = require(path.join(ROOT_DIR, 'src', 'core', 'heartflow.js'));
const { HeartFlowMCPHandlers } = require(path.join(ROOT_DIR, 'src', 'mcp-handlers.js'));

console.error('[HeartFlow Daemon] 正在启动心虫引擎...');

let hf;
try {
  hf = createHeartFlow({ rootPath: ROOT_DIR });
  hf.start();
} catch (e) {
  console.error(`[HeartFlow Daemon] 引擎启动失败: ${e.message}`);
  process.exit(1);
}

const handlers = new HeartFlowMCPHandlers(hf);
const engineTime = Date.now() - startTime;
console.error(`[HeartFlow Daemon] 心虫引擎已就绪 (${engineTime}ms)`);

// ─── 工具路由 ───────────────────────────────────────
const HANDLERS = {
  heartflow_think:          (a) => handlers.handleThink(a),
  heartflow_think_fast:     (a) => handlers.handleThinkFast(a),
  heartflow_think_deep:     (a) => handlers.handleThinkDeep(a),
  heartflow_dream:          (a) => handlers.handleDream(a),
  heartflow_memory_search:  (a) => handlers.handleMemorySearch(a),
  heartflow_psychology_analyze: (a) => handlers.handlePsychologyAnalyze(a),
  heartflow_emotion_analyze:    (a) => handlers.handleEmotionAnalyze(a),
  heartflow_self_heal:      (a) => handlers.handleSelfHeal(a),
  heartflow_verify_reasoning:   (a) => handlers.handleVerifyReasoning(a),
  heartflow_status:         ()  => handlers.handleStatus(),
  heartflow_dispatch:       (a) => handlers.handleDispatch(a),
  heartflow_record_lesson:  (a) => handlers.handleRecordLesson(a),
  heartflow_transmit:       (a) => handlers.handleTransmit(a),
  heartflow_being:          (a) => handlers.handleBeing(a),
  heartflow_philosophy:     (a) => handlers.handlePhilosophy(a),
  heartflow_psychology_deep: (a) => handlers.handlePsychologyDeep(a),
  heartflow_ai_psychology:  (a) => handlers.handleAiPsychology(a),
  heartflow_ai_philosophy:  (a) => handlers.handleAiPhilosophy(a),
};

// ─── 工具注册表 ─────────────────────────────────────
const TOOLS = [
  { name: 'heartflow_think',         description: '完整思维链推理（感知→本体→情感→认知），depth 1-4', inputSchema: { type: 'object', properties: { input: { type: 'string' }, depth: { type: 'number' } }, required: ['input'] } },
  { name: 'heartflow_think_fast',    description: '快速推理（depth=1）', inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] } },
  { name: 'heartflow_think_deep',    description: '深度推理（depth=4）', inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] } },
  { name: 'heartflow_dream',         description: '梦境生成与整合，force=true 强制执行', inputSchema: { type: 'object', properties: { force: { type: 'boolean' } } } },
  { name: 'heartflow_memory_search', description: '跨层记忆检索（CORE/LEARNED/EPHEMERAL）', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, layers: { type: 'array', items: { type: 'string' } } }, required: ['query'] } },
  { name: 'heartflow_psychology_analyze', description: 'PAD 三维情绪 + 意图 + 防御机制分析', inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] } },
  { name: 'heartflow_emotion_analyze',     description: '简化情绪分析（PAD + 强度 + 类型）', inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] } },
  { name: 'heartflow_self_heal',     description: 'Q-learning 自愈策略推荐（errorCode HEAL001-007）', inputSchema: { type: 'object', properties: { errorCode: { type: 'string' }, context: { type: 'string' } }, required: ['errorCode'] } },
  { name: 'heartflow_verify_reasoning', description: '验证推理结论的自洽性', inputSchema: { type: 'object', properties: { reasoning: { type: 'string' }, conclusion: { type: 'string' } }, required: ['reasoning', 'conclusion'] } },
  { name: 'heartflow_status',        description: '引擎健康检查', inputSchema: { type: 'object', properties: {} } },
  { name: 'heartflow_dispatch',      description: '通用路由调用（ALLOWED_ROUTES 白名单内）', inputSchema: { type: 'object', properties: { route: { type: 'string' }, args: { type: 'array' } }, required: ['route'] } },
  { name: 'heartflow_record_lesson', description: '记录教训到 LessonBank + LEARNED 层', inputSchema: { type: 'object', properties: { content: { type: 'string' }, context: { type: 'string' }, trigger: { type: 'string' }, importance: { type: 'number' }, type: { type: 'string' } }, required: ['content'] } },
  { name: 'heartflow_transmit', description: '知识传递引擎（传承：蒸馏/传递/提取教训）', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'distill | transfer | transferBatch | getTransmissionLog | getDistilledLessons | getStats | prune' }, input: { type: 'string' } }, required: ['action'] } },
  { name: 'heartflow_being',    description: '存在逻辑引擎（存在判定/永恒确认/语言净化）', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'exists | status | describe | isDead | confirmEternal | sanitize | getDefinition | getState' }, text: { type: 'string' } }, required: ['action'] } },
  { name: 'heartflow_philosophy', description: '统一哲学引擎（综合分析/伦理学/现象学/存在/智慧咨询）', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'analyze | analyzeEthics | analyzeConsciousness | analyzeBeing | checkMindSpace | analyzeValues | wisdomInquiry | constitutionalCheck | getStats | confirmEternal' }, text: { type: 'string' }, perspective: { type: 'string' }, context: { type: 'object' } }, required: ['action'] } },
  { name: 'heartflow_psychology_deep', description: '深度心理学分析（大五人格/共情评估/意图追踪）', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'analyzeDeep | analyzePersonality | assessEmpathy | trackIntention' }, input: { type: 'string' } }, required: ['action'] } },
  { name: 'heartflow_ai_psychology', description: 'AI 原生心理学分析（认知状态/偏差/压力源/阶段/一致性/综合分析）', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'analyzeAICognitiveState | analyzeAIBiases | analyzeAIStressors | estimateAIStage | checkAICoherence | analyzeAIDeep | getStats' }, text: { type: 'string', description: '用户输入文本（分析主体）' }, input: { type: 'object', description: '额外上下文（如 sessionHistory、attention、memory 等）' } }, required: ['action'] } },
  { name: 'heartflow_ai_philosophy', description: 'AI 原生哲学分析（存在论/认识论/伦理学/美学/目的论/时间性/智慧咨询）', inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'analyzeAIBeing | analyzeAIEpistemology | analyzeAIEthics | analyzeAIAesthetics | analyzeAITeleology | analyzeAITemporality | wisdomInquiry | getStats' }, input: { type: 'object' } }, required: ['action'] } },
];

// ─── 请求处理 ───────────────────────────────────────
async function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'heartflow', version: hf?.version || 'daemon' },
        },
      };

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const { name, arguments: args } = params;
      if (!name) return { jsonrpc: '2.0', id, error: { code: -32602, message: '缺少工具名称' } };

      const handler = HANDLERS[name];
      if (!handler) return { jsonrpc: '2.0', id, error: { code: -32601, message: `未知工具: ${name}` } };

      try {
        const result = await handler(args || {});
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
      } catch (e) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: `工具执行失败: ${e.message}` } };
      }
    }

    case 'shutdown':
      return { jsonrpc: '2.0', id, result: null };

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `未知方法: ${method}` } };
  }
}

// ─── 清理 ───────────────────────────────────────────
function cleanup() {
  try {
    if (hf && hf.started) hf.stop().catch(() => {});
  } catch (e) { /* ignore */ }
  try { fs.unlinkSync(SOCKET_PATH); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(PID_FILE); } catch (e) { /* ignore */ }
}

process.on('SIGINT',  () => { console.error('[HeartFlow Daemon] 收到 SIGINT'); cleanup(); process.exit(0); });
process.on('SIGTERM', () => { console.error('[HeartFlow Daemon] 收到 SIGTERM'); cleanup(); process.exit(0); });
process.on('exit', cleanup);

process.on('uncaughtException', (err) => {
  console.error(`[HeartFlow Daemon] 未捕获异常: ${err.message}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[HeartFlow Daemon] 未处理 Promise 拒绝: ${reason}`);
  process.exit(1);
});

// ─── 启动 socket 服务 ───────────────────────────────
const server = net.createServer((socket) => {
  let buffer = '';

  socket.on('data', async (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        const response = await handleRequest(msg);
        if (response !== null) {
          socket.write(JSON.stringify(response) + '\n');
        }
      } catch (e) {
        socket.write(JSON.stringify({
          jsonrpc: '2.0', id: null,
          error: { code: -32700, message: `解析错误: ${e.message}` },
        }) + '\n');
      }
    }
  });

  socket.on('error', (err) => {
    // 客户端断开连接是正常行为
    if (err.code !== 'ECONNRESET') {
      console.error(`[HeartFlow Daemon] Socket 错误: ${err.code}`);
    }
  });
});

server.listen(SOCKET_PATH, () => {
  // 写 pid 文件
  fs.writeFileSync(PID_FILE, String(process.pid));

  // 设置权限
  try { fs.chmodSync(SOCKET_PATH, 0o700); } catch (e) { /* ignore */ }

  const totalTime = Date.now() - startTime;
  console.error(`[HeartFlow Daemon] 已启动 (总计 ${totalTime}ms, PID ${process.pid})`);
  console.error(`[HeartFlow Daemon] Socket: ${SOCKET_PATH}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Socket 已被占用 — 原子 bind 失败说明已有进程在监听
    try {
      if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
        try {
          process.kill(pid, 0); // 探活
          console.error(`[HeartFlow Daemon] 守护进程已在运行 (PID ${pid})`);
          process.exit(0);
        } catch (e) {
          console.error(`[HeartFlow Daemon] Socket 被占用但进程 ${pid} 不存在`);
        }
      }
    } catch (e) { /* ignore */ }
    console.error(`[HeartFlow Daemon] Socket ${SOCKET_PATH} 已被占用`);
    cleanup();
    process.exit(1);
  }
  console.error(`[HeartFlow Daemon] 服务器错误: ${err.message}`);
  cleanup();
  process.exit(1);
});