# Contributing to Field Commander

Start with a concrete user problem and explain the behavior your change improves. For larger changes, open an issue before implementation so the workflow, data model and permissions can be discussed.

## Development

Follow the setup in [README.md](README.md). Use a separate development workspace and database. Keep access keys and private records out of issues, commits, screenshots and test output.

Run `npm test`, `npm run build` and `python3 tests/database_test.py`. When changing synchronization or sessions, also run the browser checks. For backend changes, compile the WASI module and run `scripts/backend-check.py` against that binary. The README contains exact commands.

## Review expectations

- Describe the user-visible change, validation performed and any remaining limitations.
- Preserve workspace isolation, backend authorization and idempotent receipts.
- Treat offline edits as user data. Test reconnects, uncertain receipts and concurrent edits when changing storage.
- Explain empty and error states in plain language. Keep controls usable with keyboards and narrow screens.
- Keep provider attribution and dependency licenses intact.
- Add numbered migrations for schema changes; do not rewrite an applied migration.

Contributions are distributed under the [MIT license](LICENSE).
