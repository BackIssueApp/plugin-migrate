# Migration Assistant

Import an existing collection from **Mylar3** or **Kapowarr** into BackIssue.
Both apps store ComicVine volume ids in their databases, so every series maps
**exactly** — no fuzzy matching, no wrong-volume surprises.

## Install

One click from **Sidebar → Plugins** in BackIssue, or drop this folder into the
app's `plugins/` directory and restart.

## Use

Admins get a **Migrate** entry in the sidebar's System area:

1. **Pick the source database** — upload `mylar.db` (Mylar3) or `Kapowarr.db`
   (Kapowarr), or point at a path the server can read (e.g. a folder mounted
   into the container). Upload a copy, or stop the other app first.
2. **Preview** — the parsed series list, with anything already in your library
   marked (and deselected). Optionally pick a target library.
3. **Import** — each series is added through the normal ComicVine path with
   live progress. Monitored/paused state carries over. Nothing is downloaded
   automatically.

Afterwards run **System → Tools → Scan entire library** so your files on disk
attach to the imported series.

Re-running is safe: already-imported series are skipped. If the import halts on
a ComicVine rate limit, just run it again later.
