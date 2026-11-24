# T.U.T AI Council — Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict User Ownership**: Every user profile, encrypted provider credential, model preset, council room, council message, and usage record is owned by exactly one Firebase Auth `uid`. Cross-user reads, lists, updates, or deletes are strictly denied.
2. **Email Verification Gate**: All authenticated Firestore writes require `request.auth.token.email_verified == true`.
3. **Master Gate on Subcollections**: `/councils/{councilId}/messages/{messageId}` must verify via `get()` that `/councils/{councilId}` exists and `userId == request.auth.uid`, and `incoming().councilId == councilId`.
4. **Immutable Ownership & Timestamps**: `uid`, `userId`, `id`, `councilId`, and `createdAt` can never be reassigned or forged on update; `createdAt` and `updatedAt` on user-created documents must equal `request.time`.
5. **Bounded Arrays & Strings**: Every string field has strict `.size()` bounds and IDs match `^[a-zA-Z0-9_\-]+$`. Array fields (`selectedModels`, `models`) are strictly bounded (`1 <= size <= 8`).
6. **Zero Shadow Fields**: Every `create` validates exact required and allowed keys (`hasAll` + `hasOnly`), and every `update` uses action-based `affectedKeys().hasOnly(...)` combined with `isValid[Entity](incoming())`.
7. **Zero Query Trust**: Every `allow list` rule explicitly enforces `resource.data.userId == request.auth.uid` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Profile Creation**: `create /users/alice` with `auth: null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: `create /councils/c1` with `auth.token.email_verified: false` -> `PERMISSION_DENIED`.
3. **Cross-User Council Hijack**: User Bob attempts `get` or `update` on `/councils/alice_c1` -> `PERMISSION_DENIED`.
4. **Cross-User Query Scraping**: User Bob runs `list /councils` without `where('userId', '==', 'bob')` -> `PERMISSION_DENIED`.
5. **Identity Spoofing on Create**: User Bob creates `/councils/c2` with `userId: "alice"` -> `PERMISSION_DENIED`.
6. **Shadow / Ghost Field Injection**: User Alice creates `/users/alice` with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
7. **ID Poisoning**: User Alice creates `/councils/invalid$id/../hack` -> `PERMISSION_DENIED`.
8. **Timestamp Forgery**: User Alice creates `/councils/c3` with `createdAt: Timestamp(2020-01-01)` instead of `request.time` -> `PERMISSION_DENIED`.
9. **Orphaned Message Injection**: User Alice creates `/councils/nonexistent/messages/m1` -> `PERMISSION_DENIED`.
10. **Cross-Tenant Subcollection Write**: User Bob attempts `create /councils/alice_c1/messages/m2` with `userId: "bob"` -> `PERMISSION_DENIED`.
11. **Unbounded Array Exhaustion**: User Alice creates `/councils/c4` with `selectedModels` containing 10 entries (exceeds max 6) -> `PERMISSION_DENIED`.
12. **Usage Record Tampering**: User Alice attempts `update /usageRecords/r1` to zero out `inputTokens` -> `PERMISSION_DENIED`.
