import fastify from 'fastify';
import { readFileSync, readdirSync } from "fs";
import { spawn } from 'child_process';
import fastifyCors from 'fastify-cors';
import fastifyWebSocket from 'fastify-websocket';
import * as ws from 'ws';
import * as rpc from 'vscode-ws-jsonrpc';
import * as rpcServer from 'vscode-ws-jsonrpc/lib/server';
import { build_project as build_c_project, requestBodySchema as requestCBodySchema, RequestBody as RequestCBody } from './chooks';
import { build_project as build_js_project, requestBodySchema as requestJSBodySchema, RequestBody as RequestJSBody } from './jshooks';
import { sandbox_status } from './sandbox';

// Defense in depth: a stray async error (e.g. a broken clangd stdio pipe) must
// never take down the shared compile API. Log and keep serving instead of
// letting the default handler crash the process.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (ignored to keep service alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (ignored to keep service alive):', reason);
});

const server = fastify();

// Lightweight in-memory per-IP rate limiting for the (unauthenticated) compile
// endpoints. Each build spawns compilers, so this caps trivial abuse/DoS.
// Tune with BUILD_RATE_MAX / BUILD_RATE_WINDOW_MS; set BUILD_RATE_MAX=0 to
// disable.
const RATE_MAX = Number(process.env.BUILD_RATE_MAX || 60);
const RATE_WINDOW_MS = Number(process.env.BUILD_RATE_WINDOW_MS || 60_000);
const rateHits = new Map<string, { count: number; reset: number }>();

function rate_limited(ip: string): boolean {
  if (!(RATE_MAX > 0)) {
    return false;
  }
  const now = Date.now();
  const entry = rateHits.get(ip);
  if (!entry || now >= entry.reset) {
    rateHits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    if (rateHits.size > 10000) {
      const stale: string[] = [];
      rateHits.forEach((v, k) => {
        if (now >= v.reset) {
          stale.push(k);
        }
      });
      for (const k of stale) {
        rateHits.delete(k);
      }
    }
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

server.register(fastifyCors, {
  // put your options here
  origin: '*'
})
server.register(fastifyWebSocket);

// Compilation code
const llvmDir = process.cwd() + "/clang/wasi-sdk";
const tempDir = "/tmp";

export interface ResponseData {
  success: boolean;
  message: string;
  output: string;
  tasks: Task[];
}

export interface Task {
  name: string;
  file?: string;
  success?: boolean;
  console?: string;
  output?: string;
}

server.post('/api/build', async (req, reply) => {
  // Bail out early if not HTTP POST
  if (req.method !== 'POST') {
    return reply.code(405).send('405 Method Not Allowed');
  }
  if (rate_limited(req.ip)) {
    return reply.code(429).send('429 Too Many Requests');
  }
  const baseName = tempDir + '/build_' + Math.random().toString(36).slice(2);
  let body: RequestCBody | undefined;
  try {
    body = requestCBodySchema.parse(req.body);
  } catch (err) {
    console.log(err)
    return reply.code(400).send('400 Bad Request')
  }
  try {
    console.log('Building in ', baseName);
    const result = build_c_project(body, baseName);
    return reply.code(200).send(result);
  } catch (ex) {
    console.error(ex);
    return reply.code(500).send(`500 Internal server error: ${ex}`)
  }
  // return reply.code(200).send({ hello: 'world' });
});

server.post('/api/build/js', async (req, reply) => {
  // Bail out early if not HTTP POST
  if (req.method !== 'POST') {
    return reply.code(405).send('405 Method Not Allowed');
  }
  if (rate_limited(req.ip)) {
    return reply.code(429).send('429 Too Many Requests');
  }
  const baseName = tempDir + '/build_' + Math.random().toString(36).slice(2);
  let body: RequestJSBody | undefined;
  try {
    body = requestJSBodySchema.parse(req.body);
  } catch (err) {
    console.log(err)
    return reply.code(400).send('400 Bad Request')
  }
  try {
    console.log('Building in ', baseName);
    const result = build_js_project(body, baseName);
    return reply.code(200).send(result);
  } catch (ex) {
    console.error(ex);
    return reply.code(500).send(`500 Internal server error: ${ex}`)
  }
  // return reply.code(200).send({ hello: 'world' });
});

server.get('/', async (req, reply) => {
  reply.code(200).send('ok')
})

function toSocket(webSocket: ws): rpc.IWebSocket {
  return {
    send: content => webSocket.send(content),
    onMessage: cb => webSocket.onmessage = event => cb(event.data),
    onError: cb => webSocket.onerror = event => {
      if ('message' in event) {
        cb((event as any).message)
      }
    },
    onClose: cb => webSocket.onclose = event => cb(event.code, event.reason),
    dispose: () => webSocket.close()
  }
}

server.get('/language-server/c', { websocket: true }, (connection /* SocketStream */, req /* FastifyRequest */) => {
  // Spawn clangd ourselves (instead of rpcServer.createServerProcess) so we can
  // attach 'error' handlers to its stdio pipes. createServerProcess only guards
  // the process and stderr, leaving stdin/stdout unhandled: a client that
  // disconnects or desyncs mid-stream triggers an EPIPE/write error on clangd's
  // stdin, which with no listener becomes an unhandled exception that crashes
  // the whole Node process and takes the shared compile API offline.
  const serverProcess = spawn('clangd', ['--compile-commands-dir=/etc/clangd', '--limit-results=200']);

  const socket: rpc.IWebSocket = toSocket(connection.socket);

  let disposed = false;
  const dispose = (reason: string) => {
    if (disposed) return;
    disposed = true;
    console.log('Tearing down language-server session:', reason);
    try { serverProcess.kill(); } catch (err) { console.error('Error killing clangd:', err); }
    try { socket.dispose(); } catch (err) { console.error('Error closing socket:', err); }
  };

  // Guard every stream that can emit an async 'error'. Any of these firing
  // without a listener would otherwise crash the whole process; here they only
  // tear down this one session.
  serverProcess.on('error', (err) => dispose(`clangd process error: ${err}`));
  serverProcess.on('exit', (code, sig) => dispose(`clangd exited (code=${code}, signal=${sig})`));
  serverProcess.stdin?.on('error', (err) => dispose(`clangd stdin error: ${err}`));
  serverProcess.stdout?.on('error', (err) => dispose(`clangd stdout error: ${err}`));
  serverProcess.stderr?.on('data', (data) => console.error(`clangd: ${data}`));
  connection.socket.on('error', (err) => dispose(`websocket error: ${err}`));

  try {
    const localConnection = rpcServer.createProcessStreamConnection(serverProcess);
    const newConnection = rpcServer.createWebSocketConnection(socket);
    rpcServer.forward(newConnection, localConnection);
    console.log(`Forwarding new client`);
  } catch (err) {
    dispose(`failed to set up forwarding: ${err}`);
    return;
  }

  socket.onClose((code, reason) => dispose(`client closed: ${reason}`));
})

server.get('/api/header-files', async (req, reply) => {
  const dirPath = './clang/includes';
  var files = new Map<string, string>();
  readdirSync(dirPath).forEach(fname => {
    const nameExt = fname.split('.');
    if ((nameExt.length === 2) && nameExt[0] && (nameExt[1].toLowerCase() === 'h')) {
      const content = readFileSync(dirPath + '/' + fname);
      files.set(nameExt[0], content.toString());
    }
  });
  const rsp = Object.fromEntries(files);
  reply.code(200).send(rsp);
})

server.listen(process.env.PORT || 9000, process.env.HOST || '::', (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(sandbox_status())
  console.log(`Server listening at ${address}`)
});
