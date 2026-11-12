declare module "node:fs" {
  export function openSync(path: string, flags: string): number;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  export function closeSync(fd: number): void;
}

declare module "node:fs/promises" {
  export type Entry = { name: string; isDirectory(): boolean };
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Entry[]>;
  export function stat(path: string): Promise<{ mtimeMs: number; size: number }>;
}

declare module "node:os" {
  export function homedir(): string;
  export function availableParallelism(): number;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(path: string): string;
}

declare module "node:worker_threads" {
  export const isMainThread: boolean;
  export const parentPort: {
    postMessage(message: unknown): void;
    on(event: "message", listener: (message: unknown) => void): void;
  } | null;
  export class Worker {
    constructor(path: string);
    postMessage(message: unknown): void;
    on(event: "message", listener: (message: unknown) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    terminate(): Promise<number>;
  }
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number | undefined;
};

declare class TextDecoder {
  decode(input: Uint8Array, options?: { stream: boolean }): string;
}

declare const console: { log(text: string): void };

declare module "node:child_process" {
  export type Child = {
    stdout: AsyncIterable<Uint8Array>;
    stderr: { on(event: "data", listener: (chunk: Uint8Array) => void): void };
    on(event: "close", listener: (code: number | null, signal: string | null) => void): void;
  };
  export function spawn(command: string, args: readonly string[]): Child;
}

declare module "node:module" {
  export type Resolve = (specifier: string, context: unknown) => unknown;
  export function registerHooks(hooks: {
    resolve(specifier: string, context: unknown, next: Resolve): unknown;
  }): void;
}
