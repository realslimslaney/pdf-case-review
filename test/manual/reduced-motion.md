# Manual pass: OS reduced motion

Run before each stable cut and whenever the go-to flash, autosave indicator, or any
transition changes. Verifies the extension honors the operating system's reduced motion
preference end to end.

## Setup

1. Turn on reduced motion at the OS level:
   - Windows: Settings, Accessibility, Visual effects, Animation effects off.
   - macOS: System Settings, Accessibility, Display, Reduce motion.
   - Linux: depends on desktop; GNOME: Settings, Accessibility, Reduced animation.
2. F5 to launch the Extension Development Host on `test/fixtures` (restart it if it was
   already open when you changed the OS setting).
3. Open `generated/case.pdf`.

## Pass

1. Click a Highlights tree item to go to a highlight. The target must still be clearly
   indicated (static emphasis is fine) but must not pulse, animate, or scroll smoothly
   past intermediate pages.
2. Edit a note and watch the autosave indicator: state changes should appear without
   animation.
3. Zoom and page navigation should jump, not glide.
4. Turn the OS setting back off, reload the window, and confirm the animated variants
   return (proves the preference is actually being read, not hardcoded off).

## Record

Append a row per run:

| Date | Machine | OS | Flash static | Autosave static | Motion returns when off | Notes |
|---|---|---|---|---|---|---|
