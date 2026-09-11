---
name: Nucleus
description: Personal Life OS & High-Velocity Productivity Cockpit
colors:
  primary: "#10b981"
  primary-hover: "#34d399"
  primary-subtle: "rgba(16, 185, 129, 0.15)"
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#ef4444"
  danger-hover: "#dc2626"
  danger-subtle: "rgba(239, 68, 68, 0.15)"
  bg-dark: "#0a0a0a"
  surface-dark: "#141416"
  surface-dark-elevated: "#1c1c1f"
  border-dark: "#262626"
  border-dark-subtle: "#1f1f22"
  text-dark-primary: "#f5f5f5"
  text-dark-secondary: "#a3a3a3"
  text-dark-muted: "#737373"
  bg-light: "#f5f5f5"
  surface-light: "#ffffff"
  border-light: "#e5e5e5"
  text-light-primary: "#0a0a0a"
  text-light-secondary: "#525252"
  text-light-muted: "#737373"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#0a0a0a"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-dark-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.surface-dark}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.bg-dark}"
    textColor: "{colors.text-dark-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  chip-active:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
---

# Design System: Nucleus

## Overview

**Creative North Star: "The Atomic Cockpit"**

Nucleus is an uncompromising personal command center built for extreme velocity, atomic discipline, and total data sovereignty. Designed from the inside out as a dark-first tactical cockpit, the interface eliminates cognitive friction, decorative clutter, and sluggish animations. Every screen renders with zero latency, providing instantaneous access to financial allocations, habit tracking, and deep focus sessions.

The aesthetic philosophy marries Swiss structural minimalism with the focused atmosphere of an aerospace cockpit. The deep obsidian canvas (`#0a0a0a`) acts as the void, illuminated by high-precision emerald telemetry (`#10b981`). Information density is calibrated for high scanability: cards are distinctly framed with razor-thin borders (`#262626`), interactive surfaces compress on physical touch (`scale(0.96)` at 140ms), and state shifts pop smoothly into view without jarring the user's attention.

**Key Characteristics:**
- **Zero-Latency Feel:** Instant optimistic updates and tactile button responses (140ms ease) provide immediate feedback before server confirmation.
- **Dark-First Immersion:** Deep obsidian base (`#0a0a0a`) optimized for OLED displays, extended coding sessions, and distraction-free operation.
- **High-Contrast Telemetry:** Emerald Pulse (`#10b981`) signifies progress, capital growth, and habit completion; warnings and alerts are strictly functional, never decorative.
- **Consistent Rounded-2xl Geometry:** Uniform 16px card containers create structured visual rhythm across desktop and mobile.

## Colors

The palette is engineered for prolonged focus in low-light environments, using an ultra-deep neutral scale punctuated by tactical status signals.

