// SPDX-License-Identifier: Apache-2.0
import type { SpawnOptions } from "node:child_process";
export declare const spawnCommand: typeof import("node:child_process").spawn;
export declare const spawnCommandSync: typeof import("node:child_process").spawnSync;
export declare function commandInvocation(command: string, args?: readonly string[], options?: SpawnOptions): { command: string; args: string[]; options: SpawnOptions };
