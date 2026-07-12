"""Validator stage.

Proves the generated React Native project actually works by running
``tsc --noEmit`` and a Metro build against the output. Failures loop back with
actionable diagnostics; success gates the Download stage.
"""
