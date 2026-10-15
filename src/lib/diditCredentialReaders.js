// Every server file that reads (or receives and uses) Didit credentials, and how it obtains the tenant.
// Hard-coded on purpose: add a line here whenever a new reader is written. Built by searching base44/functions and base44/shared.
export const ALLOWED_METHODS = ['withDiditCredentials', 'loadTenantWithDiditCredentials', 'direct parameter', 'diditCredentials internals', 'Ops maintenance'];

const W = 'withDiditCredentials';
const L = 'loadTenantWithDiditCredentials';
const P = 'direct parameter';

export const CREDENTIAL_READERS = [
  { file: 'base44/functions/backtestRule/entry.ts', method: W },
  { file: 'base44/functions/batchScreening/entry.ts', method: W },
  { file: 'base44/functions/createDiditSession/entry.ts', method: W },
  { file: 'base44/functions/createDiditTransaction/entry.ts', method: W },
  { file: 'base44/functions/dailyMonitoring/entry.ts', method: W },
  { file: 'base44/functions/diditCredentialSelfTest/entry.ts', method: W, note: 'Also reads TenantSecret to report the source' },
  { file: 'base44/functions/diditEndpointCheck/entry.ts', method: W },
  { file: 'base44/functions/diditProxy/entry.ts', method: W },
  { file: 'base44/functions/diditWebhook/entry.ts', method: W },
  { file: 'base44/functions/getDiditSessionDetails/entry.ts', method: W },
  { file: 'base44/functions/getDiditSessionResult/entry.ts', method: W },
  { file: 'base44/functions/getDiditTransaction/entry.ts', method: W },
  { file: 'base44/functions/registerDiditWebhook/entry.ts', method: W },
  { file: 'base44/functions/runTmRegression/entry.ts', method: W, note: 'Tenant comes from requireOpsDemo' },
  { file: 'base44/functions/screenEntityAml/entry.ts', method: W },
  { file: 'base44/functions/submitToDidit/entry.ts', method: W },
  { file: 'base44/functions/syncDiditRule/entry.ts', method: W },
  { file: 'base44/functions/toggleDiditMonitoring/entry.ts', method: W },
  { file: 'base44/functions/updateDiditHitStatus/entry.ts', method: W },
  { file: 'base44/functions/generateDiditFiuReport/entry.ts', method: L },
  { file: 'base44/functions/approveExpectedProfile/entry.ts', method: L },
  { file: 'base44/functions/tmRuleAction/entry.ts', method: L },
  { file: 'base44/functions/clearTenantSecrets/entry.ts', method: 'Ops maintenance', note: 'Blanks legacy Tenant fields after migration' },
  { file: 'base44/functions/migrateDiditSecrets/entry.ts', method: 'Ops maintenance', note: 'Copies legacy Tenant values into TenantSecret' },
  { file: 'base44/functions/tmHealth/entry.ts', method: 'Ops maintenance', note: 'Reads raw Tenant only to flag legacy secrets still present' },
  { file: 'base44/shared/diditCredentials.js', method: 'diditCredentials internals' },
  { file: 'base44/shared/diditTm.js', method: P, note: 'Tenant passed in by the caller' },
  { file: 'base44/shared/tmRegression.js', method: W, note: 'requireOpsDemo; signed replays use the tenant passed in' },
  { file: 'base44/shared/tmFiuGenerate.js', method: P, note: 'Via diditTm' },
  { file: 'base44/shared/tmRuleBacktest.js', method: P, note: 'Via diditTm' },
  { file: 'base44/shared/tmRuleSync.js', method: P, note: 'Via diditTm' },
];