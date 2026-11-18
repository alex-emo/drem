import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function runWorkspace(name, script) {
  return spawn(npm, ["run", script, "--workspace", name], {
    stdio: "inherit",
    env: process.env,
  });
}

console.log("[dream] 启动服务端 :8787 与 Web :5173 ...");
const children = [
  runWorkspace("@dream/server", "dev"),
  runWorkspace("@dream/web", "dev"),
];

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`[dream] 子进程退出（code=${code}），停止全部进程`);
      shutdown(code ?? 1);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
