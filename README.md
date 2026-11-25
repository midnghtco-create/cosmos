# Cutroom: personal video review on Google Drive

Cutroom is a video review app like Wipster, for your own projects. It is a static web app with no backend:

- **Videos stay in Google Drive.** Each project is a Drive folder. The player streams the file straight from Drive to your browser. A service worker (`sw.js`) adds your sign-in token and supports seeking, so the app never has to download the whole file first.
- **Notes are saved to one file in your Drive** (`cutroom-data.json`). That file holds your comments, drawings, version stacks and approval statuses.
- **The only hosting is these 4 static files.** You can run them on localhost or put them on free static hosting such as GitHub Pages or Netlify.

## Features

- Notes pinned to a timecode (HH:MM:SS:FF), with markers on the scrub bar
- Pen, arrow and box drawings on the frame, saved with each note
- Replies, resolve/reopen, and Open / Resolved / All tabs
- **Version stacks** (v1, v2, v3…). Notes stay with the version they were made on.
- Status per video: In review, Needs changes or Approved
- Frame stepping, 0.25×–2× speed, loop, per-video frame rate
- Export notes as text, as CSV, or as **DaVinci Resolve markers (.edl)**
- Keyboard shortcuts (press `?` on a review page)
- A **local files** mode you can try without any Google setup

## Run it

```bash
cd path/to/this/folder
python3 -m http.server 8080
```

Then open <http://localhost:8080>. It has to be served over http. Opening `index.html` as a file won't work, because neither Google sign-in nor the service worker runs on `file://`.

## Connect Google Drive (one time, free)

1. Open [Google Cloud console](https://console.cloud.google.com/projectcreate) and create a project.
2. Enable the **Google Drive API**.
3. Go to **Google Auth Platform → Audience**. Choose **External**, leave it in **Testing**, and add your Google account as a **test user**.
4. Under **Clients**, create a **Web application** client. In **Authorized JavaScript origins**, add every address you'll open the app from, for example `http://localhost:8080` and later `https://yourname.github.io`.
5. Paste the client ID into Cutroom and click **Connect Google Drive**.

Google will warn that the app "hasn't been verified". That's expected for a personal app in Testing mode. Click *Continue*.

Permissions requested:

- `drive.readonly`: lists your folders and streams your videos. The app never changes or deletes them.
- `drive.file`: lets the app create and update its own notes file, and nothing else.

## Proxies: smooth playback for big or unplayable files

Large camera files and editing formats (ProRes, DNxHR, some HEVC) stream slowly or won't play in a browser. Cutroom can make a light **H.264 proxy** of each video for review.

Proxy details:

- Max 1080p (or 720p).
- A keyframe every second, so seeking and frame stepping are instant.
- "Faststart", so playback begins right away.
- The original frame timing is kept, so note timecodes line up exactly.

Proxies are saved in a **`Cutroom proxies`** folder inside the project's Drive folder. Cutroom plays the proxy automatically, and the **Proxy / Original** switch in the player swaps between them. Notes always belong to the original.

The conversion runs on your computer through a small helper. It uses only the Python standard library plus ffmpeg, and uses Apple's hardware encoder when available.

```bash
brew install ffmpeg            # once
cd ~/Downloads && curl -fsSLO https://midnghtco-create.github.io/cosmos/proxy-helper.py
python3 proxy-helper.py        # leave this window open
```

Then, in a project, click **Make proxies**. For a single version, use **⋯ → Make a proxy for this version** in the review page.

The helper:

- only listens on `127.0.0.1`
- only accepts requests from the Cutroom site
- keeps your Google sign-in in memory only
- deletes its temporary files after each video

If Chrome asks whether the site may access devices on your local network, click **Allow**. That's how the page reaches the helper.

## Notes

- **Formats:** browsers play H.264/AAC MP4 and WebM. For ProRes, DNxHR or HEVC `.mov` files, make proxies (see above).
- **New versions:** upload the new cut to the same Drive folder. In the review page, click **New version** and pick it.
- **Sign-in lasts about 1 hour** (Google's limit for browser apps). After that, Google may show a quick re-sign-in popup.
- **Local mode** keeps notes in this browser only. Use **Settings → Download backup** to keep a copy.
- **Resolve markers** assume the timeline starts at `01:00:00:00` (Resolve's default).
