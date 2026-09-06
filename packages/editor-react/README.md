# Editorial Desk React manuscript editor

An independent React 19 editor built on TipTap/ProseMirror. Includes paragraphs, headings, lists, tables, images, equation-source nodes, citations, undo/redo, and automatic typography. It does not import the application, its API client, authentication, or database.

```tsx
import {
  ManuscriptEditor,
  resolveManuscriptStyle,
} from '@editorial-desk/editor-react';
import '@editorial-desk/editor-react/styles.css';

const style = resolveManuscriptStyle({ documentClass: 'apa-journal' });

<ManuscriptEditor
  key={documentId}
  content={initialDocument}
  styleSpec={style}
  onChange={saveDocument}
/>
```

`content` initializes the editor; it is **not** a controlled value. Key by document ID when switching manuscripts. For external replacements, custom toolbars, or save coordination use `useManuscriptEditor` and `ManuscriptCanvas`:

```tsx
const editor = useManuscriptEditor({ content: initialDocument, onChange: saveDocument });
// When intentionally loading/restoring a server snapshot:
editor?.commands.setContent(snapshot, { emitUpdate: false });
// The host owns when replacement is safe and how pending saves are handled.
return <ManuscriptCanvas editor={editor} styleSpec={style} />;
```

Changing `styleSpec` updates the displayed typography without resetting the cursor, replacing JSON, creating a content edit, or clearing undo history. Paragraphs and headings inherit the template as they are typed or pasted. Uppercase heading presentation is CSS only; title/sentence casing is not guessed. Semantic emphasis remains in the document.

The host supplies persistence, image upload, references, templates, and export services. Equation nodes preserve LaTeX but currently display source. Citation nodes preserve library IDs; bibliography rendering belongs to the host. An optional `layout="columns"` enables continuous column flow, **not print pagination**. Page splitting, floating figures, complete venue rules, collaborative editing, and matching PDF/DOCX pagination remain future work.

Try `/editor-lab` in Editorial Desk. That temporary playground has no manuscript API dependency and discards edits on navigation. The real manuscript editor also uses this package and retains application autosave and version recovery.

Build with `npm run build -w @editorial-desk/editor-react`. A full repository build builds both packages. Pack with `npm pack -w @editorial-desk/editor-react --dry-run` to inspect the distribution. Both packages are private prototypes; remove `private` only for an intentional future npm release after validating APIs and scope ownership. The intended dependency is `@editorial-desk/editor-core@^0.1.0`.
