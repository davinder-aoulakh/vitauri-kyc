# Phase 6: read rules for TmAlert, TmCase and FiuReport

Status: **applied on 16 Nov 2026** on the tenant owner's "go". Live at once (entity rules do not wait for a publish).

## The `read` rule (same for the three entities)
Same tenant AND (work domain `both` or `aml`, or one of the roles that always see both sides: Compliance Officer,
Compliance Admin, Tenant Admin, Vitauri Ops). Platform admins keep their read. `create`, `update` and `delete` are unchanged.

```json
{
  "$or": [
    {
      "$and": [
        {
          "data.tenant_id": "{{user.data.tenant_id}}"
        },
        {
          "user_condition": {
            "data.work_domain": "both"
          }
        }
      ]
    },
    {
      "$and": [
        {
          "data.tenant_id": "{{user.data.tenant_id}}"
        },
        {
          "user_condition": {
            "data.work_domain": "aml"
          }
        }
      ]
    },
    {
      "$and": [
        {
          "data.tenant_id": "{{user.data.tenant_id}}"
        },
        {
          "user_condition": {
            "data.app_role": "Compliance Officer"
          }
        }
      ]
    },
    {
      "$and": [
        {
          "data.tenant_id": "{{user.data.tenant_id}}"
        },
        {
          "user_condition": {
            "data.app_role": "Compliance Admin"
          }
        }
      ]
    },
    {
      "$and": [
        {
          "data.tenant_id": "{{user.data.tenant_id}}"
        },
        {
          "user_condition": {
            "data.app_role": "Tenant Admin"
          }
        }
      ]
    },
    {
      "$and": [
        {
          "data.tenant_id": "{{user.data.tenant_id}}"
        },
        {
          "user_condition": {
            "data.app_role": "Vitauri Ops"
          }
        }
      ]
    },
    {
      "user_condition": {
        "role": "admin"
      }
    }
  ]
}
```

Source: `amlReadRule()` in `base44/shared/workDomain.js` (covered by `tests/phase6-roles.test.js`).

## What to keep in mind
- The rule cannot see the tenant's role model. It works on the user's `work_domain` alone, so an Analyst, QC Reviewer,
  Manager or Director **without a value** cannot read alerts, investigations or FIU reports. Give every such user a work
  domain (User Management, or the "Set missing work domains" button, which sets "KYC and AML").
- A restore to an earlier checkpoint does not undo an entity rule. Use the rollback below.
- Still to verify with a real KYC-only user: that they cannot change their own `work_domain`.

## Rollback: the rule before 16 Nov 2026 (same on the three entities)
```json
{
  "$or": [
    {
      "data.tenant_id": "{{user.data.tenant_id}}"
    },
    {
      "user_condition": {
        "role": "admin"
      }
    }
  ]
}
```

## Test (spec test 10, direct read)
As a KYC-only user (role Analyst, work domain "KYC only"), in the browser console of the app:
`await base44.entities.TmAlert.list()`, `await base44.entities.TmCase.list()`, `await base44.entities.FiuReport.list()` must each return an empty list.
As a Tenant Admin, or a user with work domain "KYC and AML", the same calls return the tenant's records, and the Alerts,
Investigations and FIU Reports pages still load.
