/**
 * Streaming exec for backends whose own exec cannot stream stdin.
 *
 * `msb exec` (microsandbox 0.5) reads a non-tty command's whole stdin before
 * starting it, so a relay or a provider CLI that talks over stdio never
 * starts. Instead, a small server runs inside the sandbox on
 * `SANDBOX_EXEC_GUEST_PORT`, which the backend publishes on a host loopback
 * port. `SANDBOX_EXEC_CLIENT_SOURCE` runs on the host in place of the
 * backend's exec: it sends one request, then carries stdin, stdout, stderr,
 * and the exit status as frames. Closing the connection kills the command's
 * process group, so killing the client kills the command too.
 *
 * Frames are a 1-byte type, a 4-byte big-endian length, and the payload.
 * Client to server: 0 stdin data, 1 stdin end. Server to client: 1 stdout,
 * 2 stderr, 3 exit (JSON `{code, signal}`). The request is the first line:
 * JSON `{token, argv, cwd}`. A wrong token closes the connection.
 */
export const SANDBOX_EXEC_GUEST_PORT = 47001;

/** Run as `node <file> <port> <tokenFile>` inside the sandbox. */
export const SANDBOX_EXEC_SERVER_SOURCE = String.raw`"use strict";
const net = require("net");
const fs = require("fs");
const { spawn } = require("child_process");
const port = Number(process.argv[2]);
const token = fs.readFileSync(process.argv[3], "utf8").trim();
const frame = (type, payload) => {
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
};
net
  .createServer((socket) => {
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    let child = null;
    let done = false;
    const kill = (signal) => {
      if (child === null || child.exitCode !== null || child.signalCode !== null) return;
      try {
        process.kill(-child.pid, signal);
      } catch {}
    };
    socket.on("close", () => {
      if (done) return;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 2000).unref();
    });
    const start = (request) => {
      if (request.token !== token || !Array.isArray(request.argv) || request.argv.length === 0) {
        socket.destroy();
        return;
      }
      child = spawn(request.argv[0], request.argv.slice(1), {
        cwd: request.cwd || process.env.HOME,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdin.on("error", () => {});
      child.stdout.on("data", (data) => socket.write(frame(1, data)));
      child.stderr.on("data", (data) => socket.write(frame(2, data)));
      let outputs = 2;
      let status = null;
      const finish = () => {
        if (outputs > 0 || status === null) return;
        done = true;
        socket.end(frame(3, Buffer.from(JSON.stringify(status))));
      };
      child.stdout.on("close", () => { outputs -= 1; finish(); });
      child.stderr.on("close", () => { outputs -= 1; finish(); });
      child.on("error", (error) => {
        socket.write(frame(2, Buffer.from(String(error.message) + "\n")));
        outputs = 0;
        status = { code: 127, signal: null };
        finish();
      });
      child.on("exit", (code, signal) => { status = { code, signal }; finish(); });
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (child === null) {
        const newline = buffer.indexOf(10);
        if (newline < 0) return;
        let request = null;
        try {
          request = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
        } catch {}
        buffer = buffer.subarray(newline + 1);
        if (request === null) return socket.destroy();
        start(request);
        if (child === null) return;
      }
      while (buffer.length >= 5) {
        const length = buffer.readUInt32BE(1);
        if (buffer.length < 5 + length) break;
        const type = buffer[0];
        const payload = buffer.subarray(5, 5 + length);
        buffer = buffer.subarray(5 + length);
        if (type === 0) child.stdin.write(payload);
        else if (type === 1) child.stdin.end();
      }
    });
  })
  .listen(port, "0.0.0.0");
`;

/**
 * Run on the host as `node -e <source>` with `T3_SANDBOX_EXEC` set to JSON
 * `{port, token, argv, cwd}`. Behaves like the command it runs: same stdio,
 * same exit code, and a signal kills the command in the sandbox.
 */
export const SANDBOX_EXEC_CLIENT_SOURCE = String.raw`"use strict";
const net = require("net");
const request = JSON.parse(process.env.T3_SANDBOX_EXEC);
delete process.env.T3_SANDBOX_EXEC;
const frame = (type, payload) => {
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
};
let exited = false;
const socket = net.connect(request.port, "127.0.0.1", () => {
  socket.write(JSON.stringify({ token: request.token, argv: request.argv, cwd: request.cwd }) + "\n");
  process.stdin.on("data", (data) => socket.write(frame(0, data)));
  process.stdin.on("end", () => socket.write(frame(1, Buffer.alloc(0))));
  process.stdin.on("error", () => {});
});
let buffer = Buffer.alloc(0);
socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 5) {
    const length = buffer.readUInt32BE(1);
    if (buffer.length < 5 + length) break;
    const type = buffer[0];
    const payload = buffer.subarray(5, 5 + length);
    buffer = buffer.subarray(5 + length);
    if (type === 1) process.stdout.write(payload);
    else if (type === 2) process.stderr.write(payload);
    else if (type === 3) {
      exited = true;
      const status = JSON.parse(payload.toString("utf8"));
      const code = status.code === null ? 128 + 15 : status.code;
      process.stdout.write("", () => process.exit(code));
    }
  }
});
socket.on("error", (error) => {
  if (exited) return;
  process.stderr.write("sandbox exec failed: " + error.message + "\n");
  process.exit(255);
});
socket.on("close", () => {
  if (!exited) process.exit(255);
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    socket.destroy();
    process.exit(128 + 15);
  });
}
`;
