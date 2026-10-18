# Changelog

Notable, user-facing changes per release. Format follows [Keep a Changelog](https://keepachangelog.com);
versions follow the tags in this repository (`vX.Y.Z` → the release bundle BackIssue's plugin catalog installs).

Contributors: please **don't** edit this file in pull requests — entries are added
by the maintainers when changes merge, so concurrent PRs don't conflict here.

## [Unreleased]

## [1.1.0] — 2026-10-17

### Added

- **Translated UI.** The migration overlay follows the language picked under
  Profile → Language on BackIssue 0.9.1 and newer, English on older ones.
  Translations ship for French, German, Spanish, Italian, Portuguese (Portugal
  and Brazil), Dutch, Polish, Japanese and Simplified Chinese in `locales/`.
  Also covers the permission, job and library-type labels, the plugin
  description and the notification titles shown in BackIssue’s own screens.

## [1.0.1] — 2026-07-18

### Fixed
- The overlay close button now brightens correctly on hover (it was using a
  background token as a text color).

## [1.0.0] — 2026-07-18

Initial release: import an existing Mylar3 or Kapowarr collection. Upload the
source database (or point at a server path), preview the parsed series with
already-present ones marked, pick a target library, and import with live
progress — exact ComicVine matching, monitored state carried over, no automatic
downloads, safe to re-run.
