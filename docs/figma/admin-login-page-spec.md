# Figma Spec: Admin Login + Admin Shell

This spec is aligned to the current site visual language (dark cinematic base, gold accent, Manrope + serif headline).

## Pages and Frames

1. `Auth / Login`
- Desktop frame: `1440 x 1024`
- Mobile frame: `390 x 844`

2. `Admin / Dashboard Shell`
- Desktop frame: `1440 x 1024`
- Mobile frame: `390 x 844`

## Design Tokens

- `bg/base`: `#0F1118`
- `bg/panel`: `rgba(25, 27, 36, 0.82)`
- `text/primary`: `#ECE8DF`
- `text/secondary`: `rgba(236, 232, 223, 0.74)`
- `stroke/default`: `rgba(236, 232, 223, 0.18)`
- `stroke/strong`: `rgba(236, 232, 223, 0.32)`
- `accent/base`: `#C8A879`
- `accent/soft`: `rgba(200, 168, 121, 0.20)`
- `danger/base`: `#D86A6A`
- `success/base`: `#6FA886`

Type:
- Heading display: `Twigs`, 56/1.04, tracking `2%`
- Section heading: `Bodoni Moda`, 30/1.2
- Body: `Manrope`, 16/1.6
- UI label: `Manrope`, 12/1.3, uppercase, tracking `14%`
- Button text: `Manrope`, 12/1.2, uppercase, tracking `14%`, semibold

Radius and shadow:
- Card radius: `18`
- Input radius: `10`
- Pill radius: `999`
- Soft shadow: `0 12 30 0 rgba(0,0,0,0.35)`
- Deep shadow: `0 24 52 0 rgba(0,0,0,0.50)`

## Layout: Login (Desktop)

- Root: 12-column grid, margin `80`, gutter `24`.
- Background: two radial gradients over base dark.
- Main container centered: width `1120`, height auto, 2-column split.
- Left promo panel (6 cols):
  - Brand mark (60x60), title, subtitle.
  - Eyebrow chip: `ADMIN ACCESS`.
  - H1: `Manage clients, projects, and deliveries.`
  - Supporting copy (2 lines max).
  - 3 bullet trust points with small icon dots.
- Right login card (5 cols, with 1 col breathing space):
  - Card padding `28`, vertical gap `16`.
  - Title: `Sign in`
  - Inputs:
    - Email
    - Password
  - Row: `Remember me` checkbox + `Forgot password?` link
  - Primary CTA: `Sign in to Admin`
  - Secondary CTA (ghost): `Back to Portfolio`
  - Error alert variant area under title.

## Layout: Login (Mobile)

- Single column stack.
- Brand/promo condenses to:
  - Brand row + short heading + 1-line helper text.
- Login card full width with `16` horizontal margins.
- Sticky bottom primary CTA inside card for thumb reach.

## Layout: Admin Shell (Desktop)

- Left sidebar: width `248`, full height.
  - Brand at top.
  - Nav groups:
    - Overview
    - Clients
    - Projects
    - Galleries
    - Deliveries
    - Downloads
    - Settings
  - User profile + logout pinned bottom.
- Top bar (main content):
  - Breadcrumb + page title
  - Search box
  - `Create` button
- Content area:
  - KPI cards row (4 cards)
  - Main two-column content:
    - Recent projects table
    - Pending deliveries panel

## Layout: Admin Shell (Mobile)

- Top app bar with hamburger + title + avatar.
- Slide-over nav drawer.
- KPI cards become horizontal scroll chips.
- Tables collapse into stacked cards.

## Components to Build in Figma

1. `Button`
- Variants: `Primary`, `Ghost`, `Danger`
- States: `Default`, `Hover`, `Pressed`, `Disabled`

2. `Input`
- Variants: `Text`, `Password`, `Search`
- States: `Default`, `Focus`, `Error`, `Disabled`

3. `Nav Item`
- Variants: `Default`, `Active`, `Hover`
- Optional badge count.

4. `Alert`
- Variants: `Error`, `Success`, `Info`

5. `KPI Card`
- Title, value, delta chip, optional sparkline placeholder.

## Prototype Flow

1. `Login / Default` -> click `Sign in to Admin` -> `Login / Loading`
2. `Login / Loading` -> success -> `Admin / Dashboard`
3. `Login / Loading` -> failure -> `Login / Error`
4. `Admin / Dashboard` -> click nav item updates active state and page title.

Animation:
- Page transition: smart animate `250ms`, ease-out.
- Sidebar hover/active micro states: `150ms`.

## Copy Deck (Starter)

Login:
- Title: `Sign in`
- Subtitle: `Use your admin credentials to access client operations.`
- Error: `Incorrect email or password. Please try again.`

Dashboard:
- Title: `Operations Dashboard`
- KPI labels: `Active Projects`, `Pending Deliveries`, `New Downloads`, `Storage Used`

## Handoff Notes

- Use Auto Layout for all cards, forms, nav groups, and top bar.
- Keep spacing scale consistent: `4, 8, 12, 16, 24, 32, 48`.
- Keep component names stable for code mapping:
  - `auth/login-card`
  - `admin/sidebar`
  - `admin/topbar`
  - `admin/kpi-card`
