# Bundled Windows binaries

This directory contains third-party executables and libraries shipped with
iPhoneLabelPrinter so the Windows version of the app works without a separate
install. They are loaded at runtime by `utils.resolve_tool()` and the
`_printer_win32` backend.

The application code in this repository does not modify these binaries.

## SumatraPDF.exe

- **Project**: SumatraPDF, <https://www.sumatrapdfreader.org/>
- **Version**: 3.6.1 (portable 64-bit build)
- **Source archive**: <https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip>
- **License**: GNU General Public License, version 3 (GPL-3.0)
- **Role**: silent PDF printing on Windows
  (`SumatraPDF.exe -print-to "<printer>" -silent -print-settings ... file.pdf`).

Full license text: <https://github.com/sumatrapdfreader/sumatrapdf/blob/master/COPYING>.

## libimobiledevice tools

- `idevice_id.exe`
- `ideviceinfo.exe`
- `idevicediagnostics.exe`

Plus their shared library dependencies (the `*.dll` files in this directory).

- **Project**: libimobiledevice, <https://libimobiledevice.org/>
- **Windows build**: jrjr/libimobiledevice-windows
  <https://github.com/jrjr/libimobiledevice-windows>
- **Release**: `v20260524-74585f8`
- **Source archive**: <https://github.com/jrjr/libimobiledevice-windows/releases/download/v20260524-74585f8/libimobile-suite-latest_w64.zip>
- **License**: GNU Lesser General Public License, version 2.1 (LGPL-2.1)
- **Role**: detect connected iPhones and read device metadata over USB.

Full license text: <https://github.com/libimobiledevice/libimobiledevice/blob/master/COPYING>.

The bundled DLLs include OpenSSL, libplist, libusbmuxd, libimobiledevice-glue,
zlib, brotli, iconv, intl, nghttp2/3, libssh2, libpsl, libunistring, libtatsu,
libidn2, and libzstd. Each retains its own upstream license; together they are
the standard runtime dependency set of libimobiledevice on Windows.

## Updating these binaries

To refresh the bundled binaries (for example to support a newer iPhone):

1. Download the latest portable `SumatraPDF-X.Y.Z-64.zip` from
   <https://www.sumatrapdfreader.org/download-free-pdf-viewer> and replace
   `SumatraPDF.exe` here.
2. Download the latest `libimobile-suite-latest_w64.zip` from
   <https://github.com/jrjr/libimobiledevice-windows/releases> and overwrite
   `idevice_id.exe`, `ideviceinfo.exe`, `idevicediagnostics.exe`, and every
   `*.dll` in this directory.
3. Update the version numbers in this NOTICE file.

No code changes are required in the app: `resolve_tool()` finds these files by
name, and the printer backend finds `SumatraPDF.exe` by location.
