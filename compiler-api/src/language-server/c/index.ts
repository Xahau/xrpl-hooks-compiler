import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { spawn } from 'child_process';
import { dirname, join } from "path";
import * as rpc from 'vscode-ws-jsonrpc';
import * as rpcServer from 'vscode-ws-jsonrpc/lib/server';
import { SocketStream } from 'fastify-websocket';
import { TextDocument } from 'vscode-languageserver-textdocument';

export interface LanguageServerConfig {
  tempDir: string;
  hookHeadersDir?: string;
}

/**
 * Handle WebSocket connection for C language server
 */
export function handleCLanguageServer(connection: SocketStream, config: LanguageServerConfig): void {
  // create a temporary directory for the workspace
  const workspaceDir = config.tempDir + '/language-server' + '/ls_' + Math.random().toString(36).slice(2);

  mkdirSync(workspaceDir, { recursive: true });

  const hookHeadersDir = config.hookHeadersDir || '/app/clang/includes';
  const compileFlagsContent = [
    '-xc',
    '-isystem/usr/lib/clang/15.0.0/include',
    '-Wno-pointer-to-int-cast',
    '-Wno-int-conversion',
    '-Werror=implicit-function-declaration',
    `-I${workspaceDir}`,
    `-I${hookHeadersDir}`,
  ].join('\n') + '\n';
  writeFileSync(join(workspaceDir, 'compile_flags.txt'), compileFlagsContent);

  const clangdConfigContent = `Security:
  AccessibleDirectories: [ "${workspaceDir}", "/usr/include", "/usr/lib/clang", "${hookHeadersDir}" ]
`;
  writeFileSync(join(workspaceDir, '.clangd'), clangdConfigContent);
  
  type MessageHandler = Parameters<rpc.IWebSocket['onMessage']>[0];

  const sendDidOpen = (send: MessageHandler, uri: string, text: string) => {
    send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: { uri, languageId: 'c', version: 1, text }
      }
    }));
  };

  const toWorkspaceDocument = (uri: string): { filePath: string; fileUri: string } => {
    const fileName = uri.replace(/^file:\/\//, '');
    const filePath = join(workspaceDir, fileName);
    return { filePath, fileUri: `file://${filePath}` };
  };

  const openDocuments = new Set<string>();

  const ensureDocumentOpen = (send: MessageHandler, uri: string): string => {
    const { filePath, fileUri } = toWorkspaceDocument(uri);

    if (!openDocuments.has(fileUri)) {
      mkdirSync(dirname(filePath), { recursive: true });

      let fileContent = '';
      if (existsSync(filePath)) {
        fileContent = readFileSync(filePath, 'utf-8');
      } else {
        // A well-behaved client sends didOpen (with full text) before any other
        // request for a document, so bootstrapping from empty here means the
        // client skipped that step and range-based edits may desync.
        console.warn('Document opened without content, starting empty:', fileUri);
      }

      writeFileSync(filePath, fileContent);
      sendDidOpen(send, fileUri, fileContent);

      openDocuments.add(fileUri);
    }

    return fileUri;
  };

  // create a custom IWebSocket that intercepts messages
  const interceptedSocket: rpc.IWebSocket = {
    send: (content) => {
      // clangd replies with URIs under the temp workspace; translate them back
      // to the URIs the client opened so it can match its own documents.
      const outgoing = content.toString().split(`file://${workspaceDir}`).join('file://');
      connection.socket.send(outgoing);
    },
    onMessage: (messageHandler) => {
      connection.socket.onmessage = (event) => {
        const data = event.data;

        try {
          const message = JSON.parse(data.toString());
          const method = message.method;

          if (method === 'initialize') {
            // Point clangd at the temporary workspace used for this session.
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

          const uri = message.params.textDocument.uri;
          const { filePath, fileUri } = toWorkspaceDocument(uri);

          if (method === 'textDocument/didOpen' && message.params?.textDocument) {
            // Mirror the opened client document into the temporary workspace.            

            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, message.params.textDocument.text);

            openDocuments.add(fileUri);
          }

          if (method === 'textDocument/didClose' && message.params?.textDocument?.uri) {
            // Stop tracking the mirrored workspace document after the client closes it.

            openDocuments.delete(fileUri);
          }

          if (method === 'textDocument/didChange' && message.params?.textDocument) {
            // Apply incremental client edits to the mirrored workspace file.

            ensureDocumentOpen(messageHandler, uri);

            if (message.params.contentChanges && message.params.contentChanges.length > 0) {
              let currentContent = '';
              if (existsSync(filePath))
                currentContent = readFileSync(filePath, 'utf-8');

              const currentDocument = TextDocument.create(
                fileUri,
                'c',
                message.params.textDocument.version ?? 0,
                currentContent
              );
              const updatedDocument = TextDocument.update(
                currentDocument,
                message.params.contentChanges,
                message.params.textDocument.version ?? currentDocument.version + 1
              );

              writeFileSync(filePath, updatedDocument.getText());
            }
          }

          if (method && method.startsWith('textDocument/') &&
              method !== 'textDocument/didOpen' &&
              method !== 'textDocument/didChange' &&
              method !== 'textDocument/didClose' &&
              message.params?.textDocument?.uri) {
            // Ensure clangd has an opened workspace document before document requests.
            ensureDocumentOpen(messageHandler, uri);
          }
          
          message.params.textDocument.uri = fileUri;

          messageHandler(JSON.stringify(message));
        } catch (err) {
          console.error('Error processing message:', err);
          messageHandler(data);
        }
      };
    },
    onError: (errorHandler) => {
      connection.socket.onerror = (event) => {
        if ('message' in event) {
          errorHandler(event.message);
        }
      };
    },
    onClose: (closeHandler) => {
      connection.socket.onclose = (event) => {
        closeHandler(event.code, event.reason);
      };
    },
    dispose: () => {
      connection.socket.close();
    }
  };

  // Spawn clangd ourselves so we can attach explicit error handlers to its
  // streams. The default server-process helper leaves stdin/stdout errors easy
  // to miss, which can bring down the shared API when a client disconnects
  // mid-stream.
  const serverProcess = spawn('clangd', [
    `--compile-commands-dir=${workspaceDir}`,
    `--limit-results=200`,
    `--background-index=false`,
    `--log=error`
  ], {
    cwd: workspaceDir
  });

  let localConnection: rpcServer.IConnection | null = null;
  let disposed = false;
  const dispose = (reason: string) => {
    if (disposed) return;
    disposed = true;
    console.log('Tearing down language-server session:', reason);
    try { localConnection?.dispose(); } catch (err) { console.error('Error disposing clangd connection:', err); }
    try { serverProcess.kill(); } catch (err) { console.error('Error killing clangd:', err); }
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch (err) { console.error('Error cleaning up workspace directory:', err); }
  };

  serverProcess.on('error', (err) => dispose(`clangd process error: ${err}`));
  serverProcess.on('exit', (code, sig) => dispose(`clangd exited (code=${code}, signal=${sig})`));
  serverProcess.stdin?.on('error', (err) => dispose(`clangd stdin error: ${err}`));
  serverProcess.stdout?.on('error', (err) => dispose(`clangd stdout error: ${err}`));
  serverProcess.stderr?.on('data', (data) => console.error(`clangd: ${data}`));
  connection.socket.on('error', (err: Error) => dispose(`websocket error: ${err}`));

  try {
    localConnection = rpcServer.createProcessStreamConnection(serverProcess);
    const newConnection = rpcServer.createWebSocketConnection(interceptedSocket);
    rpcServer.forward(newConnection, localConnection);
    console.log(`Forwarding new client, workspace: ${workspaceDir}`);
  } catch (err) {
    dispose(`failed to set up forwarding: ${err}`);
    return;
  }

  interceptedSocket.onClose((code, reason) => {
    dispose(`client closed: ${reason}`);
  });
}
