"""Persistent canvas terrain identity, independent of UI preference resets."""
import json
from secrets import randbits

TERRAIN_KEY = "canvas_terrain_seed.v1"
LEGACY_TERRAIN_SEED = 0x5EEDA11


def reset_terrain_seed(connection):
    row = connection.execute("SELECT value_json FROM application_settings WHERE key=?", (TERRAIN_KEY,)).fetchone()
    previous = json.loads(row[0]) if row else LEGACY_TERRAIN_SEED
    seed = randbits(32)
    while seed == previous:
        seed = randbits(32)
    connection.execute(
        "INSERT INTO application_settings(key,value_json) VALUES (?,?) "
        "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
        (TERRAIN_KEY, json.dumps(seed)),
    )
    return seed


def ensure_terrain_seed(database, *, new_world):
    with database.transaction(immediate=True) as connection:
        row = connection.execute("SELECT value_json FROM application_settings WHERE key=?", (TERRAIN_KEY,)).fetchone()
        if row:
            return json.loads(row[0])
        if new_world:
            return reset_terrain_seed(connection)
        # Upgrades preserve the geography of existing canvases, even empty ones.
        connection.execute("INSERT INTO application_settings(key,value_json) VALUES (?,?)",
                           (TERRAIN_KEY, json.dumps(LEGACY_TERRAIN_SEED)))
        return LEGACY_TERRAIN_SEED
