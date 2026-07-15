declare module "bun:test" {
  export function test(name: string, run: () => void | Promise<void>): void;
}
