# Setting up Google Drive sync

GEnius syncs through one file in your own Google Drive. Google requires every
app that signs in with Google to be registered in a Google Cloud project, so this
is a one-time setup (about 10 minutes, free). After it, GEnius only ever sees the
one sync file it creates (`GEnius sync.json`), never the rest of your Drive.

## 1. Create the project
1. Go to https://console.cloud.google.com and sign in with the Google account
   whose Drive you want to use.
2. Top bar: project picker → **New project** → name it `GEnius` → **Create**.
   Make sure `GEnius` is selected in the project picker afterwards.

## 2. Turn on the Drive API
1. Menu → **APIs & Services** → **Library**.
2. Search **Google Drive API** → open it → **Enable**.

## 3. Set up the sign-in screen
1. Menu → **APIs & Services** → **OAuth consent screen** (it may be called
   **Google Auth Platform**) → **Get started**.
2. App name: `GEnius`. User support email: your email. → Next.
3. Audience: **External** → Next.
4. Contact email: your email → Next → agree → **Create**.
5. **Data access** (or **Scopes**) → **Add or remove scopes** → tick
   `.../auth/drive.file` and `.../auth/userinfo.email` → **Update** → **Save**.
6. **Audience** → **Publish app** → confirm. (Leaving it in "Testing" makes
   Google sign you out every 7 days. These two permissions are the basic kind,
   so publishing doesn't need Google's review.)

## 4. Make the desktop key
1. **Clients** (or **Credentials**) → **Create client** (or **Create credentials
   → OAuth client ID**).
2. Application type: **Desktop app**. Name: `GEnius desktop` → **Create**.
3. **Download JSON** (the download icon next to the new client).
4. Rename the file to `google-oauth.json` and put it in
   `%APPDATA%\GEnius\` (paste that into the File Explorer address bar).

## 5. Connect
1. Restart GEnius.
2. **Settings → Google Drive sync → Connect Google Drive**.
3. Your browser opens Google's sign-in. Pick your account and allow access.
   If Google shows "Google hasn't verified this app", that's expected for a
   new project: **Advanced → Go to GEnius**. It's your own project.
4. Back in GEnius it says **Connected as you@gmail.com**. Press **Sync now**.

The file `GEnius sync.json` appears in your Drive. Don't edit it by hand.

## Later: the phone
The phone needs its own key from the same project (an **Android** client, with
the app's package name `com.vonderthwood.genius` and the SHA-1 fingerprint of
the signing key). That comes with the phone release.
