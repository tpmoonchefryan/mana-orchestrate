// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmdirSync, unlinkSync } from "node:fs";
import { link, lstat, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, toNamespacedPath } from "node:path";

let directoryFlusher;

/** Compile once per process so frequent durable writes avoid repeated PowerShell startup. */
export function syncWindowsDirectory(path) {
  if (!directoryFlusher) {
    const directory = join(tmpdir(), `einzbern-native-${randomUUID()}`);
    if (!createPrivateWindowsDirectory(directory)) throw new Error("Native helper directory already exists");
    const executable = join(directory, "flush-directory.exe");
    const source = `using System; using System.Runtime.InteropServices;
public static class FlushDirectory {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FlushFileBuffers(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static int Main(string[] args) {
    IntPtr handle = CreateFile(args[0], 0x40000000, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle == new IntPtr(-1)) return Marshal.GetLastWin32Error();
    try { return FlushFileBuffers(handle) ? 0 : Marshal.GetLastWin32Error(); }
    finally { CloseHandle(handle); }
  }
}`;
    const encodedSource = Buffer.from(source).toString("base64");
    const encodedExecutable = Buffer.from(executable).toString("base64");
    try {
      queryWindows(`$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedSource}')); $output=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedExecutable}')); Add-Type -TypeDefinition $source -OutputAssembly $output -OutputType ConsoleApplication; ConvertTo-Json -InputObject $true`, 15_000);
      directoryFlusher = executable;
    } catch (error) {
      try { unlinkSync(executable); } catch { /* compilation may not have created a file */ }
      rmdirSync(directory);
      throw error;
    }
    process.once("exit", () => {
      try { unlinkSync(executable); rmdirSync(directory); } catch { /* a killed process can leave its private helper */ }
    });
  }
  execFileSync(directoryFlusher, [toNamespacedPath(path)], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
}

/** Publish an empty, private file without exposing a permissive ACL between create and chmod. */
export async function openPrivateWindowsFile(path) {
  const directory = join(dirname(path), `.einzbern-private-${randomUUID()}`);
  if (!createPrivateWindowsDirectory(directory)) throw new Error("Private staging directory already exists");
  const staged = join(directory, "file");
  let handle;
  let published = false;
  try {
    handle = await open(staged, "wx+", 0o600);
    await link(staged, path);
    published = true;
    await unlink(staged);
    await rmdir(directory);
    return handle;
  } catch (error) {
    if (published && handle) {
      const opened = await handle.stat().catch(() => null);
      const current = await lstat(path).catch(() => null);
      if (opened && current?.dev === opened.dev && current?.ino === opened.ino) await unlink(path).catch(() => {});
    }
    await handle?.close();
    await unlink(staged).catch(() => {});
    await rmdir(directory).catch(() => {});
    throw error;
  }
}

export function queryWindows(script, timeoutMs = 5000) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows system directory is unavailable");
  const executable = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // A PowerShell 7 parent can export module paths incompatible with Windows PowerShell.
  const command = `$ErrorActionPreference = 'Stop'; $env:PSModulePath = Join-Path $PSHOME 'Modules'; ${script}`;
  return JSON.parse(execFileSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }));
}

export function hasPrivateWindowsPermissions(path) {
  const encodedPath = Buffer.from(path, "utf8").toString("base64");
  try {
    return queryWindows(`
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'));
$acl = Get-Acl -LiteralPath $path;
$trusted = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544');
$safe = $trusted -contains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;
$write = [Security.AccessControl.FileSystemRights]'Write,DeleteSubdirectoriesAndFiles,Delete,ChangePermissions,TakeOwnership';
foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $write) -ne 0 -and $trusted -notcontains $rule.IdentityReference.Value) { $safe = $false; }
}
ConvertTo-Json -Compress -InputObject $safe`) === true;
  } catch { return false; }
}

/** Atomically create an exclusive directory with its private DACL already in place. */
export function createPrivateWindowsDirectory(path) {
  const encodedPath = Buffer.from(toNamespacedPath(path), "utf8").toString("base64");
  // Compiling the tiny native bridge can take longer on a fresh Windows profile.
  return queryWindows(`
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'));
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User;
$acl = [Security.AccessControl.DirectorySecurity]::new();
$acl.SetOwner($owner);
$acl.SetAccessRuleProtection($true, $false);
foreach ($sid in @($owner, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'));
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EinzbernPrivateDirectory {
  [StructLayout(LayoutKind.Sequential)]
  private struct SecurityAttributes {
    public int Length;
    public IntPtr Descriptor;
    public int InheritHandle;
  }
  [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CreateDirectory(string path, ref SecurityAttributes attributes);
  public static int Create(string path, byte[] descriptor) {
    IntPtr memory = Marshal.AllocHGlobal(descriptor.Length);
    try {
      Marshal.Copy(descriptor, 0, memory, descriptor.Length);
      var attributes = new SecurityAttributes {
        Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = memory, InheritHandle = 0
      };
      return CreateDirectory(path, ref attributes) ? 0 : Marshal.GetLastWin32Error();
    } finally { Marshal.FreeHGlobal(memory); }
  }
}
'@;
$errorCode = [EinzbernPrivateDirectory]::Create($path, $acl.GetSecurityDescriptorBinaryForm());
if ($errorCode -ne 0 -and $errorCode -ne 183) { throw [ComponentModel.Win32Exception]::new($errorCode); }
ConvertTo-Json -InputObject ($errorCode -eq 0)`, 15_000);
}

