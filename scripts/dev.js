const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const HOST = process.env.VITE_HOST || 'localhost';
const PORT = Number(process.env.VITE_PORT || 5173);
const DEV_URL = `http://${HOST}:${PORT}`;

let viteProcess = null;
let electronProcess = null;
let shuttingDown = false;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function waitForHttp(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(true);
      });

      request.on('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Vite nao respondeu em ${url}.`));
          return;
        }
        setTimeout(check, 300);
      });

      request.setTimeout(2000, () => {
        request.destroy();
      });
    };

    check();
  });
}

function readHttpText(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString('utf8'); });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ statusCode: response.statusCode, body });
      });
    });

    request.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    request.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new Error(`Timeout lendo ${url}.`));
    });
  });
}

async function assertViteServer() {
  const viteClient = await readHttpText(`${DEV_URL}/@vite/client`);
  const appHtml = await readHttpText(DEV_URL);
  const looksLikeVite = /createHotContext|hot\.accept|vite/i.test(viteClient.body);
  const looksLikeSoundforge = /<script[^>]+src="\/src\/main\.jsx"/i.test(appHtml.body) || /Soundforge/i.test(appHtml.body);
  if (viteClient.statusCode !== 200 || appHtml.statusCode !== 200 || !looksLikeVite || !looksLikeSoundforge) {
    throw new Error(`A porta ${PORT} esta ocupada, mas nao parece ser o Vite deste projeto.`);
  }
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    windowsHide: false,
    shell: false,
    ...options
  });
}

function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill();
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopProcess(electronProcess);
  stopProcess(viteProcess);
  process.exit(code);
}

async function main() {
  const portInUse = await isPortOpen(PORT);

  if (portInUse) {
    console.log(`[dev] Reaproveitando Vite em ${DEV_URL}.`);
    await waitForHttp(DEV_URL, 5000);
    await assertViteServer();
  } else {
    const viteBin = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
    viteProcess = spawnChild(process.execPath, [viteBin, '--host', HOST, '--port', String(PORT), '--strictPort']);
    viteProcess.on('exit', (code) => {
      if (!shuttingDown && code !== 0) shutdown(code || 1);
    });
    await waitForHttp(DEV_URL);
    await assertViteServer();
  }

  electronProcess = spawnChild(process.execPath, [path.join(__dirname, 'run-electron.js'), '.']);
  electronProcess.on('exit', (code) => shutdown(code || 0));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((err) => {
  console.error(`[dev] ${err.message || err}`);
  shutdown(1);
});
