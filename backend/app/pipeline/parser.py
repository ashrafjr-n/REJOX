"""Parser stage.

Turns React source files into ASTs (via Babel / the TypeScript Compiler API)
and normalizes them into the deterministic knowledge graph that every later
stage reads from. No interpretation happens here — parsing only.
"""
