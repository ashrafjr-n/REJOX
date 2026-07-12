"""Analyzer stage.

Walks the knowledge graph to classify patterns, detect supported vs
unsupported features (see ``docs/PRD.md``), and score migratability. Pure
functions over the graph — never mutates source.
"""
