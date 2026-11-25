// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmdirSync, unlinkSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, toNamespacedPath } from "node:path";

// Add-Type may need to start the framework compiler and scan a new assembly on a cold runner.
const nativeBuildTimeoutMs = 60_000;
const aclPolicyRejected = 0x20000001;
let fileHelper;

/** Build a process-local native helper under the caller's protected temp directory. */
export function compileWindowsHelper(name, source) {
  if (!/^[a-z][a-z0-9-]*\.exe$/u.test(name)) throw new Error("Invalid native helper name");
  const directory = join(tmpdir(), `einzbern-native-${randomUUID()}`);
  if (!createPrivateWindowsDirectory(directory)) throw new Error("Native helper directory already exists");
  const executable = join(directory, name);
  const encodedSource = Buffer.from(source).toString("base64");
  const encodedExecutable = Buffer.from(executable).toString("base64");
  try {
    queryWindows(`$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedSource}')); $output=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedExecutable}')); Add-Type -TypeDefinition $source -OutputAssembly $output -OutputType ConsoleApplication; ConvertTo-Json -InputObject $true`, nativeBuildTimeoutMs);
  } catch (error) {
    try { unlinkSync(executable); } catch { /* compilation may not have created a file */ }
    rmdirSync(directory);
    throw error;
  }
  process.once("exit", () => {
    try { unlinkSync(executable); rmdirSync(directory); } catch { /* a still-running or killed helper can leave its private directory */ }
  });
  return executable;
}

// File creation compiles the directory flusher before any two-link publication window opens.
function windowsFileHelper() {
  if (!fileHelper) {
    const source = `using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
public static class EinzbernFiles {
  [StructLayout(LayoutKind.Sequential)]
  struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int InheritHandle; }
  [StructLayout(LayoutKind.Sequential)]
  struct FileIdInfo { public ulong Volume; public ulong Low; public ulong High; }
  [DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string path, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out FileIdInfo info, uint size);
  [DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle OpenDirectory(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool FlushFileBuffers(SafeFileHandle handle);
  [DllImport("advapi32.dll", EntryPoint="GetNamedSecurityInfoW", CharSet=CharSet.Unicode)]
  static extern uint GetSecurity(string path, int type, uint sections, out IntPtr owner, out IntPtr group,
    out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  static bool Trusted(SecurityIdentifier sid, SecurityIdentifier current) {
    return sid != null && (sid.Equals(current) || sid.IsWellKnown(WellKnownSidType.LocalSystemSid)
      || sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));
  }
  static int CheckAcl(string path, bool privateRead) {
    const int policyRejected = ${aclPolicyRejected};
    IntPtr owner, group, dacl, sacl, descriptor;
    uint error = GetSecurity(path, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
    if (error != 0) return (int)error;
    try {
      // A NULL DACL gives everyone full access. An empty DACL grants no rights.
      if (descriptor == IntPtr.Zero || owner == IntPtr.Zero || dacl == IntPtr.Zero) return policyRejected;
      byte[] bytes = new byte[GetSecurityDescriptorLength(descriptor)];
      Marshal.Copy(descriptor, bytes, 0, bytes.Length);
      var security = new RawSecurityDescriptor(bytes, 0);
      var current = WindowsIdentity.GetCurrent().User;
      if (!Trusted(security.Owner, current) || security.DiscretionaryAcl == null) return policyRejected;
      var rights = FileSystemRights.Write | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.Delete
        | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
      if (privateRead) rights |= FileSystemRights.ReadData | FileSystemRights.ExecuteFile;
      uint mask = (uint)rights | 0x50000000u; // GENERIC_ALL and GENERIC_WRITE
      if (privateRead) mask |= 0xA0000000u;   // GENERIC_READ and GENERIC_EXECUTE
      foreach (GenericAce entry in security.DiscretionaryAcl) {
        var rule = entry as QualifiedAce;
        if (rule == null) return policyRejected;
        if (rule.AceQualifier == AceQualifier.AccessAllowed && ((uint)rule.AccessMask & mask) != 0
          && !Trusted(rule.SecurityIdentifier, current)) return policyRejected;
      }
      return 0;
    } finally { LocalFree(descriptor); }
  }
  public static int Main(string[] args) {
    if (args.Length != 2) return 87;
    if (args[0] == "create") return CreatePrivate(args[1]);
    if (args[0] == "acl-write" || args[0] == "acl-private") return CheckAcl(args[1], args[0] == "acl-private");
    bool probe = args[0] == "probe";
    if (!probe && args[0] != "flush") return 87;
    // FILE_ADD_FILE and FILE_ADD_SUBDIRECTORY check the caller's token without writing.
    using (var directory = OpenDirectory(args[1], probe ? 6u : 0x40000000u, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (directory.IsInvalid) return Marshal.GetLastWin32Error();
      return probe || FlushFileBuffers(directory) ? 0 : Marshal.GetLastWin32Error();
    }
  }
  static int CreatePrivate(string path) {
    var owner = WindowsIdentity.GetCurrent().User;
    var acl = new FileSecurity();
    acl.SetOwner(owner);
    acl.SetAccessRuleProtection(true, false);
    foreach (var sid in new [] {owner, new SecurityIdentifier("S-1-5-18"), new SecurityIdentifier("S-1-5-32-544")})
      acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, AccessControlType.Allow));
    byte[] descriptor = acl.GetSecurityDescriptorBinaryForm();
    var pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
    try {
      var security = new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor=pinned.AddrOfPinnedObject() };
      using (var file = CreateFile(path, 0xC0000000, 7, ref security, 1, 0x80, IntPtr.Zero)) {
        if (file.IsInvalid) return Marshal.GetLastWin32Error();
        FileIdInfo id;
        if (!GetFileInformationByHandleEx(file, 18, out id, (uint)Marshal.SizeOf(typeof(FileIdInfo)))) return Marshal.GetLastWin32Error();
        if (id.High != 0) return 50;
        // libuv exposes the low DWORD of the volume serial as st_dev.
        Console.WriteLine(((uint)id.Volume).ToString(CultureInfo.InvariantCulture) + " " + id.Low.ToString(CultureInfo.InvariantCulture));
      }
      return 0;
    } finally { pinned.Free(); }
  }
}`;
    fileHelper = compileWindowsHelper("filesystem.exe", source);
  }
  return fileHelper;
}

