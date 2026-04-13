# Changelog

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
