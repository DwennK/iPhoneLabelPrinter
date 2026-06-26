# macOS arm64 bundled tools

This directory contains the macOS arm64 `libimobiledevice` command-line tools
used by iPhoneLabelPrinter when scanning USB-connected iPhones and iPads.

The executables and dynamic libraries were copied from Homebrew bottles and
rewritten with `install_name_tool` so their non-system dependencies load from
this directory via `@loader_path`.

## Included executables

- `idevice_id`
- `ideviceinfo`
- `idevicediagnostics`

## Included libraries

- `libimobiledevice-1.0.6.dylib`
- `libimobiledevice-glue-1.0.0.dylib`
- `libplist-2.0.4.dylib`
- `libusbmuxd-2.0.7.dylib`
- `libssl.3.dylib`
- `libcrypto.3.dylib`

## Component sources and licenses

- libimobiledevice 1.4.0, LGPL-2.1-or-later
  <https://github.com/libimobiledevice/libimobiledevice>
- libimobiledevice-glue 1.3.2, LGPL-2.1-or-later
  <https://github.com/libimobiledevice/libimobiledevice-glue>
- libplist 2.7.0, LGPL-2.1-or-later
  <https://github.com/libimobiledevice/libplist>
- libusbmuxd 2.1.1, GPL-2.0-or-later and LGPL-2.1-or-later
  <https://github.com/libimobiledevice/libusbmuxd>
- OpenSSL 3.6.2, Apache-2.0
  <https://github.com/openssl/openssl>

License texts are stored under `licenses/`.
