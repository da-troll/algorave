// CodeMirror theme mapped from design tokens, so the REPL is not a
// foreign-coloured island. CSS variables only: it follows theme switches live.
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { Prec } from "@codemirror/state";

export function tokenEditorTheme() {
  const theme = EditorView.theme({
    "&": { color: "var(--text-primary)", backgroundColor: "var(--surface-sunken)", height: "100%" },
    ".cm-content": { caretColor: "var(--accent)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--selection-bg) !important" },
    ".cm-activeLine": { backgroundColor: "var(--surface-hover)" },
    ".cm-gutters": { backgroundColor: "var(--surface-sunken)", color: "var(--text-subtle)", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)" },
    ".cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--border-strong)" },
    // Strudel's active-event highlight outline
    ".cm-highlight, .cm-strudel-highlight": { outline: "1.5px solid var(--accent)" },
    ".cm-tooltip": { backgroundColor: "var(--surface-overlay)", color: "var(--text-primary)", border: "1px solid var(--border)" },
  });
  const hl = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword], color: "var(--accent)" },
    { tag: [t.string, t.special(t.string)], color: "var(--success-fg)" },
    { tag: [t.number, t.bool, t.null], color: "var(--warning-fg)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--text-muted)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName], color: "var(--info-fg)" },
    { tag: [t.variableName, t.definition(t.variableName)], color: "var(--text-primary)" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "var(--text-secondary)" },
  ]);
  return Prec.highest([theme, syntaxHighlighting(hl)]);
}
