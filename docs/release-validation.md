# Release Validation

Run this checklist before publishing a draft GitHub Release. The CI workflow can
prove that the app builds and packages, but it cannot validate USB trust prompts,
printer drivers, or the physical thermal media.

## GitHub Release Setup

One-time setup:

- Add GitHub secret `TAURI_SIGNING_PRIVATE_KEY` with the contents of
  `/Users/dwenn/.tauri/iphone-label-printer-updater.key`.
- Add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the updater key is generated
  with a password. The current local key is passwordless.
- Keep `/Users/dwenn/.tauri/iphone-label-printer-updater.key` backed up outside
  the repository. Losing it prevents future in-app updates for installed builds.

Useful command:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < /Users/dwenn/.tauri/iphone-label-printer-updater.key
```

Release steps:

```bash
npm version patch --no-git-tag-version
node -e "let fs=require('fs');let p='src-tauri/tauri.conf.json';let j=require('./'+p);j.version=require('./package.json').version;fs.writeFileSync(p, JSON.stringify(j, null, 2)+'\n')"
git add package.json package-lock.json src-tauri/tauri.conf.json
git commit -m "Release x.y.z" -m "Bump the Tauri app version for a signed desktop release."
git tag vx.y.z
git push origin HEAD
git push origin vx.y.z
```

The workflow creates a draft GitHub Release with macOS, Windows, Linux, updater
signatures, and `latest.json`. Publish the draft only after hardware validation.

## Windows Shop Machine

- Install from the draft release asset.
- Confirm `assets/bin/win32` tools are bundled by scanning a connected iPhone or
  iPad without installing system `libimobiledevice`.
- Connect a trusted and unlocked device.
- Scan device and confirm model, serial, IMEI, storage, color, iOS version,
  battery health, and battery cycle count where available.
- Edit a missing field and generate a label.
- Open the generated PDF from the app.
- Select the thermal printer and print a normal label.
- Print a calibration label and confirm the driver media size is correct.
- Close and reopen the app; confirm history remains available.
- After publishing a newer release, click `Check Updates` and confirm the app
  installs the update or exits into the Windows updater flow.

## macOS Apple Silicon Shop Machine

- Install the DMG from the draft release asset.
- Confirm `assets/bin/macos-arm64` tools are bundled by scanning a connected
  iPhone or iPad without installing Homebrew `libimobiledevice`.
- Connect a trusted and unlocked device.
- Scan device and confirm model, serial, IMEI, storage, color, iOS version,
  battery health, and battery cycle count where available.
- Generate and open a label PDF.
- Select the thermal printer and print a normal label through CUPS.
- Print a calibration label and confirm the media size and orientation.
- Close and reopen the app; confirm history remains available in the app data
  folder.
- After publishing a newer release, click `Check Updates` and confirm the app
  downloads, installs, and relaunches.

## Regression Notes

- Linux packaging is built by CI as best effort.
- The app is unsigned unless platform signing secrets are added separately.
- GitHub draft releases are not visible to the in-app updater; publish the
  release only after Windows/macOS validation passes.
