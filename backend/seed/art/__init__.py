"""Original illustration library for the Orchard Row demo catalogue (SVG strings, rendered by a script)."""

from . import bakery, dairy, extras, packaged, produce, protein

ARCHETYPES = {}
for _mod in (produce, packaged, bakery, dairy, protein, extras):
    ARCHETYPES.update(_mod.ARCHETYPES)
