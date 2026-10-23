# Network and peer-group detection: design note (groundwork only)

Status: data groundwork is built; detection is **not** switched on. The engine (Vitauri-side scoring vs. Didit
rules) is decided after the Didit validation test. Nothing in this note raises alerts today.

## What exists now

| Piece | Where | Purpose |
|---|---|---|
| `Client.client_segment` | entity field | Peer group of a customer, set by compliance (e.g. `NP_salaried`, `NP_self_employed`, `ORG_retail_SME`, `ORG_holding`). |
| `Counterparty.client_id` / `related_party_id` | entity fields + `linkCounterparty` | A counterparty that is itself a customer or a UBO/director/related company. Manual, audited, reversible. |
| `CounterpartyEdge` | entity, built by `buildCounterpartyGraph` (nightly) | One row per customer × counterparty × direction for the last 90 days: count, amount in reporting currency, first/last date, and `counterparty_client_id` when the other side is a customer. |

`buildCounterpartyGraph` uses the same countable-transaction rules as the profile actuals (booked/corrected only,
no own transfers, reversals removed) and the tenant reporting currency.

## Patterns to detect (when switched on)

1. **Circular flows** — a cycle customer A → B → … → A within N days where every hop is a customer → customer edge
   (`counterparty_client_id` set). Search depth 2–4 on the edge graph; score on the share of the original amount that
   returns and on the elapsed time.
2. **Fan-in (many-to-one)** — one customer receiving from ≥ K distinct counterparties within the window with small,
   similar amounts (structuring / money-mule collection). Uses inbound edges per customer; compare against the
   customer's peer group to avoid flagging businesses that normally have many payers.
3. **Fan-out (one-to-many)** — the mirror: rapid distribution to many counterparties shortly after a large inbound,
   typically combined with S-11 "Rapid in/out".
4. **Peer-group outliers** — per `client_segment`, compute medians and robust spread (MAD) of inbound, outbound,
   counterparty count and foreign share per month; flag customers above a configured multiple. Replaces the current
   placeholder scenario S-21.

## Open decisions

- Engine location: Vitauri job over `CounterpartyEdge` vs. Didit rules; depends on what the validation test shows
  Didit can express (multi-hop flows are unlikely to be expressible there).
- Thresholds per segment and jurisdiction; to be set by compliance with backtesting (`RuleBacktest`).
- Whether name-only counterparty matches (low confidence) may form edges in a cycle, or only identifier matches.
- Alerts from network patterns would follow the existing lifecycle: `TmAlert` with `scenario_id`, evidence citing
  `txn:` refs, and inclusion in the Quality coverage matrix once a scenario and rule exist.

## Operational notes

- Schedule `buildCounterpartyGraph` nightly (after ingestion) in Base44.
- Edges are derived data: they are rebuilt each run and rows with no flow left in the window are removed.
- The Customer 360 Network view can read `CounterpartyEdge` to draw flows without querying raw transactions.
