import json

import pytest
from pydantic import ValidationError

from backend.legion_workspace import WorkspaceLayout, remap_workspace_config


def view(card_id, section_id=None):
    return {"card_id": card_id, **({"section_id": section_id} if section_id is not None else {})}


def pane(card_id, section_id=None):
    return {"kind": "pane", "view": view(card_id, section_id)}


def split(first, second):
    return {"kind": "split", "axis": "horizontal", "ratio": .35, "first": first, "second": second}


def tabs(ids, active):
    return {"kind": "tabs", "views": [view(card_id) for card_id in ids], "active_view": view(active)}


def legacy_node(node):
    if node['kind'] == 'pane':
        return {"kind": "pane", "card_id": node['view']['card_id']}
    if node['kind'] == 'tabs':
        return {"kind": "tabs", "card_ids": [item['card_id'] for item in node['views']], "active_card_id": node['active_view']['card_id']}
    return {**node, "first": legacy_node(node['first']), "second": legacy_node(node['second'])}


def test_tab_validation_and_reference_remapping():
    for root in [tabs([], "a"), tabs(["a", "a"], "a"), tabs(["a", "b"], "missing"),
                 split(pane("a"), tabs(["a", "b"], "b"))]:
        with pytest.raises(ValidationError):
            WorkspaceLayout(root=root)
    config = {"workspace_layout": {"version": 2, "root": tabs(["a", "b", "c"], "b")}}
    assert remap_workspace_config(config, {"a": "A", "b": "B", "c": "C"})["workspace_layout"]["root"] == tabs(["A", "B", "C"], "B")
    assert remap_workspace_config(config, {"a": "A", "c": "C"})["workspace_layout"]["root"] == tabs(["A", "C"], "A")
    assert remap_workspace_config(config, {"c": "C"})["workspace_layout"]["root"] == pane("C")
    assert remap_workspace_config(config, {})["workspace_layout"]["root"] is None


def test_workspace_validation_rejects_duplicates_invalid_ratio_and_depth():
    invalid = [split(pane("a"), pane("a")), {**split(pane("a"), pane("b")), "ratio": .01},
               {**split(pane("a"), pane("b")), "axis": "diagonal"}, {**pane("a"), "secret": "x"},
               pane("a", ""), pane("a", "s" * 201), split(pane("a", "files"), pane("a", "files"))]
    deep = pane("0")
    for index in range(17):
        deep = split(pane(str(index + 1)), deep)
    invalid.append(deep)
    for root in invalid:
        with pytest.raises(ValidationError):
            WorkspaceLayout(root=root)


def test_workspace_v1_migration_preserves_arrangement_and_canonicalizes_views():
    root = split(pane("a"), tabs(["b", "c"], "c"))
    legacy = {"version": 1, "root": legacy_node(root)}
    assert WorkspaceLayout.model_validate(legacy).model_dump(mode='json') == {"version": 2, "root": root, "hidden_sections": []}
    assert legacy['version'] == 1
    with pytest.raises(ValidationError):
        WorkspaceLayout.model_validate({"version": 1, "root": legacy_node(tabs(["a", "a"], "a"))})


def test_sections_share_owner_without_sharing_placement_or_hidden_state():
    root = split(pane("a"), {"kind": "tabs", "views": [view("a", "files"), view("b", "files")], "active_view": view("b", "files")})
    config = {"workspace_layout": {"version": 2, "root": root, "hidden_sections": [view("a", "preview"), view("b", "terminal")]}}
    layout = WorkspaceLayout.model_validate(config['workspace_layout'])
    assert layout.model_dump(mode='json') == config['workspace_layout']
    mapped = remap_workspace_config(config, {"a": "new-a", "b": "new-b"})['workspace_layout']
    assert mapped['root']['first'] == pane('new-a')
    assert mapped['root']['second'] == {"kind": "tabs", "views": [view("new-a", "files"), view("new-b", "files")], "active_view": view("new-b", "files")}
    assert mapped['hidden_sections'] == [view('new-a', 'preview'), view('new-b', 'terminal')]
    retained = remap_workspace_config(config, {"a": "new-a"})['workspace_layout']
    assert retained['root'] == split(pane('new-a'), pane('new-a', 'files'))
    assert retained['hidden_sections'] == [view('new-a', 'preview')]
    assert remap_workspace_config(config, {})['workspace_layout'] == {"version": 2, "root": None, "hidden_sections": []}


