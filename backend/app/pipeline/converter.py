"""Converter stage.

Performs the React → React Native transformation. Applies deterministic AST
codemods driven by ``docs/CONVERSION-RULES.md`` first, falling back to
LLM assistance only where a mapping cannot be expressed mechanically.
"""
