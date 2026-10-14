# Repository Guidelines

## Project Structure & Module Organization

This repository is an initial scaffold for Codex-Cryptum-2026. The only existing tracked project file is `README.md`, which contains the project title. No source code, tests, assets, or dependency manifests are present yet.

When adding the first implementation, document its directory layout in `README.md`. Group source code, tests, and assets into clearly named directories appropriate to the chosen stack; do not assume a framework or language has already been selected.

## Build, Test, and Development Commands

No build system, development server, or test runner is configured. Commands such as `npm test` or `make build` are not currently available.

Useful repository checks:

- `git status --short`: inspect pending changes before committing.
- `git diff --check`: detect whitespace errors in unstaged changes.
- `git diff --cached`: review staged changes before committing.

When introducing tooling, add reproducible installation, development, build, and test commands to `README.md` alongside the relevant configuration files.

## Coding Style & Naming Conventions

No language-specific style, indentation standard, formatter, or linter is established. Follow surrounding conventions when editing existing files. For new code, choose consistent indentation and descriptive names, and configure formatting and linting tools appropriate to the language.

Keep Markdown headings descriptive, command examples executable, and documentation aligned with actual repository behavior.

## Testing Guidelines

No testing framework or coverage threshold exists. When adding executable code, include tests for its main behavior and relevant failure cases. Establish a consistent test naming pattern and document how to run the suite. Verify documentation changes by checking paths, commands, and Markdown formatting.

## Commit & Pull Request Guidelines

The Git history contains only `Initial commit`; no recurring commit convention is established. Use concise, imperative summaries, such as `Add project setup documentation`, and keep commits focused.

Pull requests should explain the change, its purpose, and verification performed. Link relevant issues when available; include screenshots for visible interface changes. Mention new dependencies, configuration requirements, and any checks that could not be run.
