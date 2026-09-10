/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/flow_chat/components/ChatInput.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

// Exercise the production observer without mounting the composer's unrelated services.
function mountObserver(editor: HTMLElement, measureRef: { current: (source: string) => void }) {
  const start = source.indexOf('  useEffect(() => {', source.indexOf('// Also watch DOM mutations'));
  const end = source.indexOf('\n\n  useEffect', start);
  const effect = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  let cleanup: (() => void) | undefined;
  const checkDomEmpty = vi.fn();
  new Function('useEffect', 'richTextInputRef', 'measureIsMultiLineRef', 'checkDomEmpty', effect)(
    (setup: () => () => void) => { cleanup = setup(); },
    { current: editor }, measureRef, checkDomEmpty,
  );
  return { cleanup: () => cleanup?.(), checkDomEmpty };
}

afterEach(() => vi.unstubAllGlobals());

describe('ChatInput deferred layout measurement', () => {
  it('uses current target state for streamed DOM changes and coalesces pending frames', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const editor = document.createElement('div');
    editor.appendChild(document.createTextNode('short'));
    const initialMeasure = vi.fn();
    const measureRef = { current: initialMeasure };
    const observer = mountObserver(editor, measureRef);
    try {
      // Speech input may update the existing text node rather than replace it.
      editor.firstChild!.textContent = 'short text';
      await Promise.resolve();
      expect(frames.size).toBe(1);
      editor.appendChild(document.createTextNode(' more'));
      await Promise.resolve();
      expect(frames.size).toBe(1);

      // The conversation target (or images/newlines) changes before the frame runs.
      const currentMeasure = vi.fn();
      measureRef.current = currentMeasure;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(0));
      expect(initialMeasure).not.toHaveBeenCalled();
      expect(currentMeasure).toHaveBeenCalledExactlyOnceWith('mutation-observer');
      expect(observer.checkDomEmpty).toHaveBeenCalledOnce();

      editor.firstChild!.textContent = 'final';
      await Promise.resolve();
      expect(frames.size).toBe(1);
      observer.cleanup();
      expect(frames.size).toBe(0);
      editor.replaceChildren();
      await Promise.resolve();
      expect(frames.size).toBe(0);
    } finally {
      observer.cleanup();
    }
  });

  it.each(['value-effect', 'collapse-confirmation', 'layout-change'])(
    'routes %s through the latest measurement instead of a captured render', (trigger) => {
      expect(source).toContain(`measureIsMultiLineRef.current?.('${trigger}')`);
      expect(source).not.toContain(`measureIsMultiLine('${trigger}')`);
    },
  );
});