/** Query the kernel object, including membership, instead of trusting an environment marker. */
export function windowsJobProcesses(name) {
  if (!/^Local\\Einzbern-[0-9a-f-]{36}$/u.test(name ?? "")) throw new Error("Invalid Windows job name");
  return queryWindows(`
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class EinzbernJobQuery {
  public class Result { public bool Exists; public long[] Pids; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr result, int size, IntPtr returned);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static Result Query(string name) {
    IntPtr job = OpenJobObject(4, false, name);
    if (job == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      if (error == 2) return new Result { Exists = false, Pids = new long[0] };
      throw new Win32Exception(error);
    }
    try {
      int size = 4096;
      while (size <= 16 * 1024 * 1024) {
        IntPtr data = Marshal.AllocHGlobal(size);
        try {
          if (QueryInformationJobObject(job, 3, data, size, IntPtr.Zero)) {
            int count = Marshal.ReadInt32(data, 4);
            var pids = new long[count];
            for (int index = 0; index < count; index++)
              pids[index] = Marshal.ReadIntPtr(data, 8 + index * IntPtr.Size).ToInt64();
            return new Result { Exists = true, Pids = pids };
          }
          int error = Marshal.GetLastWin32Error();
          if (error != 234) throw new Win32Exception(error);
        } finally { Marshal.FreeHGlobal(data); }
        size *= 2;
      }
      throw new InvalidOperationException("Job membership exceeds query capacity");
    } finally { CloseHandle(job); }
  }
}

'@;
ConvertTo-Json -InputObject ([EinzbernJobQuery]::Query('${name}'))`, 15_000);
}

export function windowsJobState(name, pid = process.pid) {
  if (!/^Local\\Einzbern-[0-9a-f-]{36}$/u.test(name ?? "")) return null;
  const result = windowsJobProcesses(name);
  if (!result.Exists) return "missing";
  if (result.Pids.length === 0) return "empty";
  return result.Pids.includes(pid) ? "member" : "active";
}

/** Serialize recovery in a kernel mutex, which is released even if the recoverer dies. */
export function retireWindowsOutputSession(path, expectedOwner, destination) {
  const encoded = value => Buffer.from(value, "utf8").toString("base64");
  return queryWindows(`
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(path)}'));
$destination = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(destination)}'));
$expected = '${Buffer.from(expectedOwner).toString("base64")}';
$hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($path.ToLowerInvariant()))).Replace('-', '');
$mutex = [Threading.Mutex]::new($false, ('Local\\Einzbern-recovery-' + $hash));
$acquired = $false;
try {
  try { $acquired = $mutex.WaitOne(0); } catch [Threading.AbandonedMutexException] { $acquired = $true; }
  if (-not $acquired) { throw 'Output recovery is busy'; }
  $owner = Join-Path $path 'owner.json';
  if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($owner)) -ne $expected) { throw 'Output owner changed'; }
  $entries = @([IO.Directory]::GetFileSystemEntries($path));
  if ($entries.Length -ne 1 -or $entries[0] -ne $owner) { throw 'Output session changed'; }
  [IO.Directory]::Move($path, $destination);
  $retired = Join-Path $destination 'owner.json';
  if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($retired)) -ne $expected) { throw 'Retired output owner changed'; }
  [IO.File]::Delete($retired);
  [IO.Directory]::Delete($destination);
} finally {
  if ($acquired) { $mutex.ReleaseMutex(); }
  $mutex.Dispose();
}
ConvertTo-Json -InputObject $true`);
}

/** Windows 10+ atomic replacement that retains already-open readers of the old file. */
export function replaceWindowsFile(from, to) {
  const encoded = value => Buffer.from(toNamespacedPath(value), "utf8").toString("base64");
  const code = queryWindows(`
$from = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(from)}'));
$to = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(to)}'));
${WINDOWS_RENAME_DECLARATION}
ConvertTo-Json -InputObject ([EinzbernReplace]::Replace($from, $to))`, 15_000);
  if (code !== 0) throw Object.assign(new Error(`Windows atomic replacement failed (${code})`), { code: "EPERM", nativeCode: code });
}

const WINDOWS_RENAME_DECLARATION = String.raw`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EinzbernReplace {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr attributes, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetFileInformationByHandle(IntPtr file, int kind, IntPtr data, uint size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr file);
  public static int Replace(string from, string to) {
    IntPtr file = CreateFile(from, 0x10000, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if (file == new IntPtr(-1)) return Marshal.GetLastWin32Error();
    byte[] name = Encoding.Unicode.GetBytes(to);
    int rootOffset = IntPtr.Size == 8 ? 8 : 4;
    int lengthOffset = rootOffset + IntPtr.Size;
    int nameOffset = lengthOffset + 4;
    int size = nameOffset + name.Length + 2;
    IntPtr data = Marshal.AllocHGlobal(size);
    try {
      Marshal.Copy(new byte[size], 0, data, size);
      Marshal.WriteInt32(data, 3);
      Marshal.WriteIntPtr(data, rootOffset, IntPtr.Zero);
      Marshal.WriteInt32(data, lengthOffset, name.Length);
      Marshal.Copy(name, 0, IntPtr.Add(data, nameOffset), name.Length);
      return SetFileInformationByHandle(file, 22, data, (uint)size) ? 0 : Marshal.GetLastWin32Error();
    } finally { Marshal.FreeHGlobal(data); CloseHandle(file); }
  }
}
'@;`;
