/**
 * Event transform (runs while host tags are still lowercase, so custom
 * components are never touched):
 *   - onClick → onPress
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
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const tag = ownerTag(attr);
    if (!tag || !isHostTag(tag)) continue; // host elements only
    const name = attr.getNameNode().getText();
    const line = attr.getStartLineNumber();

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

export function transformEvents(sf: SourceFile, ctx: Ctx): void {
  applyUntilStable(() => transformOne(sf, ctx));
}
