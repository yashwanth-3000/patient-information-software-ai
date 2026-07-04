# ClinicClick PIS Integration

ClinicClick adds a simple cloud-import workflow to the existing Windows Patient
Information System without running another API or command window inside the VM.

## What we are building

```text
ClinicClick web app
        ↓ approved jobs
Vultr demo API (Mumbai, plain HTTP for legacy Windows 7)
        ↓ HTTP when the user clicks Get New Data
Patched Windows PIS
        ↓ one Access transaction per job
Homeopathy.mdb
```

The patched application adds a third tab named **Get New Data from App**. Its
button downloads approved jobs, validates them, backs up the Access database,
imports patients and prescriptions in transactions, acknowledges completed
jobs, prevents duplicate imports, and refreshes the existing patient table.

No background service runs inside Windows. The original `PIS-x86.exe` remains
available as a fallback.

## Repository layout

- `pis-plugin/`: .NET plugin and Mono.Cecil patcher for the legacy WinForms PIS.
- `vultr-api/`: dependency-free Node.js demo queue deployed on a Vultr instance.
- `website/`: ClinicClick product website.

## Live demo API

Runs on a Vultr instance (Mumbai) as a systemd service, served over plain HTTP
because the Windows 7 legacy .NET stack cannot negotiate TLS 1.2.

- Health: <http://65.20.78.208/health>
- Pending demo jobs: <http://65.20.78.208/api/pis/pending?clinic_id=clinic-demo>

Only synthetic `APPDEMO` patient data is served by this demo. Do not put real
patient data on this server: the demo endpoint is unencrypted HTTP.

## Build the patched PIS

Install Mono, then run:

```bash
./pis-plugin/build.sh /path/to/PIS-x86.exe
```

The generated files appear in `pis-plugin/bin/`:

- `PIS-ClinicClick.exe`
- `PIS-ClinicClick.exe.config`
- `ClinicClick.PisPlugin.dll`

Place all three beside `Homeopathy.mdb`, close the original PIS, and launch
`PIS-ClinicClick.exe`. The generated config intentionally does not request
.NET 4, so it can launch with the same legacy CLR used by the original PIS.

## Verify

```bash
node --test vultr-api/server.test.js
```

For the Windows demo, open **Get New Data from App**, click **Get New Data**, and
verify that two `APPDEMO` patients appear. Clicking again must not duplicate
them.

## Safety boundaries

- The demo imports only approved jobs and rejects non-`APPDEMO` patients.
- Demo prescription text must begin with `DEMO`.
- SQL values use OLE DB parameters.
- Patient and prescription inserts share one serializable transaction.
- A local `ClinicClickImport` table makes job processing idempotent.
- The first import creates a timestamped database backup.
- Real patient data must not be added to the demo service.
