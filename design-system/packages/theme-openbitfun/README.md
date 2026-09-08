# @openbitfun/theme-openbitfun

Replaceable OpenBitFun theme values for the framework-neutral `@openbitfun/ui` package.

```ts
import "@openbitfun/theme-openbitfun/default.css";
import { themeModes, themeTokenCatalog, themes } from "@openbitfun/theme-openbitfun";
```

`default.css` synchronously imports the system token contract and all built-in theme variants. Theme selection is scoped to a `data-openbitfun-design-system-root` element and uses independent `data-color-scheme` and `data-contrast` axes.

`themeTokenCatalog` exposes the complete public semantic theme contract for visual authoring: colors, elevation shadows, surface filters, and state opacity. UI components consume this semantic contract and never depend on reference colors directly.

## Foundational color scales

Named numeric scales live below the semantic theme layer. Step numbers increase from light to dark, for example `ref.color.neutral.50`, `ref.color.blue.500`, and `ref.color.red.700`. Semantic tokens map those stable palette values to roles such as `color.content.primary` or `color.status.danger.content` independently in each theme mode.

Design tools can read the palette through the authoring-only export:

```ts
import {
  referenceColorCatalog,
  referenceColorScales,
} from "@openbitfun/theme-openbitfun/authoring";
```

The same data is available as `@openbitfun/theme-openbitfun/reference-colors.json`. Reference colors deliberately do not emit runtime CSS variables; application and component CSS must continue to use semantic theme variables.

## Surface and state roles

- `color.surface.scene`, `panel`, and `raised` own primary content and elevated planes.
- `color.surface.chrome` owns persistent application structure such as navigation and window-control regions.
- `color.surface.tertiary` is an opaque low-emphasis fill for persistent grouped content such as cards and field groups.
- `color.surface.subtle` is a translucent local tint for transient feedback and small inset details. It must not define a persistent application plane.
- `color.selection.surface` owns persistent neutral selection. Hover and pressed colors remain action feedback and are not substitutes for selection.
- `color.codeChange.added` (`#1aa73e`) and `color.codeChange.removed` (`#ec221f`) also anchor success and danger emphasis. Warning emphasis uses `#ff8c00`; information uses the existing creative-action blue (`#2e7eff`). These clear hues share light tints instead of separate per-component palettes.
- `color.status.*.emphasis` colors icons and short emphasis. `content` derives a readable shade from that anchor for text; `surface` and `border` derive 10% and 30% tints. High-contrast themes may strengthen text contrast without changing the emphasis anchors.
- Status source tokens retain their `color-mix()` references. The theme build resolves these mixes to concrete hex/RGBA values so CSS, plugins, and renderer payloads consume the same palette without relying on renderer-specific CSS color support.
