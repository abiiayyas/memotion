const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Timeline (click it first)",
    rows: [
      ["Space", "Play or pause"],
      ["⌘Z  /  ⇧⌘Z", "Undo / redo the last edit"],
      ["⌘A  /  Esc", "Select every clip / clear the selection"],
      ["Shift, ⌘ or Ctrl + click", "Add a clip to the selection, or take it out"],
      ["Drag on empty space", "Select every clip the box touches (Shift adds)"],
      ["Drag a clip", "Move it, and the whole selection with it; up or down moves lanes"],
      ["Alt while dragging", "Skip snapping for that drag"],
      ["S", "Split the selected clips at the playhead"],
      ["D", "Duplicate the selected clips"],
      ["⌫  /  Delete", "Delete the selected clips"],
      ["←  /  →", "Nudge selected clips by one frame, or move the playhead one frame when none is selected"],
      ["⇧←  /  ⇧→", "Nudge selected clips by one second, or move the playhead by the skip distance"],
      ["⌘ or Ctrl + scroll", "Zoom around the pointer"],
    ],
  },
  {
    title: "Writing",
    rows: [
      ["Enter", "Send the message (home page and chat)"],
      ["Shift + Enter", "New line"],
      ["@  then  Enter or Tab", "On the home page: pick one of the files you attached"],
    ],
  },
  {
    title: "Preview marks",
    rows: [
      ["Enter  /  Esc", "Save the comment / discard it"],
      ["Shift + Enter", "New line in a comment"],
    ],
  },
];

export function ShortcutsSection() {
  return (
    <>
      {GROUPS.map((g) => (
        <div key={g.title} className="sd-block">
          <h3>{g.title}</h3>
          <dl className="sd-keys">
            {g.rows.map(([keys, what]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p className="hint" style={{ padding: "0 4px" }}>These cannot be changed.</p>
    </>
  );
}
