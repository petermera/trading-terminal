# VOLT Terminal design system

The terminal uses a compact, data-first visual language: warm stone surfaces, a restrained evergreen selection accent, clear semantic market states, and a monospace typeface that keeps prices and timestamps aligned. This is an **Operate** interface; scanability, source clarity, and dependable controls take priority over decoration. Branding stays typographic, without emoji.

## Foundations

Design tokens live in the `:root` block of `global_electricity_trading_platform.html`. Keep new styles on these semantic tokens instead of repeating raw values.

| Category | Tokens | Use |
| --- | --- | --- |
| Surfaces | `--color-background-canvas`, `--color-background-primary`, `--color-background-secondary`, `--color-background-accent` | Warm stone page, panels, quiet groupings, selected controls |
| State surfaces | `--color-background-positive`, `--color-background-negative` | Buy/positive and sell/negative states |
| Text | `--color-text-primary`, `--color-text-secondary`, `--color-text-tertiary` | Main content, supporting copy, compact labels |
| Semantic text | `--color-text-accent`, `--color-text-positive`, `--color-text-negative`, `--color-text-warning` | Selection, market direction, errors, chart average |
| Borders | `--color-border-tertiary`, `--color-border-secondary`, `--color-border-accent` | Default, emphasized, and focused boundaries |
| Type | `--font-mono`, `--font-size-xs` through `--font-size-xl` | Data alignment and a stepped information hierarchy |
| Rhythm | `--space-1` through `--space-4`, `--space-6`, `--border-radius-sm`, `--border-radius-md`, `--border-radius-input` | Repeated gaps, padding, and gently rounded control/panel corners |
| Interaction | `--motion-fast`, `--focus-ring` | Short state transitions and visible keyboard focus |

Use state color with text or a symbol, never as the only indication of price direction or status. Secondary and tertiary text are chosen for legibility on the light surfaces.

## Type and density

The single monospace family is intentional: this terminal is predominantly prices, timestamps, identifiers, and compact market data. Hierarchy comes from the `10 / 13 / 16 / 20 / 25px` scale, weight, and semantic color rather than a decorative display face. Keep descriptive prose short and preserve room for real market values.

The em dash is the intentional empty-value marker for unavailable market data and not prose punctuation.

## Shared patterns

- **Market cards** select a bidding zone. Keep price, product, freshness/change, and history in a consistent order; support keyboard activation and expose selection with `aria-pressed`.
- **Tabs** switch product views and expose their active state with `aria-pressed`.
- **Panels and section dividers** group related market data without nesting extra card treatments.
- **Change badges and buy/sell controls** use the positive/negative semantic palette consistently.
- **Source and error messaging** stays visible and explicit; never style unavailable or stale data as a fresh quote.

The app is currently a standalone HTML surface, so foundations and patterns stay local to it. Move styles or components into shared files only when another surface needs the same pattern.
