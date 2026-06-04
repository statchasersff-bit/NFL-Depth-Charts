---
name: ESPN Depth Chart API Shape
description: Real structure of ESPN's depthcharts API response for NFL teams — formations object, slot vs parent abbreviations, category classification.
---

## Rule

The ESPN endpoint `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/{slug}/depthcharts` returns:

```json
{
  "timestamp": "...",
  "season": { "year": 2026 },
  "team": { "logos": [{ "href": "..." }] },
  "depthchart": {
    "0": { "id": "...", "name": "Base 4-3 D", "positions": { ... } },
    "1": { "id": "...", "name": "Special Teams", "positions": { ... } },
    "2": { "id": "...", "name": "3WR 1TE", "positions": { ... } }
  }
}
```

- `depthchart` is an **object with numeric string keys** (not an array, not an `items` array).
- Each value is a "formation" with `name` and `positions` (a Record<slotKey, positionSlot>).
- Each `positionSlot` has:
  - `position.abbreviation` — the slot's own abbr used for display (e.g. `WR`, `QB`, `LDE`, `MLB`)
  - `position.parent.abbreviation` — the parent category abbr (e.g. `OFF`, `OT`, `OG`, `DE`, `LB`, `ST`)
  - `athletes` — array of `{ id, displayName, shortName, injuries, headshot? }`

## Category Classification

Use the **slot's own abbreviation** as the group key (so "WR" beats "LDE" for unique position cards). Use the **parent abbreviation** to decide which tab (offense/defense/special) the group belongs to:

- Offense parents: `OFF`, `OT`, `OG`
- Defense parents: `DE`, `DT`, `LB`, `CB`, `S`, `DB`
- Special parents: `ST`

When multiple formations have the same slot abbreviation, keep the entry with the most athletes.

**Why:** The original normalizer was written assuming `data.items` would be an array of position groups (typical ESPN pattern), but the depth chart endpoint uses a completely different shape — a formation-keyed object. This caused all 32 teams to cache with empty groups.

**How to apply:** Any future changes to `espnFetcher.ts` normalizer must iterate `Object.values(data.depthchart)` → each formation → `Object.values(formation.positions)`.