### Primary
- **Emerald Pulse** (#10b981): The energetic heartbeat of the system. Used exclusively for positive feedback, primary call-to-action buttons, completed habits, active navigation links, and capital growth metrics.
- **Emerald Pulse Hover** (#34d399): Hover and focus glow for primary action targets.
- **Emerald Pulse Tint** (rgba(16, 185, 129, 0.15)): Low-intensity ambient fill for active tabs, selected filter pills, and subtle progress indicators.

### Secondary
- **Amber Caution** (#f59e0b): Functional telemetry indicating approaching budget thresholds (80–100%), mid-tier energy scores, or upcoming deadlines.
- **Signal Coral** (#ef4444): Critical alerts, budget overflows (>100%), high-priority task indicators, and destructive confirmation triggers.
- **Signal Coral Hover** (#dc2626): Active hover state for destructive buttons.

### Neutral
- **Obsidian Void** (#0a0a0a): Canonical root background for dark mode.
- **Cockpit Surface** (#141416): Primary card and panel surface background (`dark:bg-neutral-900/50`).
- **Elevated Cockpit** (#1c1c1f): Elevated sheet, dropdown menu, and modal dialog background (`dark:bg-neutral-900`).
- **Cockpit Border** (#262626): Canonical hairline divider and container outline (`dark:border-neutral-800`).
- **Text Bright** (#f5f5f5): Primary typography and high-emphasis data figures (`dark:text-neutral-100`).
- **Text Secondary** (#a3a3a3): Descriptive subtitles, metadata, and inactive icons (`dark:text-neutral-400`).
- **Text Muted** (#737373): Timestamps, currency conversion hints, and disabled labels (`dark:text-neutral-500`).
- **Paper Canvas (Light Mode)** (#f5f5f5): Inverted daytime root background.
- **Paper Surface (Light Mode)** (#ffffff): Inverted daytime card and modal surface.
- **Paper Border (Light Mode)** (#e5e5e5): Inverted daytime hairline border (`border-neutral-200`).

### Named Rules
**The Emerald Signal Rule.** Emerald Pulse is reserved for positive momentum and primary execution. It must never be applied to purely decorative elements, non-interactive badges, or secondary utilities. When Emerald lights up, something has succeeded.

**The Non-Violent Alert Rule.** Uncompleted habits and routine tasks never render in threatening crimson. Neutral grays represent pending potential; red is restricted to critical budget overruns and explicit priority markers.

## Typography

**Display Font:** Inter (with ui-sans-serif, system-ui, sans-serif fallbacks)  
**Body Font:** Inter (with ui-sans-serif, system-ui, sans-serif fallbacks)  
**Monospace / Numeric Font:** Inter / tabular numbers (`font-variant-numeric: tabular-nums`)

**Character:** Technical, crisp, and neutral. Inter provides razor-sharp readability at small dense sizes on high-DPI desktop screens and mobile viewports alike.

### Hierarchy
- **Display** (Bold 700, 1.875rem / 30px, line-height 1.2, letter-spacing -0.02em): Large balance summaries, hero time readouts, and core cockpit numbers.
- **Headline** (Semi-bold 600, 1.25rem / 20px, line-height 1.3, letter-spacing -0.01em): Module titles, modal headers, and primary card headlines.
- **Title** (Semi-bold 600, 1rem / 16px, line-height 1.4): Section groupings, habit titles, and category labels.
- **Body** (Regular 400, 0.875rem / 14px, line-height 1.5): Transaction details, AI assistant conversations, notes, and general text.
- **Label** (Medium 500, 0.75rem / 12px, line-height 1.4, letter-spacing 0.01em): Micro-telemetry, currency hints, table headers, and status chips.

### Named Rules
**The Tabular Precision Rule.** All dynamic financial sums, timers, and crypto counters must render with tabular numbers (`tabular-nums`) to prevent layout jitter during rapid updates.

## Layout

Nucleus employs a hybrid adaptive layout tailored for both high-density desktop ultrawide monitors and single-handed mobile usage.

- **Desktop (md: 768px+):** Fixed left navigation rail (`w-72`) with integrated module switcher (FinLit ↔ Planner), fast category navigation, and profile hub pinned to the bottom. Main content flows inside a bounded `max-w-3xl` scroll container centered on screen with stable scrollbar gutters (`[scrollbar-gutter:stable_both-edges]`).
- **Mobile (< 768px):** Clean top status bar with safe-area insets (`pt-[env(safe-area-inset-top)]`), floating module switcher, and horizontal touch-scrollable bottom navigation bar (`touch-pan-x snap-x`) preserving single-thumb ergonomics.
- **Density & Grid:** Default component gap follows an 8px grid (`gap-2`, `gap-3`, `gap-4`). Cards feature 16px internal padding (`p-4` to `p-6`).

### Named Rules
**The Single-Thumb Reach Rule.** On mobile viewports, high-frequency actions (adding expenses, checking habits, switching modules) must reside within the bottom thumb zone or top-right profile anchor.

## Elevation & Depth

Nucleus avoids heavy blurred drop shadows in favor of tonal layering and physical boundary lines. Depth is structural, not ornamental.

Surfaces sit on a 3-layer dark plane:
1. **Base Plane** (`#0a0a0a`): The canvas beneath all elements.
2. **Card Plane** (`#141416`, `border: 1px solid #262626`): Bounded containers holding functional modules.
3. **Floating Plane** (`#1c1c1f`, `border: 1px solid #262626`, `box-shadow: 0 20px 25px -5px rgba(0,0,0,0.7)`): Modals, dropdown sheets, and the floating assistant widget.

### Shadow Vocabulary
- **Subtle Surface** (`box-shadow: 0 1px 3px rgba(0,0,0,0.5)`): Inset card distinction in light mode or active tab indicator.
- **Tactile Popover** (`box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.6)`): Select dropdowns, datepicker flyouts, and profile popups.
- **Elevated Modal** (`box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.7)`): ConfirmDialog and Settings modal backdrop lift.

### Named Rules
**The Boundary Before Shadow Rule.** Visual separation is achieved first through crisp borders (`border-neutral-800`) and surface tonal contrast (`#0a0a0a` vs `#141416`). Shadows are exclusively used to communicate temporary z-index elevation.

## Shapes

- **Card Containers:** Distinctive `rounded-2xl` (16px) curvature. Cards feel like solid monolithic physical modules.
- **Interactive Controls (Buttons, Inputs, Triggers):** `rounded-lg` (8px) for buttons, text inputs, and select triggers; `rounded-xl` (12px) for segmented module switchers.
- **Badges & Avatars:** `rounded-full` (9999px) for status indicators, avatar discs, and progress rings.
- **Borders:** Consistent 1px continuous strokes (`border border-neutral-200 dark:border-neutral-800`).

### Named Rules
**The 16px Container Doctrine.** All structural modules, panels, and cards must share the canonical `rounded-2xl` (16px) corner radius. Nested interactive elements within cards step down to `rounded-lg` (8px) or `rounded-xl` (12px).

## Components

### Buttons
- **Shape:** `rounded-lg` (8px), padding `px-4 py-2` (text-sm font-medium).
- **Primary:** Background `bg-emerald-500`, text `text-neutral-950` (high-contrast deep black), hover `hover:bg-emerald-400`.
- **Secondary:** Background `transparent`, border `border border-neutral-300 dark:border-neutral-700`, text `text-neutral-900 dark:text-neutral-100`, hover `hover:bg-neutral-100 dark:hover:bg-neutral-800`.
- **Danger:** Background `bg-red-500`, text `text-white`, hover `hover:bg-red-600`.
- **Tactile Response:** Every clickable button incorporates active depression (`button:active:not(:disabled) { transform: scale(0.96); }`) with a 140ms ease transition.

### Cards / Containers
- **Corner Style:** `rounded-2xl` (16px).
- **Background:** `bg-white dark:bg-neutral-900/50` with subtle backdrop blur where appropriate.
- **Border:** `border border-neutral-200 dark:border-neutral-800`.
- **Internal Padding:** `p-4` for compact metric cards, `p-6` for rich data tables and settings blocks.

### Inputs / Fields
- **Style:** `rounded-lg` (8px), background `bg-white dark:bg-neutral-950`, border `border border-neutral-300 dark:border-neutral-700`.
- **Typography:** `text-sm`, placeholder `placeholder:text-neutral-400 dark:placeholder:text-neutral-600`.
- **Focus:** Outline none, border transition `focus:border-emerald-500`.
- **Currency & Numeric:** Number spinners disabled; companion currency dropdown docked flush inside the input group.

### Select / Combobox
- **Trigger:** Mimics input styling with chevron indicator rotating 180° upon open.
- **Flyout Menu:** `animate-pop` (240ms cubic-bezier(0.16, 1, 0.3, 1)), `rounded-lg` with `p-1`, background `dark:bg-neutral-900`, hairline border, z-index 30.
- **Selected Item:** `bg-emerald-500/15 text-emerald-700 dark:text-emerald-400` with inline checkmark icon.

### Modal Dialogs (ConfirmDialog)
- **Backdrop:** Fixed inset-0 `bg-black/50` with `animate-fade` (200ms ease-out).
- **Container:** `max-w-sm w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-xl animate-dialog`.
- **Affordance:** Clear headline, supporting message, and explicit Cancel (secondary) vs Confirm (primary or danger) actions. Native browser `window.confirm` or `alert` is strictly forbidden.

### Segmented Module Switcher
- **Container:** `rounded-xl bg-neutral-200/60 dark:bg-neutral-800/60 p-1 flex gap-1`.
- **Tab (Active):** `bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100 rounded-lg px-2 py-1.5 text-xs font-medium`.
- **Tab (Inactive):** `text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200`.

## Do's and Don'ts

### Do:
- **Do** wrap every card and primary surface in `rounded-2xl border border-neutral-200 dark:border-neutral-800`.
- **Do** apply `button:active:not(:disabled) { transform: scale(0.96); }` for physical tactile feedback across all interactive triggers.
- **Do** use `tabular-nums` on all currency, percentage, and timer readouts.
- **Do** respect `prefers-reduced-motion: reduce` by disabling non-essential keyframe animations.
- **Do** use `ConfirmDialog` for all destructive confirmations — never invoke browser `window.confirm()`.
- **Do** keep Emerald Pulse (`#10b981`) text paired with high-contrast `#0a0a0a` backgrounds or dark overlays for full accessibility compliance.

### Don't:
- **Don't** use browser-default form controls (`<select>`, checkbox checkmarks without custom styling, number spinners).
- **Don't** introduce heavy decorative drop shadows or blurry glow effects that muddy the dark obsidian plane.
- **Don't** paint uncompleted habits or regular pending items in alarmist red; use neutral grays until actual negative thresholds are breached.
- **Don't** mix arbitrary corner radii (e.g. 4px, 10px, 24px) outside the canonical scale (`6px`, `8px`, `12px`, `16px`, `full`).
- **Don't** split the visual source of truth between light and dark themes; dark is the primary master, light is a mirrored clean palette.
