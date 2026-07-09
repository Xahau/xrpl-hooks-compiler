import { mkdirSync, writeFileSync, existsSync, openSync, closeSync, readFileSync, renameSync, rmSync, unlinkSync } from "fs";
import { deflateSync } from "zlib";
import { execSync } from "child_process";
import { z } from 'zod';
import { sandbox_wrap } from './sandbox';

// Compilation code
const llvmDir = process.cwd() + "/clang/wasi-sdk";
const tempDir = "/tmp";
const sysroot = llvmDir + "/share/wasi-sysroot";
const defaultHeaderDir = '/app/clang/includes';

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

export const requestBodySchema = z.object({
  output: z.enum(['wasm']),
  files: z.array(z.object({
    type: z.string(),
    name: z.string(),
    options: z.string().optional(),
    src: z.string()
  })),
  headers: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      src: z.string(),
    })
  ).optional(),
  link_options: z.string().optional(),
  compress: z.boolean().optional(),
  strip: z.boolean().optional()
});

export type RequestBody = z.infer<typeof requestBodySchema>;

// Input: JSON in the following format
// {
//     output: "wasm",
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
//             name: "building wasm",
//             success: true,
//             console: ""
//         }
//     ]
// }

// Strip filesystem paths out of compiler/tool diagnostics before they are
// returned to the caller. Without this the response leaks the internal build
// path (/tmp/build_<rand>...) and, if the sandbox is ever bypassed, the paths
// and contents of files pulled in via includes. The per-build directory prefix
// is rewritten to bare basenames so users still see useful errors like
// "h.c:3:5: error: ...", and any other absolute path is redacted.
function sanitize_shell_output(out: string, dir: string): string {
  if (!out) {
    return out;
  }
  let s = out;
  // Drop the build directory prefix: /tmp/build_ab12.$/h.c -> h.c
  s = s.split(dir + '/').join('');
  s = s.split(dir).join('');
  // Redact any remaining absolute path (host layout / leaked file paths).
  s = s.replace(/(^|[^\w/])\/[^\s:'"]+/g, '$1[path]');
  return s;
}

// Defense-in-depth: reject preprocessor directives that reference absolute
// paths or parent-directory traversal. The compile sandbox is the primary
// control (such files do not exist inside it), but this returns a clean error
// for the common attack shape and covers the unsandboxed fallback. Note it
// cannot see through macro-expanded includes — that residual is what the
// sandbox is for.
function find_forbidden_include(src: string): string | null {
  const isBad = (p: string) => p.startsWith('/') || /(^|[\\/])\.\.([\\/]|$)/.test(p);
  const lines = src.split(/\r?\n/);
  const directive = /^\s*#\s*(include|include_next|embed)\b\s*(?:"([^"]*)"|<([^>]*)>)/;
  const hasInclude = /__has_(?:include|include_next|embed)\s*\(\s*(?:"([^"]*)"|<([^>]*)>)/g;
  for (const line of lines) {
    const d = directive.exec(line);
    if (d) {
      const p = d[2] ?? d[3];
      if (p && isBad(p)) {
        return `Forbidden #${d[1]} path in source: ${p}`;
      }
    }
    let h: RegExpExecArray | null;
    while ((h = hasInclude.exec(line)) !== null) {
      const p = h[1] ?? h[2];
      if (p && isBad(p)) {
        return `Forbidden __has_include path in source: ${p}`;
      }
    }
  }
  return null;
}

function shell_exec(cmd: string, cwd: string) {
  const out = openSync(cwd + '/out.log', 'w');
  let error = '';
  try {
    execSync(sandbox_wrap(cmd, cwd), { cwd, stdio: [null, out, out], });
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

function get_optimization_options(options: string) {
  const optimization_options = [
    /* default '-O0' not included */ '-O1', '-O2', '-O3', '-O4', '-Os'
  ];

  let safe_options = '';
  for (let o of optimization_options) {
    if (options.includes(o)) {
      safe_options += ' ' + o;
    }
  }

  return safe_options;
}

function get_include_path(include_path: string) {
  return `-I${include_path}`;
}

function get_clang_options(options: string) {
  const clang_flags = `--sysroot=${sysroot} -xc -I/app/clang/includes -fdiagnostics-print-source-range-info -Werror=implicit-function-declaration`;
  const miscellaneous_options = [
    '-ffast-math', '-fno-inline', '-std=c99', '-std=c89'
  ];

  let safe_options = '';
  for (let o of miscellaneous_options) {
    if (options.includes(o)) {
      safe_options += ' ' + o;
    } else if (o.includes('-std=') && options.toLowerCase().includes(o)) {
      safe_options += ' ' + o;
    }
  }

  return clang_flags + safe_options;
}

function get_lld_options(options: string) {
  // --sysroot=${sysroot} is already included in compiler options
  const clang_flags = `--no-standard-libraries -nostartfiles -Wl,--allow-undefined,--no-entry,--export-all`;
  if (!options) {
    return clang_flags;
  }
  const available_options = ['--import-memory', '-g'];
  let safe_options = '';
  for (let o of available_options) {
    if (options.includes(o)) {
      safe_options += ' -Wl,' + o;
    }
  }
  return clang_flags + safe_options;
}

function serialize_file_data(filename: string, compress: boolean) {
  let content = readFileSync(filename);
  if (compress) {
    content = deflateSync(content);
  }
  return content.toString("base64");
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

function link_c_files(source_files: string[], compile_options: string,  include_path: string, link_options: string, cwd: string, output: string, result_obj: Task) {
  const files = source_files.join(' ');
  const clang = llvmDir + '/bin/clang';
  const cmd = clang + ' ' + get_clang_options(compile_options) + ' ' + get_lld_options(link_options) + ' ' + files + ' -o ' + output + ' ' + get_include_path(include_path);
  const out = shell_exec(cmd, cwd);
  result_obj.console = sanitize_shell_output(out, cwd);
  if (!existsSync(output)) {
    result_obj.success = false;
    return false;
  }
  result_obj.success = true;
  return true;
}

function optimize_wasm(cwd: string, inplace: string, opt_options: string, result_obj: Task) {
  const unopt = cwd + '/unopt.wasm';
  const cmd = 'wasm-opt ' + opt_options + ' -o ' + inplace + ' ' + unopt;
  const out = openSync(cwd + '/opt.log', 'w');
  let error = '';
  let success = true;
  try {
    renameSync(inplace, unopt);
    execSync(sandbox_wrap(cmd, cwd), { cwd, stdio: [null, out, out], });
  } catch (ex: unknown) {
    success = false;
    if (ex instanceof Error) {
      error = ex?.message;
    }
  } finally {
    closeSync(out);
  }
  const out_msg = readFileSync(cwd + '/opt.log').toString() || error;
  result_obj.console = sanitize_shell_output(out_msg, cwd);
  result_obj.success = success;
  return success;
}

function clean_wasm(cwd: string, inplace: string, result_obj: Task) {
  const cmd = 'hook-cleaner ' + inplace;
  const out = openSync(cwd + '/cleanout.log', 'w');
  let error = '';
  let success = true;
  try {
    execSync(sandbox_wrap(cmd, cwd), { cwd, stdio: [null, out, out], });
  } catch (ex: unknown) {
    success = false;
    if (ex instanceof Error) {
      error = ex?.message;
    }
  } finally {
    closeSync(out);
  }
  const out_msg = readFileSync(cwd + '/cleanout.log').toString() || error;
  result_obj.console = sanitize_shell_output(out_msg, cwd);
  result_obj.success = success;
  return success;
}

function guard_check_wasm(cwd: string, inplace: string, result_obj: Task) {
  const cmd = 'guard_checker ' + inplace;
  const out = openSync(cwd + '/guardout.log', 'w');
  let error = '';
  let success = true;
  try {
    execSync(sandbox_wrap(cmd, cwd), { cwd, stdio: [null, out, out], });
  } catch (ex: unknown) {
    success = false;
    if (ex instanceof Error) {
      error = ex?.message;
    }
  } finally {
    closeSync(out);
  }
  const out_msg = readFileSync(cwd + '/guardout.log').toString() || error;
  result_obj.console = sanitize_shell_output(out_msg, cwd);
  result_obj.success = success;
  return success;
}

export function build_project(project: RequestBody, base: string) {
  const output = project.output;
  const compress = project.compress;
  const strip = project.strip;
  let build_result: ResponseData = {
    success: false,
    message: '',
    output: '',
    tasks: [],
  };
  const dir = base + '.$';
  // Keep every build artifact inside the per-build directory so the compile
  // sandbox only needs to expose that single directory read-write.
  const result = dir + '/output.wasm';
  const customHeadersDir = dir + "/includes";

  const complete = (success: boolean, message: string) => {
    rmSync(dir, { recursive: true });
    if (existsSync(result)) {
      unlinkSync(result);
    }

    build_result.success = success;
    build_result.message = message;
    return build_result;
  };

  if (output != 'wasm') {
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

  const headerFiles = project.headers;
  if (!existsSync(customHeadersDir)) {
    mkdirSync(customHeadersDir);
  }

  const sources = [];
  const headers = [];
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

    const forbidden = find_forbidden_include(src);
    if (forbidden) {
      return complete(false, forbidden);
    }

    writeFileSync(fileName, src);
  }

  if (headerFiles) {
    for (let file of headerFiles) {
      const name = file.name;
      if (!validate_filename(name)) {
        return complete(false, "Invalid filename " + name);
      }
      let fileName = customHeadersDir + "/" + name;
      headers.push(fileName);

      const src = file.src;
      if (!src) {
        return complete(false, "Header file " + name + " is empty");
      }
      const forbidden = find_forbidden_include(src);
      if (forbidden) {
        return complete(false, forbidden);
      }
      writeFileSync(fileName, src);
    }
  }
  const link_options = project.link_options;
  const link_result_obj = {
    name: 'building wasm'
  };
  build_result.tasks.push(link_result_obj);
 
  if (!link_c_files(sources,options || '', headerFiles && headers?.length ? customHeadersDir : defaultHeaderDir, link_options || '', dir, result, link_result_obj)) {
    return complete(false, 'Build error');
  }

  const opt_options = get_optimization_options(options || '');
  if (opt_options) {
    const opt_obj = {
      name: 'optimizing wasm'
    };
    build_result.tasks.push(opt_obj);
    if (!optimize_wasm(dir, result, opt_options, opt_obj)) {
      return complete(false, 'Pass 1 Optimization error');
    }
  }

  if (strip) {
    const clean_obj = {
      name: 'cleaning wasm'
    };
    build_result.tasks.push(clean_obj);
    if (!clean_wasm(dir, result, clean_obj)) {
      return complete(false, 'Pass 1 Clean error');
    }
  }

  if (opt_options) {
    const opt_obj = {
      name: 'optimizing wasm'
    };
    build_result.tasks.push(opt_obj);
    if (!optimize_wasm(dir, result, opt_options, opt_obj)) {
      return complete(false, 'Pass 2 Optimization error');
    }
  }

  // if (strip) {
  //   const clean_obj = {
  //     name: 'cleaning wasm'
  //   };
  //   build_result.tasks.push(clean_obj);
  //   if (!clean_wasm(dir, result, clean_obj)) {
  //     return complete(false, 'Pass 2 Clean error');
  //   }
  // }

  const guard_result_obj = {
    name: 'guard checking wasm'
  };
  build_result.tasks.push(guard_result_obj);
  if (!guard_check_wasm(dir, result, guard_result_obj)) {
    return complete(false, 'Guard checking error');
  }

  build_result.output = serialize_file_data(result, compress || false);

  return complete(true, 'Success');
}
// END Compile code
