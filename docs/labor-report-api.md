# Labor Report API — TimeOff Integration

## Endpoint

```
POST /api/labor-report/worklog
```

**Base URL:** `https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app`

**Full URL:** `https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app/api/labor-report/worklog`

---

## Authentication

Pass the shared webhook secret in the request header:

```
X-Webhook-Secret: <WEBHOOK_SECRET>
```

| Condition | Response |
|---|---|
| Header missing | `401 Unauthorized` |
| Header present but wrong value | `403 Forbidden` |
| Header correct | Request proceeds |

The secret is stored as the `WEBHOOK_SECRET` environment variable on Cloud Run (same secret used by the `/api/import-leaves` webhook).

---

## Request Body

`Content-Type: application/json`

```json
{
  "employee_id": "42",
  "employee_email": "beka.chkheidze@example.com",
  "year": 2026,
  "month": 5,
  "timezone": "Asia/Tbilisi",
  "aggregation": "shift_start_day"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `employee_id` | string | One of `employee_id` or `employee_email` is required | Internal employee ID |
| `employee_email` | string | One of `employee_id` or `employee_email` is required | Looked up against `teamMembers` in Firebase |
| `year` | integer | Yes | e.g. `2026` |
| `month` | integer | Yes | 1–12 |
| `timezone` | string | No | IANA timezone name. Default: `Asia/Tbilisi` |
| `aggregation` | string | No | Currently only `shift_start_day` is supported |

---

## Response — 200 OK

```json
{
  "days": [
    {
      "date": "2026-05-01",
      "worked_hours": 9.0,
      "day_hours": 7.0,
      "night_hours": 2.0,
      "overtime_hours": 0.0,
      "rest_holiday_worked_hours": 0.0,
      "other_worked_hours": 0.0,
      "is_rest_day": false
    }
  ]
}
```

### Field descriptions

| Field | Type | Description |
|---|---|---|
| `date` | string | ISO date `YYYY-MM-DD` — the **shift start date** |
| `worked_hours` | float | Total worked hours for that day |
| `day_hours` | float | Non-night regular hours (worked_hours minus night/overtime) |
| `night_hours` | float | Hours in the night-premium window 22:00–06:00 |
| `overtime_hours` | float | Overtime hours (from `overtime` shift type) |
| `rest_holiday_worked_hours` | float | Work on weekly rest or public holiday (reserved, currently `0`) |
| `other_worked_hours` | float | Any hours not captured above (reserved, currently `0`) |
| `is_rest_day` | boolean | Scheduled rest day flag (reserved, currently `false`) |

All hour fields are numeric (float). Never strings.

---

## Key Behaviours

### Cross-midnight shifts
A night shift that **starts on May 31** (19:00) and **ends on June 1** (04:00) is credited **entirely to May 31**. It will appear in a May query, not a June query. The shift's stored `date` field is always used as the aggregation key — hours are never split across calendar days.

### Same-day aggregation
If an employee has multiple shifts starting on the same date (e.g. a regular shift + an overtime block), they are **summed into a single row**.

### Night-premium hours (Georgian labour law)
Night hours are calculated as overlap with the window **22:00–06:00**:

| Shift | Night hours |
|---|---|
| Morning 04:00–13:00 | 2.0 h (04:00–06:00) |
| Day 10:00–19:00 | 0.0 h |
| Afternoon 15:00–00:00 | 2.0 h (22:00–00:00) |
| Night 19:00–04:00 | 6.0 h (22:00–04:00) |

### No data
If the employee exists but has no shifts in the requested month, the response is:
```json
{ "days": [] }
```
No synthetic rows are generated for days with no work.

### Overtime shifts
Shifts stored with `shift_type: "overtime"` use the `duration_hours` field and contribute to `overtime_hours` only. They are not included in night-hours calculation.

---

## Example `curl`

```bash
curl -X POST \
  https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app/api/labor-report/worklog \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: 9qANQw6-JTceZnmOW4q3HQOb9rAKAIpHSp8-B7e15qs" \
  -d '{
    "employee_id": "42",
    "year": 2026,
    "month": 5,
    "timezone": "Asia/Tbilisi",
    "aggregation": "shift_start_day"
  }'
```

---

## Error Responses

| Status | Meaning |
|---|---|
| `401` | `X-Webhook-Secret` header is missing |
| `403` | `X-Webhook-Secret` value is incorrect |
| `400` | Invalid request body (missing employee identifier, invalid month/year) |
| `500` | Firebase read failure or internal error |

---

## Data Source

Shift data is read from **Firebase Realtime Database**:

```
schedules/{weekStart}/assignments   →  array of shift records
teamMembers                         →  employee email → id lookup
```

`weekStart` is always a Monday in `YYYY-MM-DD` format. The endpoint automatically determines which weeks overlap the requested month and reads all of them.

---

## Compatibility Aliases

The TimeOff parser also accepts the following aliases (all return the same data):

| Preferred key | Accepted aliases |
|---|---|
| `days` | `workdays`, `items` |
| `date` | `work_date`, `shift_start_date` |
| `worked_hours` | `hours` |
| `rest_holiday_worked_hours` | `weekend_holiday_hours` |

---

## Implementation Files

| File | Purpose |
|---|---|
| `functions/api_fastapi.py` | Endpoint implementation (`labor_report_worklog`) |
| `tests/test_labor_report.py` | 20 acceptance tests |

Deployed on **May 13, 2026** — Cloud Run revision `cs-scheduler-io-v2-00137-tws`.
