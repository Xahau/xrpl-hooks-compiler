import fastify from 'fastify';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import fastifyCors from 'fastify-cors';
import fastifyWebSocket from 'fastify-websocket';
import * as ws from 'ws';
import * as rpc from 'vscode-ws-jsonrpc';
import * as rpcServer from 'vscode-ws-jsonrpc/lib/server';
import { build_project as build_c_project, requestBodySchema as requestCBodySchema, RequestBody as RequestCBody } from './chooks';
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
  // create a temporary directory for the workspace
  const workspaceDir = tempDir + '/language-server' + '/ls_' + Math.random().toString(36).slice(2);
  
  console.log('Workspace directory: ', workspaceDir);
  mkdirSync(workspaceDir);
  console.log('mkdirSync: ')
  
  console.log(`Creating workspace directory: ${workspaceDir}`);
  
  // run clangd with the following arguments
  let localConnection = rpcServer.createServerProcess('Clangd process', 'clangd', [
    `--compile-commands-dir=/etc/clangd`,
    `--limit-results=200`,
    `--background-index=false`
  ], {
    cwd: workspaceDir
  });
  
  // intercept messages from the client and process them
  let initialized = false;
  let messageHandler: ((data: any) => void) | null = null;
  const openDocuments = new Set<string>(); // track opened documents
  
  // helper function to ensure a file is opened in clangd
  const ensureDocumentOpen = (uri: string, text?: string): string => {
    const fileName = uri.replace(/^file:\/\//, '');
    const filePath = join(workspaceDir, fileName);
    const fileUri = `file://${filePath}`;
    
    if (!openDocuments.has(fileUri)) {
      console.log('Auto-opening document:', fileUri);
      
      // create the directory if it doesn't exist
      const dir = join(workspaceDir, fileName.split('/').slice(0, -1).join('/'));
      if (dir !== workspaceDir) {
        mkdirSync(dir, { recursive: true });
      }
      
      // read file content if not provided
      let fileContent = text;
      console.log('fileContent: ', fileContent);
      if (!fileContent && existsSync(filePath)) {
        fileContent = readFileSync(filePath, 'utf-8');
      } else if (!fileContent) {
        fileContent = ''; // empty file if it doesn't exist
      }
      
      // write the file to the temporary directory
      writeFileSync(filePath, fileContent);
      
      // send textDocument/didOpen to clangd
      if (messageHandler) {
        const didOpenMessage = {
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: fileUri,
              languageId: fileName.endsWith('.h') ? 'c' : 'c',
              version: 1,
              text: fileContent
            }
          }
        };
        console.log('Sending didOpen for:', fileUri);
        messageHandler(JSON.stringify(didOpenMessage));
      }
      
      openDocuments.add(fileUri);
    }
    
    return fileUri;
  };
  
  // helper function to convert LSP Position to text offset
  const positionToOffset = (text: string, position: { line: number; character: number }): number => {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for newline character
    }
    return offset + Math.min(position.character, lines[position.line]?.length || 0);
  };

  // helper function to apply a single change to text
  const applyChange = (originalText: string, change: {
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
    rangeLength?: number;
    text: string;
  }): string => {
    // Full text replacement (no range specified)
    if (!change.range) {
      return change.text;
    }
    
    // Range-based replacement
    const startOffset = positionToOffset(originalText, change.range.start);
    const endOffset = positionToOffset(originalText, change.range.end);
    
    return originalText.slice(0, startOffset) + change.text + originalText.slice(endOffset);
  };
  
  // create a custom IWebSocket that intercepts messages
  const interceptedSocket: rpc.IWebSocket = {
    send: (content) => connection.socket.send(content),
    onMessage: (cb) => {
      console.log('onMessage callback registered');
      messageHandler = cb;
      connection.socket.onmessage = (event) => {
        const data = event.data;
        console.log('Raw message received:', data.toString().substring(0, 100));
        
        try {
          const message = JSON.parse(data.toString());
          console.log('Parsed message method:', message.method);
          
          // set the workspace folder
          if (message.method === 'initialize' && !initialized) {
            initialized = true;
            console.log('Initializing workspace:', workspaceDir);
            // set the workspace folder 
            if (!message.params) {
              message.params = {};
            }
            if (!message.params.workspaceFolders) {
              message.params.workspaceFolders = [{
                uri: `file://${workspaceDir}`,
                name: 'workspace'
              }];
            }
          }
          
          // handle textDocument/didOpen messages and write the file to the temporary directory
          if (message.method === 'textDocument/didOpen' && message.params?.textDocument) {
            const uri = message.params.textDocument.uri;
            const text = message.params.textDocument.text;
            
            console.log('textDocument/didOpen received, URI:', uri);
            
            // extract the file name from the URI (example: file://file.c -> file.c)
            const fileName = uri.replace(/^file:\/\//, '');
            const filePath = join(workspaceDir, fileName);
            
            // create the directory if it doesn't exist
            const dir = join(workspaceDir, fileName.split('/').slice(0, -1).join('/'));
            if (dir !== workspaceDir) {
              mkdirSync(dir, { recursive: true });
            }
            
            // write the file to the temporary directory
            console.log('Writing file to ', filePath);
            writeFileSync(filePath, text);
            
            // convert the URI to file:// URI
            const fileUri = `file://${filePath}`;
            message.params.textDocument.uri = fileUri;
            openDocuments.add(fileUri);
          }
          
          // handle textDocument/didChange messages and update the file in the temporary directory
          if (message.method === 'textDocument/didChange' && message.params?.textDocument) {
            const uri = message.params.textDocument.uri;
            
            console.log('textDocument/didChange received, URI:', uri);
            
            // ensure the document is open
            const fileUri = ensureDocumentOpen(uri);
            
            const fileName = uri.replace(/^file:\/\//, '');
            const filePath = join(workspaceDir, fileName);
            
            // apply the changes to the file
            if (message.params.contentChanges && message.params.contentChanges.length > 0) {
              console.log('Content changes:', message.params.contentChanges.length);
              
              // read current file content
              let currentContent = '';
              if (existsSync(filePath)) {
                currentContent = readFileSync(filePath, 'utf-8');
              }
              
              // apply all changes sequentially
              let updatedContent = currentContent;
              for (const change of message.params.contentChanges) {
                console.log('Applying change:', change.range ? `range ${change.range.start.line}:${change.range.start.character}-${change.range.end.line}:${change.range.end.character}` : 'full text');
                updatedContent = applyChange(updatedContent, change);
              }
              
              // write the updated content
              console.log('Updating file:', filePath);
              console.log('updatedContent: ', updatedContent);
              writeFileSync(filePath, updatedContent);
            }
            
            // convert the URI to file:// URI
            message.params.textDocument.uri = fileUri;
          }
          
          // handle other textDocument requests (hover, completion, etc.) - ensure document is open
          if (message.method && message.method.startsWith('textDocument/') && 
              message.method !== 'textDocument/didOpen' && 
              message.method !== 'textDocument/didChange' &&
              message.method !== 'textDocument/didClose' &&
              message.params?.textDocument?.uri) {
            const uri = message.params.textDocument.uri;
            console.log(`Ensuring document is open for ${message.method}:`, uri);
            const fileUri = ensureDocumentOpen(uri);
            message.params.textDocument.uri = fileUri;
          }
          
          // send the converted message to clangd
          if (messageHandler) {
            messageHandler(JSON.stringify(message));
          }
        } catch (err) {
          console.error('Error processing message:', err);
          // if there is a JSON parsing error, forward the original data
          if (messageHandler) {
            messageHandler(data);
          }
        }
      };
    },
    onError: (cb) => {
      connection.socket.onerror = (event) => {
        if ('message' in event) {
          cb((event as any).message);
        }
      };
    },
    onClose: (cb) => {
      connection.socket.onclose = (event) => {
        cb(event.code, event.reason);
      };
    },
    dispose: () => {
      connection.socket.close();
    }
  };
  
  let newConnection = rpcServer.createWebSocketConnection(interceptedSocket);
  
  rpcServer.forward(newConnection, localConnection);
  console.log(`Forwarding new client, workspace: ${workspaceDir}`);
  
  interceptedSocket.onClose((code, reason) => {
    console.log('Client closed', code, reason);
    try {
      localConnection.dispose();
      // delete the temporary directory
      rmSync(workspaceDir, { recursive: true, force: true });
      console.log('Cleaned up workspace directory:', workspaceDir);
    } catch (err) {
      console.error('Error cleaning up:', err);
    }
  });
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
  console.log(`Server listening at ${address}`)
});
