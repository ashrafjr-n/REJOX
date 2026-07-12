// A valid component alongside the broken one — proves the worker still
// extracts good files even when a sibling file has a syntax error.
export default function Good() {
  return <div className="ok">All good</div>;
}
