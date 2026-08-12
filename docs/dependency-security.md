# Dependency security decisions

## 2026-08-11: Drizzle Kit development-tool exception

Decision: retain Drizzle Kit 0.31.10 and do not run `npm audit fix --force`.

The complete npm audit reports four moderate findings through Drizzle Kit's deprecated `@esbuild-kit/esm-loader` dependency and its nested esbuild 0.18.20. The advisory concerns an exposed esbuild development server. calenolav does not run or expose that server, Drizzle Kit is a development-only migration tool, and the production-only audit reports zero findings.

npm proposes Drizzle Kit 0.18.1 as the automated fix. That is a significant downgrade and is not an acceptable security update. We will instead:

- keep the dependency lockfile committed;
- run Drizzle Kit only during local development and controlled CI migration jobs;
- deny esbuild install scripts; the required platform binaries already work without running them;
- require `npm audit --omit=dev` to pass; and
- revisit this exception whenever Drizzle Kit is updated or replaces the deprecated loader.
