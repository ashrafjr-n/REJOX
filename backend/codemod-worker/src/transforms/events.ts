/**
 * Event transform (runs while host tags are still lowercase):
 *   - onClick → onPress on host elements
 *   - onClick → onPress on PROJECT components whose props are graph-resolved
 *     as DOM-derived (options.componentEvents; e.g. Button extends
 *     ButtonHTMLAttributes) — renamed consistently with the definition side,
 *     which the props-type transform rewrites to PressableProps.
 *   - a local props interface declaring its own `onClick` prop is renamed to
 *     `onPress` (declaration + all in-file references) so both sides agree.
 *   - onChange on input/textarea/select → onChangeText (+ adapter TODO)
 *   - onSubmit → dropped (+ TODO)
 *   - web-only mouse/key events → dropped (+ warning)
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { WEB_ONLY_EVENTS } from '../maps';
import { applyUntilStable, isHostTag, recordUnhandled, recordWarning } from '../util';

const CHANGE_HOSTS = new Set(['input', 'textarea', 'select']);

function ownerTag(attr: Node): string | null {
  const owner =
    attr.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement) ??
    attr.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
  return owner ? owner.getTagNameNode().getText() : null;
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  const componentEvents = ctx.options.componentEvents ?? {};

  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const tag = ownerTag(attr);
    if (!tag) continue;
    const name = attr.getNameNode().getText();
    const line = attr.getStartLineNumber();

    // Project components: rename only what the Knowledge Graph proved is a
    // DOM-derived prop — a component's own (value: T) => void API is never touched.
    if (!isHostTag(tag)) {
      const renamed = componentEvents[tag]?.[name];
      if (renamed && renamed !== name) {
        attr.getNameNode().replaceWithText(renamed);
        return true;
      }
      continue;
    }

    if (name === 'onClick') {
      attr.getNameNode().replaceWithText('onPress');
      return true;
    }
    if (name === 'onChange' && CHANGE_HOSTS.has(tag)) {
      attr.getNameNode().replaceWithText('onChangeText');
      recordUnhandled(
        ctx,
        'EVENT_ADAPTER',
        `onChange→onChangeText on <${tag}> (line ${line}): handler now receives a string, not an event.`,
        attr.getText(),
      );
      return true;
    }
    if (name === 'onSubmit') {
      recordUnhandled(
        ctx,
        'FORM_SUBMIT',
        `onSubmit on <${tag}> (line ${line}) has no RN equivalent; handle submission in state.`,
        attr.getText(),
      );
      attr.remove();
      return true;
    }
    if (WEB_ONLY_EVENTS.has(name)) {
      recordWarning(ctx, 'WEB_ONLY_EVENT', `Dropped ${name} on <${tag}> (no touch equivalent).`, line);
      attr.remove();
      return true;
    }
  }
  return false;
}

/**
 * Definition side of the custom-component rename: a local props interface that
 * declares its own `onClick` becomes `onPress` (declaration + all in-file
 * references), matching the caller-side rename driven by componentEvents.
 */
function renameLocalOnClickProps(sf: SourceFile, ctx: Ctx): void {
  for (const iface of sf.getInterfaces()) {
    const prop = iface.getProperty('onClick');
    if (!prop) continue;
    const line = prop.getStartLineNumber();
    prop.rename('onPress');
    recordWarning(
      ctx,
      'EVENT_PROP_RENAMED',
      `Own prop onClick → onPress on ${iface.getName()} (line ${line}); callers are renamed via the graph.`,
      line,
    );
  }
}

export function transformEvents(sf: SourceFile, ctx: Ctx): void {
  renameLocalOnClickProps(sf, ctx);
  applyUntilStable(() => transformOne(sf, ctx));
}
