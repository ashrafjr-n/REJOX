// Intentionally malformed component: unterminated JSX / missing closing tag.
// The parser-worker must degrade gracefully (emit a warning, not crash).
export default function Broken() {
  const value = ;
  return (
    <div className="broken">
      <span>Oops
    </div>
  )
}
