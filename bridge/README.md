# ClinicClick PIS Database Bridge

This Windows-local service writes approved jobs directly to the database used by
PIS. Reverse engineering confirmed that PIS opens `Homeopathy.mdb` beside the
executable with `Microsoft.Jet.OLEDB.4.0` and lets Access generate `RegNo` and
prescription `PID` values.

The bridge:

- listens only on `127.0.0.1`;
- requires a bearer token;
- accepts only `status: approved` jobs;
- uses parameterized SQL and one serializable transaction;
- records job IDs in `ClinicClickJob` to prevent duplicate execution;
- creates a database backup before installing its idempotency table;
- defaults to demo-only patients containing `TEST` or `DEMO`;
- writes audit metadata without patient names or prescription text.

## Test installation on Windows

Open the UTM shared `ClinicClickBridge` directory from Windows. It contains a
local `test-data\Homeopathy-source.mdb` snapshot; the installer creates another
working copy before adding the bridge table. Then open Command Prompt in the
bridge directory:

```bat
build.cmd
set PIS_BRIDGE_TOKEN=replace-with-a-random-32-character-secret
install-test-copy.cmd
run-test-bridge.cmd
```

In a second PowerShell window:

```powershell
$env:PIS_BRIDGE_TOKEN="replace-with-the-same-secret"
.\send-demo-job.ps1
```

The response includes the generated `reg_no`. Open the copied database with a
copied PIS installation to verify the patient and demo prescription.

## API contract

`POST /v1/jobs/apply`

```http
Authorization: Bearer <local bridge token>
Content-Type: application/json
```

A job can either create a patient using `patient`, or add prescriptions to a
known patient using `existing_reg_no`. Never use name-based matching because
names are not unique.

Production mode requires the explicit `--allow-production` flag. Do not use it
until the test database has been verified and the cloud side issues signed,
approved, idempotent jobs through an outbound-polling Windows agent. Never
expose port 8765 directly to the internet.