function runWindowsFileOperation(path, operation) {
  execFileSync(windowsFileHelper(), [operation, toNamespacedPath(path)], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
}

export function syncWindowsDirectory(path) { runWindowsFileOperation(path, "flush"); }
export function assertWritableWindowsDirectory(path) { runWindowsFileOperation(path, "probe"); }

/** Create the name and its private DACL together, then bind Node's handle to that exact file. */
export async function openPrivateWindowsFile(path) {
  let identity;
  try {
    identity = execFileSync(windowsFileHelper(), ["create", toNamespacedPath(path)], { encoding: "utf8", windowsHide: true, timeout: 15_000 }).trim();
  } catch (error) {
    if (error.status === 80 || error.status === 183) throw Object.assign(new Error("EEXIST: private file already exists"), { code: "EEXIST", syscall: "open", path });
    throw error;
  }
  const matches = stats => stats.isFile() && stats.nlink === 1n && `${stats.dev} ${stats.ino}` === identity;
  const named = await lstat(path, { bigint: true });
  if (!matches(named)) throw new Error("Private file identity changed after creation");
  const handle = await open(path, "r+");
  try {
    if (!matches(await handle.stat({ bigint: true })) || !matches(await lstat(path, { bigint: true }))) throw new Error("Private file identity changed while opening");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function queryWindows(script, timeoutMs = 5000) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot)) throw new Error("Windows system directory is unavailable");
  const executable = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // A PowerShell 7 parent can export module paths incompatible with Windows PowerShell.
  const command = `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $env:PSModulePath = Join-Path $PSHOME 'Modules'; ${script}`;
  return JSON.parse(execFileSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }));
}

export function inspectWindowsPermissions(path, privateRead = false) {
  let executable;
  try { executable = windowsFileHelper(); } catch { return "helper-unavailable"; }
  try {
    execFileSync(executable, [privateRead ? "acl-private" : "acl-write", toNamespacedPath(path)], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
    return "accepted";
  } catch (error) {
    if (error.status === aclPolicyRejected) return "policy-rejected";
    return error.code === "ENOENT" ? "helper-unavailable" : "query-failed";
  }
}

export function hasPrivateWindowsPermissions(path, privateRead = false) {
  return inspectWindowsPermissions(path, privateRead) === "accepted";
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
ConvertTo-Json -InputObject ($errorCode -eq 0)`, nativeBuildTimeoutMs);
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
