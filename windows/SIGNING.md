# Signing Ankhwiz releases

Two keys sign a release: Ankhwiz's Android release key, which must stay the
same for every Android update, and, once it is set up, a Windows code signing
certificate from SignPath, which removes the "unknown publisher" warning.
Neither key is ever put in this repository.

## Android

Every Android build from 0.4.1.1 on is signed with Ankhwiz's release key
(`ankhwiz-release.jks`, alias `ankhwiz`). Android installs an update only when
it is signed with the same key as the app already on the phone, so:

- Keep `ankhwiz-release.jks` and its password private, and back both up in
  more than one place. If the key is lost, nobody can update the app; everyone
  would have to uninstall and reinstall.
- 0.4.1.1 is the one exception: it is the first build with the release key, so
  it cannot install over 0.4.0 or earlier, which were signed with a test key.
  Back up your library (Settings › Your library › Back up all), uninstall the
  old app, install 0.4.1.1, and restore the backup.

For the GitHub workflow, add these repository secrets (Settings › Secrets and
variables › Actions › New repository secret):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the contents of `ankhwiz-release.jks.base64.txt` |
| `ANDROID_KEYSTORE_PASS` | the password |
| `ANDROID_KEY_ALIAS` | `ankhwiz` |

A tagged build stops with an error if the key is missing, rather than
publishing an APK signed with a throwaway key.

To build locally:

```sh
ANKHWIZ_KEYSTORE=/path/to/ankhwiz-release.jks ANKHWIZ_KEYSTORE_PASS=… ANKHWIZ_KEY_ALIAS=ankhwiz scripts/build-android.sh
```

## Windows, through SignPath

[SignPath Foundation](https://signpath.org) signs open-source projects for
free. Its certificate is issued to the foundation, and the program is signed
only from builds made on GitHub's own machines from this repository's source.

1. Apply at <https://signpath.org/apply>, giving this repository. SignPath
   checks the licence (AGPL-3.0), the project's activity, and that the README
   states a code signing policy (see the "Code signing" section of the README).
2. Once accepted, in SignPath create a project with the slug you will put in
   `SIGNPATH_PROJECT_SLUG`, connect it to this repository as a trusted build
   system (GitHub.com), and add two artifact configurations:

   **`program`**: Ankhwiz.exe, before the installer is built

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Ankhwiz.exe">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   **`installer`**: the installer, once built around the signed program

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Ankhwiz-*-windows-setup.exe">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

3. In this repository, add the secret `SIGNPATH_API_TOKEN` (a CI user's API
   token from SignPath), and the variables (Settings › Secrets and variables ›
   Actions › Variables) `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`
   and `SIGNPATH_POLICY_SLUG` (usually `release-signing`).

From then on, a tagged build waits for each signing request to be approved in
SignPath and publishes the signed files. Until then, the Windows files are
published unsigned, and Windows shows its "unknown publisher" warning on first
run.
