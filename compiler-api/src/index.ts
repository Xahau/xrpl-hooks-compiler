import fastify from 'fastify';
import { readFileSync, readdirSync } from "fs";
import fastifyCors from 'fastify-cors';
import fastifyWebSocket from 'fastify-websocket';
import { build_project as build_c_project, requestBodySchema as requestCBodySchema, RequestBody as RequestCBody } from './chooks';
import { handleCLanguageServer } from './language-server/c';
import { build_project as build_js_project, requestBodySchema as requestJSBodySchema, RequestBody as RequestJSBody } from './jshooks';

const server = fastify();

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

server.get('/language-server/c', { websocket: true }, (connection, req) => {
  handleCLanguageServer(connection, {
    tempDir: tempDir,
    hookHeadersDir: process.cwd() + '/clang/includes',
  });
});

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
  console.log(`Server listening at ${address}`)
});
