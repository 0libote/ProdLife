declare module "bun:test" {
  export function test(name: string, run: () => void | Promise<void>): void;
  export const mock: { module(name: string, factory: () => Record<string, unknown>): void };
}
