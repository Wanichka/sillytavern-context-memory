# Context Tracker

A tiny always-on-screen badge for SillyTavern that shows the current state of your chat context. Useful if you summarize your roleplays and hide old messages — no more keeping numbers in your head or in a notes file.

## What it shows

- **msg** — id of the last message (same 0-based id SillyTavern uses)
- **in context** — number of visible (non-hidden) messages
- **tokens** — token count of visible messages / max context
- A thin progress bar filling up toward your summary interval, and a small pulsing dot when it's time to summarize

Everything is computed live from the chat (hidden messages are detected by their `is_system` flag), so the numbers stay correct after `/hide` with no manual input.

## Installation

Copy the `context-tracker` folder into `data/<your-user>/extensions/` and reload the page.

## Usage

- Drag the badge anywhere; the position is saved and always clamped inside the screen with a margin (tablet-friendly).
- The badge has no close button by design — toggle it in **Extensions → Context Tracker**.

## Settings (Extensions panel)

- Show/hide the badge
- Show/hide the token counter
- Show/hide the progress bar and "time to summarize" dot
- Summary interval in messages (0 disables the indicator)
- Reset badge position

## Notes

- Colors are taken from SillyTavern theme variables, so the badge matches any theme automatically.
- Messages created with `/sys` also carry the `is_system` flag and are counted as hidden.
