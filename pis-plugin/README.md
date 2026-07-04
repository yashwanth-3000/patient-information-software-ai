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
