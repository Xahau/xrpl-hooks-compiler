import fastify from 'fastify';
import { mkdirSync, writeFileSync, existsSync, openSync, closeSync, readFileSync, rmSync, unlinkSync, copyFileSync } from "fs";
import { execSync } from "child_process";
import { z } from 'zod';
import fastifyCors from 'fastify-cors';
import fastifyWebSocket from 'fastify-websocket';
import { deflateSync } from 'zlib';

const server = fastify();

server.register(fastifyCors, {
  // put your options here
  origin: '*'
})
server.register(fastifyWebSocket);

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

const requestBodySchema = z.object({
  output: z.enum(['bc']),
  files: z.array(z.object({
    type: z.string(),
    name: z.string(),
    options: z.string().optional(),
    src: z.string()
  })),
  link_options: z.string().optional(),
  compress: z.boolean().optional(),
  strip: z.boolean().optional()
});

type RequestBody = z.infer<typeof requestBodySchema>;

// Input: JSON in the following format
// {
//     output: "bc",
//     files: [
//         {
//             type: "c",
//             name: "file.c",
//             options: "-O3 -std=c99",
//             src: "#include..."
//         }
//     ],
//     link_options: "--import-memory"
// }
// Output: JSON in the following format
// {
//     success: true,
//     message: "Success",
//     output: "AGFzbQE.... =",
//     tasks: [
//         {
//             name: "building bc",
//             success: true,
//             console: ""
//         }
//     ]
// }

function sanitize_shell_output<T>(out: T): T {
  return out; // FIXME
}

function shell_exec(cmd: string, cwd: string) {
  const out = openSync(cwd + '/out.log', 'w');
  let error = '';
  try {
    execSync(cmd, { cwd, stdio: [null, out, out], });
  } catch (ex: unknown) {
    if (ex instanceof Error) {
      error = ex?.message;
    }
  } finally {
    closeSync(out);
  }
  const result = readFileSync(cwd + '/out.log').toString() || error;
  return result;
}

function serialize_file_data(filename: string, compress: boolean) {  
  let content = readFileSync(filename);
  const hexData = content.toString()
    .replace(/\n/g, '')
    .match(/\{[^}]+\}/)?.[0]
    .match(/0x[a-fA-F0-9]+/g)
    ?.map(hex => hex.replace('0x', ''))
    .join('') || '';
  content = Buffer.from(hexData, 'hex')
  if (compress) {
    content = deflateSync(content);
  }
  return content.toString('base64')
}

function validate_filename(name: string) {
  if (!/^[A-Za-z0-9_-]+[.][A-Za-z0-9]{1,4}$/.test(name)) {
    return false;
  }
  const parts = name.split(/\//g);
  for (let p of parts) {
    if (p == '.' || p == '..') {
      return false;
    }
  }
  return parts;
}

function link_js_files(source_files: string[], cwd: string, output: string, result_obj: Task) {
  const files = source_files.join(' ');  
  const qjsc = 'qjsc';
  const cmd = qjsc + ' ' + '-c ' + files;
  const out = shell_exec(cmd, cwd);
  copyFileSync(cwd + '/out.c', output);
  result_obj.console = sanitize_shell_output(out);
  if (!existsSync(output)) {
    result_obj.success = false;
    return false;
  }
  result_obj.success = true;
  return true;
}

export function build_project(project: RequestBody, base: string) {
  const output = project.output;
  const compress = project.compress;
  let build_result: ResponseData = {
    success: false,
    message: '',
    output: '',
    tasks: [],
  };
  const dir = base + '.$';
  const result = base + '.bc';

  const complete = (success: boolean, message: string) => {
    rmSync(dir, { recursive: true });
    if (existsSync(result)) {
      unlinkSync(result);
    }

    build_result.success = success;
    build_result.message = message;
    return build_result;
  };

  if (output != 'bc') {
    return complete(false, 'Invalid output type ' + output);
  }

  build_result.tasks = [];
  const files = project.files;
  if (!files.length) {
    return complete(false, 'No source files');
  }

  if (!existsSync(dir)) {
    mkdirSync(dir);
  }

  const sources = [];
  let options;
  for (let file of files) {
    const name = file.name;
    if (!validate_filename(name)) {
      return complete(false, 'Invalid filename ' + name);
    }
    const fileName = dir + '/' + name;
    sources.push(fileName);
    if (!options) {
      options = file.options;
    } else {
      if (file.options && (file.options != options)) {
        return complete(false, 'Per-file compilation options not supported');
      }
    }

    const src = file.src;
    if (!src) {
      return complete(false, 'Source file ' + name + ' is empty');
    }

    writeFileSync(fileName, src);
  }
  const link_result_obj = {
    name: 'building bc'
  };
  build_result.tasks.push(link_result_obj);
  if (!link_js_files(sources, dir, result, link_result_obj)) {
    return complete(false, 'Build error');
  }

  build_result.output = serialize_file_data(result, compress || false);

  return complete(true, 'Success');
}
// END Compile code