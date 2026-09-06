# Editorial Desk editor core

Independent TypeScript typography model, template catalog, and CSS variable adapter. No React, network, account, or storage dependencies.

```ts
import { resolveManuscriptStyle } from '@editorial-desk/editor-core';

const style = resolveManuscriptStyle({
  documentClass: 'ieee-conference',
  styleSpec: { body_size_pt: 11 },
});
```

Explicit class defaults are merged with custom typography, including nested heading sizes and margins. Without a class, custom typography inherits the general manuscript default. Invalid numerical geometry falls back to safe values for the browser.

Templates are generated from the application's existing Python export engine using `npm run generate:editor-templates`. CI verifies that they have not drifted. They describe the app's current presets, not independently certified venue compliance.

Prototype version 0.1.0. The package is private until the API is validated; its build emits standalone ESM and declarations. No npm publication has taken place.
