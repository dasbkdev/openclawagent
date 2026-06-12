# Metricon API handoff

Metricon is the official product name. Older internal code may still contain
`kickidler` identifiers for backward compatibility, but user-facing docs,
setup, and new API aliases should use `Metricon`.

## Swagger

Swagger UI:

```text
http://85.239.49.208:8080/swagger-ui/index.html
```

OpenAPI JSON:

```text
http://85.239.49.208:8080/v3/api-docs
```

Checked on 2026-06-03:

- Swagger UI returned HTTP 200.
- OpenAPI JSON returned HTTP 200.
- API title in the spec: `Kickidler API`.
- API version: `1.0`.
- Server URL: `http://85.239.49.208:8080`.
- Security: bearer auth.
- Path count: 106.

## Important Endpoint Groups

- Auth and Agent Auth.
- Auth Session and Session.
- Employees, Users, Departments, Companies.
- Devices and Employee Assignment.
- Activity and Report - Activity.
- Report - Efficiency.
- Report - Rating.
- Report - Export.
- Work Hours and attendance reports.
- Screenshots and Screenshot Agent.
- Calendar entries and schedules.
- Categorization for apps and websites.

## High-Value Paths For The Agent

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/agent/login
POST /api/v1/activity/batch
POST /api/v1/reports/activity
POST /api/v1/reports/efficiency
POST /api/v1/reports/efficiency/summary
POST /api/v1/reports/rating
POST /api/v1/reports/work-time
POST /api/v1/reports/timeline
POST /api/v1/reports/attendance
GET  /api/v1/employees/{id}/report
GET  /api/v1/employees/company/{companyId}
GET  /api/v1/employees/company/{companyId}/report-options
GET  /api/v1/screenshots/employee/{employeeId}/latest
GET  /api/v1/screenshots/employee/{employeeId}/nearest
GET  /api/v1/screenshots/session/{sessionId}/timeline
```

## Control Plane Compatibility

The control plane now accepts Metricon env names:

```text
METRICON_BASE_URL=http://metriconapp.com
METRICON_ACCESS_TOKEN=<saved through setup wizard>
METRICON_REFRESH_TOKEN=<saved through setup wizard, preferred>
```

Legacy names are still accepted:

```text
KICKIDLER_BASE_URL=
KICKIDLER_ACCESS_TOKEN=
KICKIDLER_REFRESH_TOKEN=
```

Metricon frontend at `http://metriconapp.com/` uses relative API prefix
`/api/v1/`, so `METRICON_BASE_URL=http://metriconapp.com` is also valid. Access
tokens expire quickly; the connector refreshes them through
`POST /api/v1/auth/refresh` when a refresh token is configured.

The new preferred report endpoint alias is:

```text
POST /api/v1/reports/metricon/activity-summary
```

The old endpoint remains available for compatibility:

```text
POST /api/v1/reports/kickidler/activity-summary
```

## Next Integration Step

Replace the current placeholder HTTP connector call with real Metricon report
requests from the OpenAPI spec. Keep all Metricon operations read-only unless
the user explicitly approves write actions.
