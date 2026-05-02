# Changelog

## 1.0.10 (2026-05-02)

### Fixed
- large todo lists: glasses display went blank with "Loading..." stuck because the list-item label cap is 64 BYTES (UTF-8), not 64 chars. Multi-byte glyphs (em-dash, ellipsis, smart quotes, bullets) silently broke the render. Labels are now sanitized to ASCII equivalents and hard-truncated by byte length across every list (favourites, rooms, todo lists, todo actions, confirm screen, submenus).
- Todo list "Loading..." was unrecoverable on slow HA: ring lock held during the fetch, double-tap ignored, list rendered after navigation. Fetches now run in the background, double-tap exits cleanly mid-load, and stale fetch results are dropped if the user navigated away.
- Cover Open/Close was offered for position-only blinds even when the device didn't expose those services. Cover, fan, and climate submenus now reflect the entity's actual `supported_features` and attribute ranges (`min_temp`/`max_temp`/`target_temp_step`).
- Empty list got cached forever when the 30 s timeout fired before HA responded; the cache no longer stores timeout results.
- Phone browser CORS: REST `todo/get_items` is now skipped when the phone is cross-origin to HA, going straight to the WebSocket path.

### Added
- Lock domain support: locks now appear in the phone "Add" list and on the glasses, default to confirm-on-action.
- New helper-entity domains: `input_button`, `input_select` (option picker), `input_number` (preset slider), `counter` (increment/decrement/reset), `timer` (start/pause/cancel/finish), and bare `button`.
- Per-entity confirm mode: each favourite and room entity can be set to **Auto** (domain default), **Always confirm**, or **Never confirm** via a pill on the phone UI.
- Light effects (WLED, MagicLight, etc.): if the entity exposes `effect_list`, every effect is selectable from the submenu; "Solid"/"None" pinned to the top.
- Climate: `preset_mode` and `swing_mode` pickers, plus target/fan/preset/swing live readouts in the side info panel.
- Fan: oscillate on/off and `preset_mode` picker.
- Room search: search box on the Rooms tab filters entities across all rooms; non-matching rooms are hidden.

### Changed
- Room view + home Recent strip now show plain entity names (no `> 100% / on / off` suffix). Favourites still show state details.
- Recent on home is treated as a list of entities, not last actions: clicking opens the entity's submenu instead of replaying the previous service call.
- Stateful entities (light, switch, fan, lock, input_boolean) always open a submenu so the user picks the action explicitly. The "Confirm: Never" override only skips the post-pick confirm, not the picker.
- Stateless entities (scene, button, input_button) keep one-tap instant fire — they have no state to disambiguate.
- Climate temperature presets use the entity's reported range and step instead of a hard-coded 16–28 °C.
- Phone Rooms tab: only the entities you've selected show by default per room; type in the search box to reveal unselected ones with an "+" button.

### Developer
- Extracted `fireServiceWithFeedback` helper — three near-identical copies of the loading→call→result flow are now one path with offline fast-fail.
- Hoisted `TextEncoder` to a static field; was constructed per list-label render call.
- Cache invalidation on todo toggle/delete so the next list view shows fresh data.
- Config schema bumped to v3 with a `confirmModes` migration.

## 1.0.9 (2026-04-22)

### Added
- Rooms tab: new top "Rooms" card with drag-to-reorder, per-room enable/disable toggle, and Custom/Recent sort mode. Disabled rooms are hidden from the glasses entirely.
- `disabledRooms` config field.

### Changed
- Favourites: removed the 8-item cap. Users can add as many as they like.
- Action flow: confirm screen now swaps to a "Sending..." loading screen during the HA call, with the ring kept responsive. Users can double-click to back out during a slow call.
- Result toast duration reduced from 2000ms to 800ms (snappier feedback on scenes, brightness, colour, cover position, climate, etc.).

### Fixed
- Drag-to-reorder on touch devices (phones): `touchmove` was passive, so mobile browsers ate the gesture as page-scroll. Reorder now works on iOS and Android for favourites, rooms, and per-room entities.
- Bluetooth reconnect: after the phone walked out of BT range and returned, the glasses plugin appeared frozen because `rebuildPageContainer` was called against containers the glasses had dropped. Now forces a full `createStartUpPageContainer` rebuild on reconnect.

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
