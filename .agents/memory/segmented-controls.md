---
name: Type-safe segmented controls
description: Preserving choice types in shared React segmented controls.
---

For a shared generic segmented control, infer its type from the current controlled value rather than inline option arrays or callback variance. Otherwise TypeScript can widen a narrow setter type. Narrow option arrays to the values the control actually supports.

**Why:** Typechecking exposed widening across several controlled selectors, plus a selector whose model type included values that were not valid choices.

**How to apply:** When changing a shared segmented control, keep the value, option IDs, and callback on the same literal union and run the package typecheck.
