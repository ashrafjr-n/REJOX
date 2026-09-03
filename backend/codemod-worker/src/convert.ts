/**
 * Transformation orchestrator (Deterministic Transformer).
 *
 * Composes the individually-testable transforms over one source file and emits
 * the RN code plus structured warnings and the `unhandled` list (the AI
 * Resolution Engine residue). The transform order matters:
 *
 *   navigation → events → attributes → elements → images → text → styles
 *   → propsTypes → imports → TODO header
 *
 *   - navigation runs first, while <Link>/<NavLink>/useParams are intact;
 *   - events run while host tags are still lowercase, so only graph-proven
 *     project components are ever touched;
 *   - attributes run for the same reason, and before elements: a DOM-only
 *     attribute has to go while its tag still says which ones those are;
 *   - images run after elements (img is already <Image>);
 *   - text-wrapping runs after element renames so parent tags are already RN;
 *   - imports run last, over the fully-transformed file.
 */

import { IndentationText, Project, QuoteKind } from 'ts-morph';
import type { ConvertResult, Ctx, Options } from './types';
import { commentSafe } from './util';
import { transformNavigation } from './transforms/navigation';
import { transformEvents } from './transforms/events';
import { transformAttributes } from './transforms/attributes';
import { transformElements } from './transforms/elements';
import { transformImages } from './transforms/images';
import { transformText } from './transforms/text';
import { transformStyles } from './transforms/styles';
import { transformPropsTypes } from './transforms/propsTypes';
import { transformImports } from './transforms/imports';

function newProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 4 /* react-jsx */, allowJs: true },
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Single,
    },
  });
}

function renderTodoHeader(ctx: Ctx): string {
  if (ctx.todos.length === 0) return '';
  const lines = ctx.todos.map((t) => `// REJOX-TODO(${t.code}): ${commentSafe(t.message)}`);
  return (
    `// ===== REJOX-TODO: ${ctx.todos.length} item(s) need attention =====\n` +
    lines.join('\n') +
    '\n'
  );
}

/** Insert the TODO header after the import block (or at the top). */
function withTodoHeader(sf: ReturnType<Project['createSourceFile']>, ctx: Ctx): void {
  const header = renderTodoHeader(ctx);
  if (!header) return;
  const imports = sf.getImportDeclarations();
  if (imports.length > 0) {
    const last = imports[imports.length - 1];
    sf.insertText(last.getEnd(), `\n\n${header.replace(/\n$/, '')}`);
  } else {
    sf.insertText(0, `${header}\n`);
  }
}

/** Transform one file's source text into RN code + diagnostics. */
export function convert(
  filePath: string,
  source: string,
  options: Options,
): ConvertResult {
  const project = newProject();
  const sf = project.createSourceFile('input.tsx', source, { overwrite: true });

  const ctx: Ctx = {
    options,
    warnings: [],
    unhandled: [],
    todos: [],
    rnUsed: new Set(),
    namedImports: new Map(),
  };

  transformNavigation(sf, ctx);
  transformEvents(sf, ctx);
  transformAttributes(sf, ctx);
  transformElements(sf, ctx);
  transformImages(sf, ctx);
  transformText(sf, ctx);
  transformStyles(sf, ctx);
  transformPropsTypes(sf, ctx);
  transformImports(sf, ctx);
  withTodoHeader(sf, ctx);

  sf.formatText();

  return {
    file: filePath,
    code: sf.getFullText(),
    warnings: ctx.warnings,
    unhandled: ctx.unhandled,
  };
}

/**
 * Re-parse `code` and return the count of syntactic errors. The worker uses
 * this to guarantee the "output must be syntactically valid TS" contract.
 */
export function syntacticErrorCount(code: string): number {
  const project = newProject();
  const sf = project.createSourceFile('check.tsx', code, { overwrite: true });
  return project
    .getProgram()
    .compilerObject.getSyntacticDiagnostics(sf.compilerNode).length;
}
