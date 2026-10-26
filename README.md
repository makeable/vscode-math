# Math View

A VS Code extension that makes code read more like maths, without changing the file.

- **Sums in the editor:** `sum(x[i] for i in range(1, n+1))` shows as a typeset Σ with its limits stacked above and below. Lines containing a sum are made taller to fit.
- **Symbols:** `<=` `>=` `!=` `->` `lambda` `sqrt` and Greek names show as `≤ ≥ ≠ → λ √ α`.
- **Your cursor's line shows the real code**, so you never edit hidden characters. Tall lines keep their height, so nothing jumps as you move around.
- **Hover** a sum for a bigger version plus its LaTeX, for copying.

![Sums typeset in the editor](docs/inline.png)

![Hover showing a typeset sum](docs/hover.png)

## How the tall lines work

VS Code doesn't let extensions set a line's height directly, but colour theme token rules can. The extension adds a grammar scope, `meta.mathview.tall`, to lines containing a sum, and a default setting that makes that scope's lines 2.4× taller:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "meta.mathview.tall", "settings": { "lineHeight": 2.4 } }
  ]
}
```

If you already have your own `editor.tokenColorCustomizations`, they replace this default. The extension notices and offers to add the rule for you, or you can switch to compact mode.

## Try it

Open this folder in VS Code and press **F5**. A second window opens on `examples/`, with the extension running. Open `demo.py` or `demo.jl` and hover over a `sum(`.

To install it in your everyday VS Code:

```bash
npm run package
```

```bash
code --install-extension vscode-math-0.1.0.vsix
```

## What the hover understands

Python and Julia generator sums and products:

| Code | Shown as |
|---|---|
| `sum(x[i] for i in range(1, n+1))` | Σ from i=1 to n of xᵢ |
| `sum(x[i] for i in range(n))` | Σ from i=0 to n−1 |
| `sum(x[i] for i in 1:n)` (Julia) | Σ from i=1 to n |
| `sum(A[i][j] for i in range(n) for j in range(m))` | double sum |
| `sum(x[i] for i in range(n) if i % 2 == 0)` | condition under the Σ |
| `sum(w for w in weights)` | Σ over w ∈ weights |
| `math.prod(...)`, `np.sum(...)` | Π, Σ |

Inside the sum it handles `+ - * / // % **`, indexing (`x[i]` → xᵢ), `sqrt`, `abs`, `exp`, `log`, trig functions and Greek variable names. Anything outside that, such as strings or list comprehensions, simply gets no hover.

## Settings

| Setting | Default | |
|---|---|---|
| `mathView.enabled` | `true` | Symbol substitution on or off. Also **Math View: Toggle Symbol Substitution** in the command palette. |
| `mathView.revealOnCursorLine` | `true` | Show the original text on lines with a cursor. |
| `mathView.inline` | `tall` | `tall`: full stacked Σ in a taller line. `compact`: limits beside the Σ, normal line height. `off`: leave sums as code. |
| `mathView.hover` | `true` | Typeset sums on hover. |
| `mathView.hoverScale` | `1.4` | Size of the hover maths. |

## Notation is config driven

Everything the extension knows about maths lives in tables: which calls are big operators, how functions are drawn, which names are symbols, and what counts as a range. The built-in tables are in [`src/notation/`](src/notation). Your settings are merged on top of them:

| Setting | What it holds |
|---|---|
| `mathView.bigOperators` | Calls with a generator, e.g. `sum(f(i) for i in ...)`, and their LaTeX symbol |
| `mathView.functions` | LaTeX templates for function calls |
| `mathView.identifiers` | Names and constants drawn as LaTeX |
| `mathView.ranges` | Iterables that become the limits of a sum |
| `mathView.modulePrefixes` | Module names ignored in lookups, so `np.sqrt` uses `sqrt` |
| `mathView.symbols` | Symbol substitutions: regex → symbol |
| `mathView.builtinNotation`, `mathView.builtinSymbols` | Turn off to start from empty tables |

Run **Math View: Show Notation for This Language** to see the merged tables for the file you're in.

Rules for all of them:

- **Merging:** your entries are added to the built-ins, or replace one with the same key. Set a key to `null` to remove a built-in. For `modulePrefixes`, start an entry with `-` to remove one.
- **Per language:** every setting works inside VS Code's language blocks, so Python and Julia can differ.
- **Per project:** put them in `.vscode/settings.json` to give a repo its own notation.

An example that adds a little of everything:

```jsonc
"[python]": {
  "mathView.bigOperators": {
    "logsumexp": "\\operatorname{LSE}"          // logsumexp(z[i] for i in range(k))
  },
  "mathView.functions": {
    "softplus": "\\log\\left(1 + e^{$1}\\right)",
    "hypot/2": "\\sqrt{$1^2 + $2^2}",             // name/arity matches by number of arguments
    "clip": [                                     // a list is tried in order
      "\\operatorname{clip}_{[$2, $3]}($1)",
      "\\operatorname{clip}($1)"
    ]
  },
  "mathView.identifiers": { "hbar": "\\hbar" },
  "mathView.ranges": {
    "arange/2": { "from": "$1", "to": "$2 - 1" }  // written in Python, then simplified
  },
  "mathView.symbols": { "\\*\\*": "^", "!=": null }
}
```

Template placeholders: `$1`, `$2` are arguments converted to LaTeX, `$args` is all of them, and `$1|atom` brackets an argument unless it's a single symbol. Range limits (`from`, `to`) are written in the document's language rather than LaTeX, so `range(1, n+1)` gets an upper limit of `n`, not `n + 1 - 1`.

Changing `bigOperators` also changes which lines are made taller. VS Code only reads that grammar at startup, so the extension rewrites it and offers to reload the window.

## Limitations

- Substitutions are plain pattern matches, so they also apply inside strings and comments.
- Tall lines work for Python and Julia, the languages the grammar rule is attached to. Sums split over several lines stay as code.
- Line height follows the grammar's simple pattern match, so a line with a sum the extension can't typeset (for example one using strings) still gets taller.
- The colour of the hover maths follows light/dark theme, not the exact theme colour.

## Development

```bash
npm test
```

```bash
npm run test:vscode
```

`npm test` runs the parser tests. `npm run test:vscode` runs the extension inside your installed VS Code with a throwaway profile and checks the hovers.

Files:

- `extension.js`: decorations, hover, settings
- `src/notation/`: built-in notation tables per language
- `src/parse/`: expression parsers
- `src/tex.js`: parsed code → LaTeX, driven by a notation
- `src/grammar.js`: generates the tall-line grammars in `syntaxes/` (`npm run grammars` after changing the built-ins)
- `src/render.js`: LaTeX → SVG via MathJax
