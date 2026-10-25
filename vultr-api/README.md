# Vultr demo API

Dependency-free Node.js queue that serves approved synthetic demo jobs to the
patched Windows PIS.

## Endpoints

- `GET /health` — service check.
- `GET /api/pis/pending?clinic_id=clinic-demo` — approved jobs not yet imported.
- `POST /api/pis/jobs/<id>/ack` — mark a job imported.
- `GET /api/patients/<regno>` — live patient lookup. Long-polls up to 25 s while
  the running PIS answers from the local Access database. Returns 404 if the
  patient does not exist and 504 if PIS is not running.
- `GET /api/pis/queries?clinic_id=clinic-demo` — polled by the PIS plugin for
  pending patient lookups.
- `POST /api/pis/queries/<id>/result` — the PIS plugin posts lookup answers.
- `POST /api/demo/reset` — admin-only; restores all demo jobs.
- `POST /api/demo/inspect` — admin-only; shows imported and pending job IDs.

Admin endpoints require the `x-admin-key` header matching the `ADMIN_KEY`
environment variable.

## Deployment

### Railway

The patient lookup relay is deployed in the `clinicclick-pis-demo` project,
production environment, `api` service:

`https://api-production-2579.up.railway.app`

Deploy this directory as the service root with `railway up . --path-as-root`.
Railway sets `PORT`; the server listens on all interfaces and exposes `/health`.
Patient history is available at `GET /api/patients/<regno>` when the PIS plugin
polls the same service. The response contains patient details and the full
dated prescription list from PIS. A 504 means the PIS plugin did not answer.

Railway redirects HTTP to HTTPS. The legacy Windows runtime must support
Railway's TLS connection before changing `ClinicClickApiUrl` to this URL.
The current plugin configuration still points to the old Vultr address below.

### Previous Vultr deployment

The API runs on a Vultr instance (Mumbai) as the `clinicclick` systemd service,
listening on port 80 over plain HTTP because the legacy Windows 7 .NET stack
cannot negotiate TLS 1.2.

To update the server:

```bash
scp -i ~/.ssh/clinicclick_vultr vultr-api/server.js root@65.20.78.208:/opt/clinicclick-server.js
ssh -i ~/.ssh/clinicclick_vultr root@65.20.78.208 'systemctl restart clinicclick'
```

## Test

```bash
node --test vultr-api/server.test.js
```

Only synthetic `APPDEMO` data may be served. Never add real patient data.
