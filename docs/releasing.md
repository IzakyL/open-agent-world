# Publishing desktop releases

The **Desktop release** workflow builds Windows x64, macOS Apple Silicon and macOS Intel from the same commit. macOS packaging was integrated from `codex/macos-desktop-preview`; a separate branch is no longer needed for these builds.

## First release

1. Commit the packaging/workflow/docs changes and merge them into `main` so the download instructions appear on the repository homepage and the manual workflow is discoverable.
2. In **Actions → Desktop release → Run workflow**, select the release branch. This builds all three installers and uploads Actions artifacts without creating a Release.
3. Download the artifacts and test installation, first launch, model configuration and upgrade on the corresponding operating systems. Payload self-tests do not replace installing the app on a clean machine.
4. Ensure the version agrees in `desktop/package.json`, `desktop/package-lock.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` and the application entry in `desktop/src-tauri/Cargo.lock`. Update `docs/release-notes.md` with the changes for this version.
5. Tag that commit, for example `git tag v0.1.0`, then `git push origin v0.1.0`. The tag must equal `v` plus the desktop version. All three builds must pass before a draft Release is created with installers and individual SHA-256 checksums.
6. Open **Releases**, edit the draft, check assets and notes, and click **Publish release**. Use **Set as a pre-release** for experimental builds. The README links to `/releases`, so preview releases are discoverable too.

The workflow uses GitHub's automatic `GITHUB_TOKEN` with write permission only in the release job; no personal token is needed. Repository/organization policy must allow GitHub Actions and the job's `contents: write` permission. Pushing a tag through a workflow's `GITHUB_TOKEN` does not normally trigger another workflow; push the release tag from your authenticated Git client.

Failed builds keep their logs under Actions. Fix the issue before tagging a new version. Rerunning a tag workflow can replace assets in its existing draft; it refuses to change an already published Release. Never move a published version tag.

## Signing and current limits

Windows builds are unsigned. macOS builds use ad-hoc signing and are not notarized. The current pipeline does not configure certificate import or notarization; add and validate those steps with your signing credentials before promising a warning-free installation. Keep macOS marked as preview until native installation acceptance passes. macOS local Sandbox support is a separate gap.

GitHub Release downloads are the user-facing distribution channel. Actions artifacts are temporary build/test outputs and are not the primary download link. There is no in-app automatic updater yet.