@pytest.mark.parametrize('hidden', [
    [view('a')], [view('a', '')], [view('a', 'files')], [view('b', 'files'), view('b', 'files')],
])
def test_hidden_sections_require_unique_unplaced_section_references(hidden):
    with pytest.raises(ValidationError):
        WorkspaceLayout(root=pane('a', 'files'), hidden_sections=hidden)


def test_reference_count_includes_hidden_sections():
    root = tabs([str(index) for index in range(100)], '0')
    WorkspaceLayout(root=root)
    with pytest.raises(ValidationError):
        WorkspaceLayout(root=root, hidden_sections=[view('a', 'files')])


def test_workspace_remapping_collapses_missing_references():
    config = {"mode": "group", "workspace_layout": {"version": 1, "root": legacy_node(split(pane("a"), pane("gone")))}}
    result = remap_workspace_config(config, {"a": "new-a"})
    assert result["workspace_layout"]["root"] == pane("new-a")
    assert config["workspace_layout"]["root"]["first"] == legacy_node(pane("a"))
    assert remap_workspace_config(config, {})["workspace_layout"]["root"] is None


@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize("tabbed", [False, True])
def test_layout_save_capture_restore_and_old_templates(client, tabbed, version):
    members = [client.post('/api/nodes', json={"type": "agent", "name": name}).json() for name in ['Left', 'Main', 'Hidden']]
    group = client.post('/api/legion-groups', json={"name": "Window", "node_ids": [n['id'] for n in members]}).json()[0]
    root = (tabs([members[0]['id'], members[1]['id']], members[1]['id']) if tabbed
            else split(pane(members[0]['id']), pane(members[1]['id'])))
    layout = {"version": version, "root": legacy_node(root) if version == 1 else root}
    response = client.patch(f"/api/nodes/{group['id']}", json={"config": {"workspace_layout": layout}})
    assert response.status_code == 200, response.text
    assert client.get(f"/api/nodes/{group['id']}").json()['config']['workspace_layout'] == {"version": 2, "root": root, "hidden_sections": []}
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


def test_section_layout_capture_restores_owner_and_hidden_references(client):
    member = client.post('/api/nodes', json={"type": "sandbox", "name": "Tools"}).json()
    group = client.post('/api/legion-groups', json={"name": "Sections", "node_ids": [member['id']]}).json()[0]
    layout = {"version": 2, "root": split(pane(member['id']), pane(member['id'], 'terminal')), "hidden_sections": [view(member['id'], 'preview')]}
    response = client.patch(f"/api/nodes/{group['id']}", json={"config": {"workspace_layout": layout}})
    assert response.status_code == 200, response.text
    saved = client.post('/api/legions', json={"name": "Sections", "node_ids": [group['id'], member['id']]})
    assert saved.status_code == 201, saved.text
    restored = client.post(f"/api/legions/{saved.json()['id']}/instances", json={})
    assert restored.status_code == 201, restored.text
    nodes = restored.json()['nodes']
    copied_id = next(n['id'] for n in nodes if n['type'] == 'sandbox')
    copied = next(n for n in nodes if n['type'] == 'legion')['config']['workspace_layout']
    assert copied == {"version": 2, "root": split(pane(copied_id), pane(copied_id, 'terminal')), "hidden_sections": [view(copied_id, 'preview')]}


def test_coding_preset_can_define_a_subset_window(client):
    response = client.post('/api/legions/presets/coding/instances', json={})
    assert response.status_code == 201, response.text
    nodes = response.json()['nodes']
    window = next(n for n in nodes if n['type'] == 'legion')
    ids = {n['type']: n['id'] for n in nodes}
    assert window['config']['workspace_layout']['root'] == split(pane(ids['conversation']), pane(ids['sandbox']))
