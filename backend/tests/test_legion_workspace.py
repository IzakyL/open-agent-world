import json

import pytest
from pydantic import ValidationError

from backend.legion_workspace import WorkspaceLayout, remap_workspace_config


def pane(card_id):
    return {"kind": "pane", "card_id": card_id}


def split(first, second):
    return {"kind": "split", "axis": "horizontal", "ratio": .35, "first": first, "second": second}


def tabs(ids, active):
    return {"kind": "tabs", "card_ids": ids, "active_card_id": active}


def test_tab_validation_and_reference_remapping():
    for root in [tabs([], "a"), tabs(["a", "a"], "a"), tabs(["a", "b"], "missing"),
                 split(pane("a"), tabs(["a", "b"], "b"))]:
        with pytest.raises(ValidationError):
            WorkspaceLayout(root=root)
    config = {"workspace_layout": {"version": 1, "root": tabs(["a", "b", "c"], "b")}}
    assert remap_workspace_config(config, {"a": "A", "b": "B", "c": "C"})["workspace_layout"]["root"] == tabs(["A", "B", "C"], "B")
    assert remap_workspace_config(config, {"a": "A", "c": "C"})["workspace_layout"]["root"] == tabs(["A", "C"], "A")
    assert remap_workspace_config(config, {"c": "C"})["workspace_layout"]["root"] == pane("C")
    assert remap_workspace_config(config, {})["workspace_layout"]["root"] is None


def test_workspace_validation_rejects_duplicates_invalid_ratio_and_depth():
    invalid = [split(pane("a"), pane("a")), {**split(pane("a"), pane("b")), "ratio": .01},
               {**split(pane("a"), pane("b")), "axis": "diagonal"}, {"kind": "pane", "card_id": "a", "secret": "x"}]
    deep = pane("0")
    for index in range(17):
        deep = split(pane(str(index + 1)), deep)
    invalid.append(deep)
    for root in invalid:
        with pytest.raises(ValidationError):
            WorkspaceLayout(root=root)


def test_workspace_remapping_collapses_missing_references():
    config = {"mode": "group", "workspace_layout": {"version": 1, "root": split(pane("a"), pane("gone"))}}
    result = remap_workspace_config(config, {"a": "new-a"})
    assert result["workspace_layout"]["root"] == pane("new-a")
    assert config["workspace_layout"]["root"]["first"] == pane("a")
    assert remap_workspace_config(config, {})["workspace_layout"]["root"] is None


@pytest.mark.parametrize("tabbed", [False, True])
def test_layout_save_capture_restore_and_old_templates(client, tabbed):
    members = [client.post('/api/nodes', json={"type": "agent", "name": name}).json() for name in ['Left', 'Main', 'Hidden']]
    group = client.post('/api/legion-groups', json={"name": "Window", "node_ids": [n['id'] for n in members]}).json()[0]
    root = (tabs([members[0]['id'], members[1]['id']], members[1]['id']) if tabbed
            else split(pane(members[0]['id']), pane(members[1]['id'])))
    response = client.patch(f"/api/nodes/{group['id']}", json={"config": {"workspace_layout": {"version": 1, "root": root}}})
    assert response.status_code == 200, response.text
    assert client.get(f"/api/nodes/{group['id']}").json()['config']['workspace_layout']['root'] == root
    saved = client.post('/api/legions', json={"name": "Window", "node_ids": [group['id'], *[n['id'] for n in members]]})
    assert saved.status_code == 201, saved.text
    services = client.app.state.services
    record = services.legions.get(saved.json()['id'])
    serialized = record.blueprint.model_dump_json()
    assert all(member['id'] not in serialized for member in members)
    response = client.post(f"/api/legions/{record.id}/instances", json={"position": {"x": 4000, "y": 1000}})
    assert response.status_code == 201, response.text
    copied = response.json()['nodes']
    window = next(n for n in copied if n['type'] == 'legion')
    names = {n['name']: n['id'] for n in copied}
    expected = tabs([names['Left'], names['Main']], names['Main']) if tabbed else split(pane(names['Left']), pane(names['Main']))
    assert window['config']['workspace_layout']['root'] == expected
    assert all(n['parent_id'] == window['id'] for n in copied if n['type'] != 'legion')
    # Blueprints saved before workspace mode keep deploying with no window layout.
    blueprint = record.blueprint.model_dump(mode='json')
    for node in blueprint['nodes']:
        if node['type'] == 'legion':
            del node['config']['workspace_layout']
    with services.world.database.transaction(immediate=True) as connection:
        connection.execute('UPDATE legions SET blueprint_json = ? WHERE id = ?', (json.dumps(blueprint), record.id))
    response = client.post(f"/api/legions/{record.id}/instances", json={})
    assert response.status_code == 201, response.text
    assert next(n for n in response.json()['nodes'] if n['type'] == 'legion')['config']['workspace_layout'] is None


def test_coding_preset_can_define_a_subset_window(client):
    response = client.post('/api/legions/presets/coding/instances', json={})
    assert response.status_code == 201, response.text
    nodes = response.json()['nodes']
    window = next(n for n in nodes if n['type'] == 'legion')
    ids = {n['type']: n['id'] for n in nodes}
    assert window['config']['workspace_layout']['root'] == split(pane(ids['conversation']), pane(ids['sandbox']))
