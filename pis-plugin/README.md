# PIS plugin

The original PIS source is unavailable, so `PatchPis.cs` uses Mono.Cecil to add
one call to `ClinicClick.PisPlugin.Plugin.Install()` immediately after the
legacy form initializes. The original executable is used only as build input
and is never committed or overwritten.

If the original `.exe.config` exists, the build preserves its local settings
and adds only the ClinicClick API URL. Legacy credentials are therefore never
stored in this repository.

The plugin adds the cloud-import tab and writes approved jobs directly through
the same `Microsoft.Jet.OLEDB.4.0` provider used by PIS.

Build:

```bash
./build.sh /path/to/PIS-x86.exe
```

Windows requires the 32-bit Jet provider already used by PIS. Keep the plugin
DLL and generated config beside `PIS-ClinicClick.exe`.

## Railway connection

The plugin now defaults to `https://api-production-2579.up.railway.app`.
On Windows it uses WinHTTP 5.1 with TLS 1.2 for HTTPS, so the existing
.NET 2.0 PIS executable can remain unchanged. Certificate validation stays
enabled. Windows 7 must have TLS 1.2 support and valid root certificates.
If either is missing, the system status dialog reports the HTTPS failure.

After building, close PIS and copy these three files from `bin/` into the
Windows PIS folder, beside its existing `Homeopathy.mdb`:

- `PIS-ClinicClick.exe`
- `ClinicClick.PisPlugin.dll`
- `PIS-ClinicClick.exe.config`

Restart `PIS-ClinicClick.exe`, open the system status dialog, and refresh.
The server address should show Railway and live sync should show connected.
Then `GET https://api-production-2579.up.railway.app/api/patients/<regno>`
returns the patient details and all dated prescriptions read from that PIS.
