declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
  exitCode?: number;
};

declare const Buffer: {
  from(value: ArrayBuffer | ArrayBufferView | string): Uint8Array;
};

declare module "crypto" {
  export function randomUUID(): string;
}

declare module "fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(path: string, data: ArrayBufferView | string): Promise<void>;
}

declare module "path" {
  const path: {
    basename(input: string): string;
    extname(input: string): string;
    join(...parts: string[]): string;
  };
  export default path;
}
