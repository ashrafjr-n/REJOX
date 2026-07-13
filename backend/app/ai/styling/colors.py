"""Tailwind color token → hex, shared by the static-map and pattern tiers.

React Native has no notion of Tailwind's palette, so a ``from-indigo-600`` or a
``divide-slate-100`` must be resolved to a concrete hex value. This is a
*deterministic* lookup — the palette is fixed and public — so it belongs in the
rule tiers, never the LLM. Only a subset of the full palette is carried here;
:func:`tw_hex` returns ``None`` for anything absent, and the caller decides
whether to degrade gracefully (keep the token, lower confidence) rather than
guess.
"""

from __future__ import annotations

from typing import Optional

# Subset of the Tailwind default palette (the shades that actually occur in real
# gradients / dividers). Extend as new tokens appear in residue — every entry
# added here keeps another color off the LLM's desk.
_PALETTE: dict[str, str] = {
    # slate
    "slate-50": "#f8fafc", "slate-100": "#f1f5f9", "slate-200": "#e2e8f0",
    "slate-300": "#cbd5e1", "slate-500": "#64748b", "slate-700": "#334155",
    "slate-900": "#0f172a",
    # gray
    "gray-100": "#f3f4f6", "gray-200": "#e5e7eb", "gray-500": "#6b7280",
    "gray-900": "#111827",
    # indigo
    "indigo-50": "#eef2ff", "indigo-100": "#e0e7ff", "indigo-400": "#818cf8",
    "indigo-500": "#6366f1", "indigo-600": "#4f46e5", "indigo-700": "#4338ca",
    # violet
    "violet-400": "#a78bfa", "violet-500": "#8b5cf6", "violet-600": "#7c3aed",
    "violet-700": "#6d28d9",
    # purple
    "purple-500": "#a855f7", "purple-600": "#9333ea",
    # blue
    "blue-400": "#60a5fa", "blue-500": "#3b82f6", "blue-600": "#2563eb",
    # sky
    "sky-400": "#38bdf8", "sky-500": "#0ea5e9",
    # red / rose
    "red-500": "#ef4444", "red-600": "#dc2626", "rose-500": "#f43f5e",
    # emerald / green
    "emerald-500": "#10b981", "green-500": "#22c55e", "green-600": "#16a34a",
    # amber / orange
    "amber-500": "#f59e0b", "orange-500": "#f97316",
    # pink / teal / cyan
    "pink-500": "#ec4899", "teal-500": "#14b8a6", "cyan-500": "#06b6d4",
    # neutrals
    "white": "#ffffff", "black": "#000000",
}


def tw_hex(token: str) -> Optional[str]:
    """Return the hex for a Tailwind color token (e.g. ``indigo-600``), or None.

    Accepts a bare color token — the caller strips the utility prefix
    (``from-``, ``to-``, ``divide-``) first.
    """
    return _PALETTE.get(token)
