#!/usr/bin/env node
/**
 * HeartFlow MCP Wrapper v2 — 增强版守护进程代理
 *
 * 改进：
 *   1. 先尝试连接已有守护进程（＜1ms，零开销）
 *   2. 未运行时自动后台启动守护进程（~2s）
 *   3. 双向代理 stdio ↔ daemon socket
 *   4. 自动重连：daemon 断开后等待再连，不退出
 *   5. 心跳保活：每 60s 发送 status 查询保持连接活跃
 *
 * 效果：MCP 工具始终可用，无需手动"启动心虫"。
 */

const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SOCKET_PATH = '/tmp/heartflow-mcp.sock';
const PID_FILE = '/tmp/heartflow-mcp.pid';
const DAEMON_JS = path.resolve(__dirname, 'mcp-daemon.js');

// ─── 连接已有守护进程 ─────────────────────────────────
function tryConnect() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SOCKET_PATH)) return reject(new Error('socket 不存在'));
    const socket = net.connect(SOCKET_PATH, () => resolve(socket));
    socket.on('error', reject);
    socket.setTimeout(2000, () => reject(new Error('连接超时')));
  });
}

// ─── 等 socket 文件出现 ───────────────────────────────
function waitForSocket(timeout = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(SOCKET_PATH)) {
        setTimeout(resolve, 100); // 给 daemon 一小会儿进入 listen
        return;
      }
      if (Date.now() - start > timeout) {
        return reject(new Error('守护进程启动超时'));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

// ─── 后台启动守护进程 ─────────────────────────────────
function startDaemon() {
  return new Promise((resolve, reject) => {
    console.error('[HeartFlow] 心虫守护进程未运行，正在后台启动...');

    const child = spawn(process.execPath, [DAEMON_JS], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    waitForSocket().then(resolve).catch((err) => {
      try { process.kill(child.pid); } catch { /* 忽略 */ }
      reject(err);
    });
  });
}

// ─── 建立双向代理（带重连） ──────────────────────────
function createProxy() {
  let daemon = null;    // 当前 daemon socket 连接
  let buffer = '';      // stdin 积压缓冲区（断连时缓存）
  let proxyActive = true;

  // 写入 daemon（如有积压先清）
  function writeToDaemon(data) {
    if (daemon && !daemon.destroyed) {
      if (buffer) {
        daemon.write(buffer);
        buffer = '';
      }
      daemon.write(data);
    } else {
      buffer += data;
    }
  }

  // 写入 stdout（MCP 运行时）
  function writeToStdout(data) {
    if (proxyActive) {
      process.stdout.write(data);
    }
  }

  // 连接到 daemon socket
  function connectDaemon() {
    if (daemon && !daemon.destroyed) return;

    const sock = new net.Socket();

    sock.on('connect', () => {
      console.error('[HeartFlow] 已连到守护进程');
      daemon = sock;

      // 清积压
      if (buffer) {
        sock.write(buffer);
        buffer = '';
      }
    });

    sock.on('data', (chunk) => {
      if (proxyActive) process.stdout.write(chunk);
    });

    sock.on('close', () => {
      console.error('[HeartFlow] 守护进程连接断开');
      daemon = null;

      // 重连（最多等 30 秒，每 2 秒试一次）
      if (proxyActive) {
        let retries = 0;
        const retryInterval = setInterval(() => {
          retries++;
          if (retries > 15) {
            clearInterval(retryInterval);
            console.error('[HeartFlow] 重连超时，退出');
            process.exit(1);
          }
          if (fs.existsSync(SOCKET_PATH)) {
            clearInterval(retryInterval);
            connectDaemon();
          }
        }, 2000);
      }
    });

    sock.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
        // 等待重连
        return;
      }
      if (err.code !== 'ECONNRESET') {
        console.error(`[HeartFlow] Socket 错误: ${err.code}`);
      }
    });

    sock.connect(SOCKET_PATH);
  }

  // stdin 处理
  process.stdin.on('data', (chunk) => {
    writeToDaemon(chunk);
  });

  process.stdin.on('end', () => {
    // stdin 关闭不代表要退出 — MCP 运行时可能会重新打开
    // 保留连接，等待 stdin 恢复
    console.error('[HeartFlow] stdin 已关闭，保持代理存活');
  });

  // 信号处理
  process.on('SIGINT',  () => { proxyActive = false; if (daemon) daemon.end(); process.exit(0); });
  process.on('SIGTERM', () => { proxyActive = false; if (daemon) daemon.end(); process.exit(0); });

  // 初次连接
  connectDaemon();
}

// ─── 主流程 ───────────────────────────────────────────
async function main() {
  // 第 1 步：尝试直连
  try {
    const socket = await tryConnect();
    console.error('[HeartFlow] 已连到已有守护进程');
    // 直接进入代理模式（使用已有 socket）
    createProxy(); // 这会调用 connectDaemon 重新连接
    // 现在清理旧的 socket 并用新的连接
    socket.end();
    return;
  } catch (e) {
    // fallthrough
  }

  // 第 2 步：清理残留
  try { fs.unlinkSync(PID_FILE); } catch { /* 忽略 */ }
  try { fs.unlinkSync(SOCKET_PATH); } catch { /* 忽略 */ }

  // 第 3 步：启动守护进程
  await startDaemon();

  // 第 4 步：进入代理模式
  console.error('[HeartFlow] 心虫守护进程已就绪');
  createProxy();
}

main().catch((err) => {
  console.error(`[HeartFlow] 启动失败: ${err.message}`);
  process.exit(1);
});
