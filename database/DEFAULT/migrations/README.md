# Database migrations

Apply `0001_initial.sql` to the project's `DEFAULT` database binding before enabling the backend. The initial migration is idempotent. `schema.sql` describes the same baseline.

After deployment, add new numbered migrations for changes. Validate migrations against a separate database and test backup and restore before applying them to a workspace with user records. A replacement or restored database must use the intended binding identity and generation so old device queues cannot write into an unrelated database.
