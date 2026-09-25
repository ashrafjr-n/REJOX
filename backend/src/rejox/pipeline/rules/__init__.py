"""Analyzer rules.

Each module holds small, pure rule functions over the Knowledge Graph that emit
Issues / Findings. Nothing here parses source or calls an LLM — every result is
traceable to a KG fact.
"""
