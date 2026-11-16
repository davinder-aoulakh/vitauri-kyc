# Phase 6: read rules for TmAlert, TmCase and FiuReport (prepared, NOT applied)

Status: **not applied**. Decision of 16 Nov 2026: apply only on the tenant owner's "go", after a KYC-only test user exists.

## Why it is held back
- An entity read rule is live the moment it is saved (not on publish) and a checkpoint restore does not undo it.
- It cannot be tested from the build sandbox, which acts with service rights.
- The rule cannot see the tenant's role model. It works on the user's `work_domain` alone, so **every user must carry a value** (`both` for everyone who should keep access). A user without the field, and without a Compliance / admin role, would lose alerts, investigations and FIU reports.

## Before applying
1. Every user has `work_domain` (`both`, `kyc` or `aml`). Check in User Management, or ask Claude to list users without a value.
2. A test user exists with role Analyst and work domain "KYC only", in a tenant whose role model is "Separate".
3. Confirm that a user cannot change their own `work_domain` (see the phase 6 report).

## The new `read` rule (same for the three entities)
`create`, `update` and `delete` stay as they are.

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
      "user_condition": {
        "role": "admin"
      }
    }
  ]
}
```

Source: `amlReadRule()` in `base44/shared/workDomain.js` (covered by `tests/phase6-roles.test.js`).

## Rollback: the current rules
```json
{
  "TmAlert": {
    "create": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    },
    "read": {
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
    },
    "update": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    },
    "delete": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    }
  },
  "TmCase": {
    "create": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    },
    "read": {
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
    },
    "update": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    },
    "delete": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    }
  },
  "FiuReport": {
    "create": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    },
    "read": {
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
    },
    "update": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    },
    "delete": {
      "data.tenant_id": "{{user.data.tenant_id}}"
    }
  }
}
```

## Test after applying (spec test 10, direct read)
As the KYC-only test user, in the browser console of the app:
`await base44.entities.TmAlert.list()`, `await base44.entities.TmCase.list()`, `await base44.entities.FiuReport.list()` must each return an empty list.
As a user with work domain "KYC and AML" the same calls return the tenant's records, and the Alerts, Investigations and FIU Reports pages still load.
