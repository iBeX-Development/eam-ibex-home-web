# Chat V88 full data migration — 2026-11-23

The owner explicitly authorized replacing the VPS application database with the complete chat Site V88 data, including admin/user identities, password hashes, sessions/tokens, AI records and settings. The owner explicitly waived a pre-migration backup for this test environment.

Source: Site project `appgprj_6a81bb651d4c8191b8bf7c4a9a1492cc`, V88 application source `f9a1510c03dd9f0f6cfe30d47618789cf8bdb42e`. The transfer includes 33 application tables, 132 rows, 2 object-storage files and 5 application runtime settings. PostgreSQL/S3 infrastructure connection values remain specific to the VPS.

The repository contains only RSA-OAEP/AES-256-GCM encrypted transfer data and a non-sensitive reconciliation manifest. The decrypting private key stays outside the repository on the VPS. Import validates the authenticated ciphertext and every object hash, verifies target schema, imports application rows in a PostgreSQL transaction, and compares row counts and canonical row hashes before commit. A server-local completion marker prevents later deploys from reapplying the source snapshot.

Validation: 232 existing regression tests, lint and typecheck passed. Encryption round-trip using the actual full payload passed; modified ciphertext was rejected before database access. VPS build/smoke and live reconciliation are verified separately in deployment logs. The existing dependency-audit exception for Next.js 16.3.8 remains; no dependency upgrade is included.

The temporary source export route is removed after extraction and the source Site is returned to its saved V88 deployment. This operation transfers existing data; it does not implement the deferred backup feature or ongoing automatic content synchronization.

## Live execution evidence

The initial transaction was rolled back by reconciliation of PostgreSQL REAL values. Both sides are now normalized to the same database numeric representation, with focused regression tests covering the source values and PostgreSQL short-decimal output.

Run `45122192379` successfully imported and reconciled all 33 tables, 132 rows, 2 objects and 5 application runtime settings. The VPS returned ready after PM2 reload at commit `b826af92c2119ac4801aa8f2f4eb1e19cb2b90ce`. Live `/api/content` navigation, partners, people and pricing match the source Site response; mobile environment status is active.

The reload helper explicitly loads the migrated `.env.vps` into PM2 and verifies the five application settings in the PM2 process state without logging their values. Subsequent deployments use the migration completion marker and do not overwrite later admin changes.
