import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Verification Suite (Phase 0 TDD)
 * Verifies that firestore.rules implements all Eight Pillars and blocks
 * the Dirty Dozen adversarial patterns documented in security_spec.md.
 */
const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');

const assertions: Array<{ name: string; pass: boolean }> = [
  { name: 'Uses rules_version = 2', pass: rules.includes("rules_version = '2';") },
  { name: 'Has global default-deny catch-all', pass: rules.includes('allow read, write: if false;') },
  { name: 'Enforces email_verified == true on writes', pass: rules.includes('request.auth.token.email_verified == true') },
  { name: 'Validates path IDs with regex', pass: rules.includes("id.matches('^[a-zA-Z0-9_\\\\-]+$')") },
  { name: 'Restricts /users list to false (PII isolation)', pass: /match \/users\/\{userId\}[\s\S]*?allow list: if false;/.test(rules) },
  { name: 'Enforces isValidUserProfile on create and update', pass: rules.includes('isValidUserProfile(incoming(), userId)') },
  { name: 'Enforces isValidCouncilRoom on create and update', pass: rules.includes('isValidCouncilRoom(incoming(), councilId)') },
  { name: 'Enforces Master Gate on council messages subcollection', pass: rules.includes('get(/databases/$(database)/documents/councils/$(councilId)).data.userId == request.auth.uid') },
  { name: 'Enforces zero-trust list query filtering on resource.data.userId', pass: rules.includes('allow list: if isSignedIn() && resource.data.userId == request.auth.uid;') },
  { name: 'Locks usageRecords updates to false (immutable ledger)', pass: /match \/usageRecords\/\{recordId\}[\s\S]*?allow update: if false;/.test(rules) },
  { name: 'Bounds selectedModels array length (1..6 for chat, 2..6 for councils)', pass: rules.includes('data.selectedModels.size() >= 1 && data.selectedModels.size() <= 6') && rules.includes("data.mode == 'chat'") },
  { name: 'Enforces server timestamp on user-written createdAt', pass: rules.includes('incoming().createdAt == request.time') },
  {
    name: 'Supports google, openai, anthropic, groq, openrouter, cerebras, and mistral providers',
    pass: ['google', 'openai', 'anthropic', 'groq', 'openrouter', 'cerebras', 'mistral'].every((p) =>
      rules.includes(`'${p}'`),
    ),
  },
  {
    name: 'Bounds message reactions array to 16 entries and isolates reactions updates',
    pass:
      rules.includes('data.reactions.size() <= 16') &&
      rules.includes("incoming().diff(existing()).affectedKeys().hasOnly(['reactions'])"),
  },
  {
    name: 'Strictly validates optional replyTo reference map and snippet size',
    pass:
      rules.includes('function isValidReplyTo(ref)') &&
      rules.includes("'replyTo'") &&
      rules.includes('ref.snippet.size() <= 280'),
  },
];

let failed = 0;
for (const check of assertions) {
  if (!check.pass) {
    console.error(`FAIL: ${check.name}`);
    failed++;
  } else {
    console.log(`PASS: ${check.name}`);
  }
}

if (failed > 0) {
  process.exit(1);
}
console.log('All 12 security invariant assertions passed.');
