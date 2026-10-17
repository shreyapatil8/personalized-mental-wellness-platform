# Existing database audit

No existing database was changed or seeded during implementation. Tests use disposable MongoDB.

On 23 September 2026 the read-only audit could not connect to the configured Atlas cluster, including a retry outside the restricted environment. Indexes remain unverified. Check cluster availability, connection settings and Atlas network access for the intended machine; the generic connection error does not identify a single confirmed cause.

Run `pnpm --filter backend db:check` after configuring the intended MONGODB_URI. It reads active collision counts and indexes without editing records/indexes. An empty database may not have an appointments collection; normal startup creates indexes for new schemas.

Expected unique indexes: `{counsellor: 1, scheduledFor: 1}` and `{student: 1, scheduledFor: 1}`, each with `partialFilterExpression: {status: {$in: ['pending', 'approved']}}`. New appointments use fixed 30-minute slots on an hour/half hour.

For legacy databases, first back up and review collisions and off-grid timestamps with appointment owners. Do not discard appointments automatically. After resolving conflicts, an operator can replace only incompatible old indexes with the definitions in backend/src/models/Appointment.js. Review before using broad syncIndexes(), which can remove other indexes. Rerun the audit. Tests used MongoDB 8.2.6; verify partial-index operator support on the intended version.

Old Low/Medium/High predictions remain historical and are excluded by the current schema-version filter. Never relabel them as Eustress/Distress. Previously active counsellors remain active; new registrations require activation. The weak local JWT secret was replaced, invalidating old sessions.
