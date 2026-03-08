import React, { useEffect, useRef } from 'react';

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
};

const TOOLBAR_BUTTON_CLASS =
  'rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-bold uppercase text-zinc-200 hover:border-red-700 hover:text-white';

const normalizeRichTextHtml = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/<\/(div|p|h[1-6]|li)>/gi, '<br>')
    .replace(/<(div|p|h[1-6]|li)(\s[^>]*)?>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/^(<br\s*\/?>\s*)+|(<br\s*\/?>\s*)+$/gi, '')
    .trim();

const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, minHeight = 120 }) => {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalized = normalizeRichTextHtml(value);
    if (editor.innerHTML !== normalized) {
      editor.innerHTML = normalized;
    }
  }, [value]);

  const emitValue = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(normalizeRichTextHtml(editor.innerHTML));
  };

  const runCommand = (command: string, commandValue?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, commandValue);
    emitValue();
  };

  const insertEmoji = (emoji: string) => runCommand('insertText', emoji);

  const insertLink = () => {
    const url = window.prompt('URL do link');
    if (!url) return;
    runCommand('createLink', url.trim());
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2">
      <div className="mb-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => runCommand('bold')} className={TOOLBAR_BUTTON_CLASS}>
          B
        </button>
        <button type="button" onClick={() => runCommand('italic')} className={TOOLBAR_BUTTON_CLASS}>
          I
        </button>
        <button type="button" onClick={() => runCommand('underline')} className={TOOLBAR_BUTTON_CLASS}>
          U
        </button>
        <button type="button" onClick={() => runCommand('strikeThrough')} className={TOOLBAR_BUTTON_CLASS}>
          S
        </button>
        <button type="button" onClick={insertLink} className={TOOLBAR_BUTTON_CLASS}>
          Link
        </button>
        <button type="button" onClick={() => insertEmoji('🔥')} className={TOOLBAR_BUTTON_CLASS}>
          🔥
        </button>
        <button type="button" onClick={() => insertEmoji('✅')} className={TOOLBAR_BUTTON_CLASS}>
          ✅
        </button>
        <button type="button" onClick={() => insertEmoji('⭐')} className={TOOLBAR_BUTTON_CLASS}>
          ⭐
        </button>
        <button type="button" onClick={() => insertEmoji('😎')} className={TOOLBAR_BUTTON_CLASS}>
          😎
        </button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitValue}
        onBlur={emitValue}
        onPaste={(event) => {
          event.preventDefault();
          const pastedText = event.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, pastedText);
          emitValue();
        }}
        className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-600 focus:outline-none"
        style={{ minHeight }}
      />
    </div>
  );
};

export default RichTextEditor;
