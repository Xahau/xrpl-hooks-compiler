import { execSync } from "child_process";

// Compile sandbox.
//
// Untrusted source is handed to clang/qjsc/wasm-opt/etc. The C preprocessor
// will happily `#include "/etc/passwd"` (or any absolute/traversal path) and
// clang echoes the file back in its diagnostics, so without isolation the
// build endpoint is an arbitrary file-read primitive scoped to the compile
// user. We contain every child process in an unprivileged bubblewrap sandbox
// whose filesystem view is an allowlist: read-only toolchain, a single
// read-write build directory, a fresh /tmp and /proc, and no network. Files
// outside that view simply do not exist for the compiler, so absolute-path
// includes, /proc/self/environ, the server's own /app/dist source, and other
// tenants' /tmp/build_* directories are all unreachable.
//
// bubblewrap runs fully unprivileged via user namespaces on any host that
// allows them (the default on modern Linux). If the sandbox cannot be
// established (bwrap missing, e.g. local `yarn dev` on macOS, or user
// namespaces disabled on the host) we fall back to running the command
// directly and log loudly, unless HOOKS_REQUIRE_SANDBOX is set, in which case
// we refuse to compile. This keeps the existing Docker/dev workflow working
// while making real isolation the default wherever it is available.

const REQUIRE_SANDBOX = !!process.env.HOOKS_REQUIRE_SANDBOX;

// Single-quote a path for safe inclusion in the shell command string that
// execSync runs. Build paths can contain shell metacharacters (the working
// directory suffix is ".$"), so never interpolate them unquoted.
function shq(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

function toolchain_root(): string {
  // clang, the wasi sysroot and the default headers all live under ./clang
  // relative to the server's working directory (/app in the container).
  return process.cwd() + "/clang";
}

// Read-only system paths the toolchain binaries need (musl loader, libstdc++,
// the tool binaries copied into /usr/bin, busybox in /bin). None of these
// contain secrets. Deliberately absent: /etc, /root, /home, /app (server
// source + node_modules) and the real /tmp.
const RO_SYSTEM_PATHS = ["/usr", "/lib", "/lib64", "/bin", "/sbin"];

function bwrap_prefix(dir: string): string {
  const args: string[] = [
    "bwrap",
    "--unshare-all", // new user/mount/pid/net/ipc/uts/cgroup namespaces
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--setenv", "PATH", "'/usr/bin:/bin'",
    "--setenv", "HOME", shq(dir),
    "--setenv", "TMPDIR", shq(dir),
    "--proc", "/proc", // fresh proc for the new pid ns; hides host /proc
    "--dev", "/dev",
    "--tmpfs", "/tmp", // empty /tmp; the build dir is bound in on top below
  ];
  for (const p of RO_SYSTEM_PATHS) {
    args.push("--ro-bind-try", shq(p), shq(p));
  }
  const clang = toolchain_root();
  args.push("--ro-bind", shq(clang), shq(clang));
  // The only writable location: this build's private directory (holds the
  // sources, generated headers, intermediate wasm and the output artifact).
  args.push("--bind", shq(dir), shq(dir));
  args.push("--chdir", shq(dir));
  args.push("--");
  return args.join(" ");
}

let cached: boolean | undefined;

function probe(): boolean {
  const args = [
    "bwrap",
    "--unshare-all",
    "--die-with-parent",
    "--tmpfs", "/tmp",
    "--proc", "/proc",
    "--dev", "/dev",
  ];
  for (const p of RO_SYSTEM_PATHS) {
    args.push("--ro-bind-try", p, p);
  }
  args.push("--", "/bin/sh", "-c", ":");
  try {
    execSync(args.join(" "), { stdio: "ignore", timeout: 5000 });
    return true;
  } catch (_ex) {
    return false;
  }
}

export function sandbox_available(): boolean {
  if (cached === undefined) {
    cached = probe();
  }
  return cached;
}

export function sandbox_status(): string {
  if (sandbox_available()) {
    return "compile sandbox: ACTIVE (bubblewrap)";
  }
  if (REQUIRE_SANDBOX) {
    return "compile sandbox: UNAVAILABLE and HOOKS_REQUIRE_SANDBOX is set — builds will be refused";
  }
  return "compile sandbox: UNAVAILABLE — running compilers unsandboxed (set HOOKS_REQUIRE_SANDBOX to fail closed)";
}

// Wrap a subprocess command so it runs inside the sandbox rooted at `dir`.
// The incoming command is a plain program + args string with no shell
// operators, so prepending the bwrap prefix and letting the outer shell
// tokenize it hands the program straight to bwrap (no nested shell needed).
export function sandbox_wrap(cmd: string, dir: string): string {
  if (sandbox_available()) {
    return bwrap_prefix(dir) + " " + cmd;
  }
  if (REQUIRE_SANDBOX) {
    throw new Error("Refusing to compile: sandbox unavailable and HOOKS_REQUIRE_SANDBOX is set");
  }
  return cmd;
}
