# Contributing

Thanks for helping make ProdLife better.

1. Create a focused branch from `main`.
2. Run `bun install --frozen-lockfile` and `bun run check` before opening a pull request.
3. Add the smallest regression test that proves non-trivial parser or rollover changes.
4. Do not add telemetry, remote services, or Node/Electron-only APIs without prior discussion; ProdLife supports mobile and keeps vault data local.

Bug reports should include the Obsidian version, platform, ProdLife version, relevant settings, a minimal Markdown example, and the exact result you expected.
