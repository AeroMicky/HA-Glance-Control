# Changelog

## 1.0.8 (2026-04-21)

### Added
- Automation domain support — automations can now be added to rooms and favourites, and triggered from the glasses or phone like scenes and scripts. Action label is "Trigger", service is `automation.trigger`.

### Changed
- Glasses confirm screen reordered: the action now defaults at the top (one click to fire), Cancel sits in the middle, the Favourite toggle moved to the bottom. Keeps the two main branches (do / don't) adjacent and pushes the rare favourite-toggle to the end.
- Todo delete confirm swapped to `Delete, Cancel` so Delete is the default highlight.
- Automation domain icon on the phone app is the robot glyph.

### Fixed
- Favourites tab now respects the configured sort (status / name / recent / custom) instead of showing raw config insertion order. Previously the home startpage column was sorted but the dedicated Favourites tab was not, so the two lists could disagree.
- Selecting an entity from the sorted Favourites list now fires the correct entity (previously the handler indexed into the unsorted array).

## 1.0.7 (2026-04-21)

### Added
- Home tab on phone UI — status pill (Active / Reconnecting / Connection error / Needs setup / Disconnected), HA host and inventory overview (sensors, favourites, rooms, lists, clock mode), Get Started / Open Settings CTAs
- `HAClient.isConnected()` helper
- Optional per-call timeout on `HAClient.callService` (default 5s)

### Changed
- Home is now the default landing tab instead of Connection
- Disconnect callback fires on every disconnect (previously skipped deliberate ones) so the HUD `[!]` indicator is consistent
- HA command failures reject the promise with a real error message instead of resolving `null` — pending commands on disconnect now reject with "HA connection lost before response"

### Developer
- BroadcastChannel (`ha-plugin-control`) between simulator and phone browser for cross-context prototype testing (no production effect)

## 1.0.6 (2026-04-13)

### Security
- Fix XSS vulnerability in connection error display

### Added
- Disconnect indicator (`[!]`) on glasses header when HA connection drops
- Config schema versioning for deterministic migration
- Unit test suite (31 tests) covering submenus, toggle logic, URL derivation, todo parsing
- Quality gate: `npm run pack` now runs tests + type check before building

### Changed
- Auto-standby defaults to 60 seconds for new installs (was disabled)
- Build script outputs `ha-{version}.ehpk` naming convention

### Fixed
- UI freeze when controlling slow devices (garage doors, covers, blinds) — added 10s timeout to all HA commands
- Pending commands now rejected on WebSocket disconnect instead of hanging forever
- Replace unsupported unicode symbols with plain text on confirm/result screens
- 4 TypeScript strict mode errors (nullable content, unreachable comparison, undefined dashboard access)

### Removed
- Unused `@jappyjan/even-better-sdk` dependency
- `@playwright/test` from production dependencies
- Stale `.ehpk` build artifacts

## 1.0.5 (2026-04-12)

### Added
- Todo list support (view, add, edit, complete, delete items)
- Entity attributes in status panel
- Date/time display in glasses header

## 1.0.3 (2026-04-11)

### Fixed
- Scenes appearing incorrectly in recently used list
- Config export failing on Android

## 1.0.0 (2026-04-10)

### Added
- Initial release — HA Glance & Control
- Favourites with quick toggle
- Room-based entity browsing
- Light, fan, cover, climate, lock, scene, script control
- Header/footer sensor display with pagination and scrolling
- Custom entity names and icons
- Nabu Casa cloud and local HA support
- Auto-reconnect with exponential backoff
- Standby mode (manual + auto timer)
- Config import/export
