// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { statSync, writeSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";
import { PassThrough } from "node:stream";

function environmentValue(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

function windowsExecutable(command, options) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const directories = /[\\/]/u.test(command) ? [""] : [cwd, ...(environmentValue(env, "PATH") ?? "").split(delimiter)];
  const extensions = extname(command) ? [""] : [...(environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";"), ""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const path = resolve(cwd, directory.replace(/^"|"$/gu, ""), command + extension);
      try { if (statSync(path).isFile()) return path; } catch { /* continue PATH search */ }
    }
  }
  throw Object.assign(new Error(`Executable not found: ${command}`), { code: "ENOENT", path: command });
}

// CommandLineToArgvW / the Microsoft C runtime quoting convention.
function quoteArgument(value) {
  return `"${value.replace(/(\\*)"/gu, "$1$1\\\"").replace(/(\\+)$/u, "$1$1")}"`;
}

function batchArgument(value, secondPass) {
  if (/[\r\n\0]/u.test(value)) throw new Error("Batch command arguments cannot contain NUL or line breaks");
  // cmd parses metacharacters even in the quoted command passed to /s /c. A
  // batch forwarding %* reparses them once more, so retain that escaping layer.
  const escape = text => text.replace(/([()\][%!^"`<>&|;, *?])/gu, "^$1");
  const quoted = escape(quoteArgument(value));
  return secondPass ? escape(quoted) : quoted;
}

export function commandInvocation(command, args = [], options = {}) {
  if (process.platform !== "win32") return { command, args: [...args], options };
  if ([command, ...args].some(value => typeof value !== "string" || value.includes("\0"))) {
    throw new TypeError("Commands and arguments must be strings without NUL bytes");
  }
  const executable = windowsExecutable(command, options);
  if (!/\.(?:cmd|bat)$/iu.test(executable)) return { command: executable, args: [...args], options };
  const systemRoot = environmentValue(process.env, "SystemRoot");
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows system directory is unavailable");
  const shell = join(systemRoot, "System32", "cmd.exe");
  const escapedCommand = executable.replace(/([()\][%!^"`<>&|;, *?])/gu, "^$1");
  const line = [escapedCommand, ...args.map(arg => batchArgument(arg, true))].join(" ");
  return { command: shell, args: ["/d", "/v:off", "/s", "/c", `"${line}"`], options: { ...options, windowsVerbatimArguments: true } };
}

export function spawnCommandSync(command, args = [], options = {}) {
  try {
    const invocation = commandInvocation(command, args, options);
    if (process.platform !== "win32") return spawnSync(invocation.command, invocation.args, invocation.options);
    const monitor = windowsMonitorInvocation(invocation, options);
    const result = spawnSync(monitor.command, monitor.args, { ...options, ...monitor.options, input: options.input, encoding: "utf8", maxBuffer: (options.maxBuffer ?? 1024 * 1024) * 2 });
    const streams = { stdout: [], stderr: [] };
    let terminal;
    let error = result.error;
    let pid = result.pid;
    // A timeout or capture overflow can end inside the last protocol frame.
    const lines = (result.stdout ?? "").split("\n");
    lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.event === "stdout" || event.event === "stderr") streams[event.event].push(Buffer.from(event.data, "base64"));
      else if (event.event === "close") terminal = event;
      else if (event.event === "spawn") pid = event.pid;
      else if (event.event === "error") error = Object.assign(new Error(`Windows process launch failed (${event.code})`), { code: event.code === 2 ? "ENOENT" : "EIO" });
    }
    if (!terminal && !error) error = new Error(`Windows job monitor failed: ${result.stderr ?? ""}`);
    const decode = bytes => options.encoding && options.encoding !== "buffer" ? bytes.toString(options.encoding) : bytes;
    const stdout = decode(Buffer.concat(streams.stdout));
    const stderr = decode(Buffer.concat(streams.stderr));
    for (const [index, channel] of [[1, "stdout"], [2, "stderr"]]) {
      const destination = options.stdio === "inherit" || options.stdio?.[index] === "inherit" ? index : options.stdio?.[index];
      if (Number.isInteger(destination)) writeSync(destination, Buffer.concat(streams[channel]));
    }
    return { ...result, pid, stdout, stderr, output: [null, stdout, stderr], status: terminal?.code ?? null, error };
  } catch (error) {
    return { pid: 0, output: [], stdout: null, stderr: null, status: null, signal: null, error };
  }
}

// The suspended child is assigned before any user code runs. Closing the last
// job handle kills every descendant, including detached children. The monitor
// holds an OS handle to its caller, so PID reuse cannot keep an orphan alive.
const WINDOWS_JOB_SOURCE = String.raw`
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
public static class EinzbernJob {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public Limits Basic;
    public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
    public int Size;
    public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
    public short ShowWindow, ReservedSize;
    public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }
  [StructLayout(LayoutKind.Sequential)] struct Security {
    public int Length;
    public IntPtr Descriptor;
    public int Inherit;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, int size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref Security security, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int number);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static readonly object OutputLock = new object();
  static void Emit(string value) { lock (OutputLock) { Console.Out.WriteLine(value); Console.Out.Flush(); } }
  static void Check(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static Thread Pump(IntPtr handle, string channel) {
    var thread = new Thread(() => {
      using (var stream = new FileStream(new SafeFileHandle(handle, true), FileAccess.Read)) {
        var buffer = new byte[32768];
        int count;
        while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
          Emit("{\"event\":\"" + channel + "\",\"data\":\"" + Convert.ToBase64String(buffer, 0, count) + "\"}");
      }
    });
    thread.IsBackground = true;
    thread.Start();
    return thread;
  }
  public static int Run(string executable, string command, string directory, int parentId, string jobName) {
    IntPtr job = IntPtr.Zero, parent = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero, errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero;
    ProcessInfo process = new ProcessInfo();
    try {
      parent = OpenProcess(0x101000, false, parentId);
      Check(parent != IntPtr.Zero);
      long parentCreated, monitorCreated, exited, kernel, user;
      Check(GetProcessTimes(parent, out parentCreated, out exited, out kernel, out user));
      Check(GetProcessTimes(new IntPtr(-1), out monitorCreated, out exited, out kernel, out user));
      if (parentCreated > monitorCreated) throw new InvalidOperationException("Caller PID was reused");
      job = CreateJobObject(IntPtr.Zero, jobName);
      Check(job != IntPtr.Zero);
      var limits = new ExtendedLimits();
      limits.Basic.Flags = 0x2000;
      Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(limits)));
      using (var cancel = new EventWaitHandle(false, EventResetMode.ManualReset, jobName + "-cancel")) {
        var security = new Security { Length = Marshal.SizeOf(typeof(Security)), Inherit = 1 };
        Check(CreatePipe(out outputRead, out outputWrite, ref security, 0));
        Check(CreatePipe(out errorRead, out errorWrite, ref security, 0));
        Check(SetHandleInformation(outputRead, 1, 0));
        Check(SetHandleInformation(errorRead, 1, 0));
        var startup = new Startup { Size = Marshal.SizeOf(typeof(Startup)), Flags = 0x100, Input = GetStdHandle(-10), Output = outputWrite, Error = errorWrite };
        Check(CreateProcess(executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, 0x08000404, IntPtr.Zero, directory, ref startup, out process));
        Check(AssignProcessToJobObject(job, process.Process));
        if (ResumeThread(process.Thread) == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(outputWrite); outputWrite = IntPtr.Zero;
        CloseHandle(errorWrite); errorWrite = IntPtr.Zero;
        Emit("{\"event\":\"spawn\",\"pid\":" + process.ProcessId + "}");
        var stdout = Pump(outputRead, "stdout"); outputRead = IntPtr.Zero;
        var stderr = Pump(errorRead, "stderr"); errorRead = IntPtr.Zero;
        var handles = new IntPtr[] { process.Process, parent, cancel.SafeWaitHandle.DangerousGetHandle() };
        uint wait = WaitForMultipleObjects(3, handles, false, 0xffffffff);
        if (wait > 2) throw new Win32Exception(Marshal.GetLastWin32Error());
        uint code = 1;
        if (wait == 0) Check(GetExitCodeProcess(process.Process, out code));
        Check(TerminateJobObject(job, 1));
        Accounting accounting;
        do {
          Check(QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
          if (accounting.ActiveProcesses > 0) Thread.Sleep(10);
        } while (accounting.ActiveProcesses > 0);
        stdout.Join(); stderr.Join();
        Emit("{\"event\":\"close\",\"code\":" + code + ",\"cancelled\":" + (wait == 0 ? "false" : "true") + "}");
        return 0;
      }
    } catch (Exception error) {
      var native = error as Win32Exception;
      Emit("{\"event\":\"error\",\"code\":" + (native == null ? -1 : native.NativeErrorCode) + "}");
      return 1;
    } finally {
      if (process.Process != IntPtr.Zero) { TerminateProcess(process.Process, 1); CloseHandle(process.Process); }
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      foreach (IntPtr handle in new IntPtr[] { job, parent, outputRead, outputWrite, errorRead, errorWrite })
        if (handle != IntPtr.Zero) CloseHandle(handle);
    }
  }
}`;

function powershellPath() {
  const root = environmentValue(process.env, "SystemRoot");
  if (!root || !isAbsolute(root)) throw new Error("Windows system directory is unavailable");
  return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function windowsMonitorInvocation(invocation, options) {
  const jobName = `Local\\Einzbern-${randomUUID()}`;
  const commandLine = [quoteArgument(invocation.command), ...invocation.args.map(arg => invocation.options.windowsVerbatimArguments ? arg : quoteArgument(arg))].join(" ");
  const payload = Buffer.from(JSON.stringify({ executable: invocation.command, commandLine, directory: resolve(options.cwd ?? process.cwd()), parent: process.pid, jobName })).toString("base64");
  const script = "$ErrorActionPreference='Stop'; $env:PSModulePath=Join-Path $PSHOME 'Modules'; Add-Type -TypeDefinition $env:EINZBERN_JOB_SOURCE; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:EINZBERN_JOB_PAYLOAD)) | ConvertFrom-Json; Remove-Item Env:EINZBERN_JOB_SOURCE,Env:EINZBERN_JOB_PAYLOAD; if ($env:EINZBERN_TEST_DIAGNOSTIC_ROOT -eq '1') { $env:TCRN_TEST_CONTROLLER_PROCESS_GROUP=[string]$PID; Remove-Item Env:EINZBERN_TEST_DIAGNOSTIC_ROOT }; exit [EinzbernJob]::Run($p.executable,$p.commandLine,$p.directory,$p.parent,$p.jobName)";
  return { jobName, command: powershellPath(), args: ["-NoProfile", "-NonInteractive", "-Command", script], options: {
    cwd: options.cwd, windowsHide: true, stdio: [Array.isArray(options.stdio) ? options.stdio[0] ?? "pipe" : options.stdio ?? "pipe", "pipe", "pipe"],
    env: { ...(options.env ?? process.env), EINZBERN_WINDOWS_JOB: jobName, EINZBERN_JOB_SOURCE: WINDOWS_JOB_SOURCE, EINZBERN_JOB_PAYLOAD: payload },
  } };
}

export function spawnCommand(command, args = [], options = {}) {
  const invocation = commandInvocation(command, args, options);
  if (process.platform !== "win32") return spawn(invocation.command, invocation.args, invocation.options);
  const specification = windowsMonitorInvocation(invocation, options);
  const { jobName } = specification;
  const monitor = spawn(specification.command, specification.args, specification.options);
  const child = new EventEmitter();
  child.stdin = monitor.stdin;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.jobName = jobName;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  let pending = "";
  let terminal = null;
  let launchError = null;
  let requestedSignal = null;
  let monitorError = "";
  const blockedStreams = new Set();
  const startupTimer = setTimeout(() => {
    launchError = Object.assign(new Error("Windows job monitor startup timed out"), { code: "ETIMEDOUT" });
    monitor.kill("SIGKILL");
  }, 30_000);
  startupTimer.unref();
  const cancel = () => {
    const signaler = spawn(powershellPath(), ["-NoProfile", "-NonInteractive", "-Command", `$event=[Threading.EventWaitHandle]::OpenExisting('${jobName}-cancel'); $event.Set() | Out-Null; $event.Dispose()`], { windowsHide: true, stdio: "ignore" });
    signaler.on("error", error => {
      launchError = error;
      monitor.kill("SIGKILL");
    });
    signaler.on("exit", code => {
      if (code !== 0 && !terminal) monitor.kill("SIGKILL");
    });
  };
  child.kill = (signal = "SIGTERM") => {
    if (terminal) return false;
    requestedSignal = signal;
    child.killed = true;
    if (child.pid !== undefined) cancel();
    return true;
  };
  monitor.stdout.setEncoding("utf8");
  monitor.stdout.on("data", chunk => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      let event;
      try { event = JSON.parse(line); } catch { launchError = new Error("Invalid Windows job monitor response"); continue; }
      if (event.event === "spawn") {
        clearTimeout(startupTimer);
        child.pid = event.pid;
        child.emit("spawn");
        if (requestedSignal) cancel();
      } else if (event.event === "stdout" || event.event === "stderr") {
        const stream = child[event.event];
        if (!stream.write(Buffer.from(event.data, "base64")) && !blockedStreams.has(stream)) {
          blockedStreams.add(stream);
          monitor.stdout.pause();
          stream.once("drain", () => {
            blockedStreams.delete(stream);
            if (blockedStreams.size === 0) monitor.stdout.resume();
          });
        }
      } else if (event.event === "close") terminal = event;
      else if (event.event === "error") launchError = Object.assign(new Error(`Windows process launch failed (${event.code})`), { code: event.code === 2 ? "ENOENT" : "EIO" });
    }
  });
  monitor.stderr.on("data", chunk => { monitorError = (monitorError + chunk.toString()).slice(-4096); });
  monitor.on("error", error => { launchError = error; });
  monitor.on("close", () => {
    clearTimeout(startupTimer);
    if (!terminal) child.emit("error", launchError ?? new Error(`Windows job monitor exited before joining its processes: ${monitorError}`));
    child.exitCode = terminal?.cancelled ? null : terminal?.code ?? null;
    child.signalCode = terminal?.cancelled ? requestedSignal ?? "SIGTERM" : null;
    child.stdout.end();
    child.stderr.end();
    child.emit("exit", child.exitCode, child.signalCode);
    child.emit("close", child.exitCode, child.signalCode);
  });
  for (const [index, channel] of [[1, "stdout"], [2, "stderr"]]) {
    const destination = options.stdio === "inherit" ? "inherit" : options.stdio === "ignore" ? "ignore" : options.stdio?.[index];
    if (destination === "inherit") child[channel].pipe(process[channel]);
    else if (destination === "ignore") child[channel].resume();
    else if (Number.isInteger(destination)) child[channel].on("data", bytes => writeSync(destination, bytes));
  }
  if (options.stdio === "ignore") child.stdin?.end();
  return child;
}
