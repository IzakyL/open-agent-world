import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.agents.media import ToolImage, VisualToolResult, adk_tool_result, codex_tool_content
from backend.capabilities.provider import WorldAgentCapabilityProvider
from backend.errors import ConflictError, PermissionDeniedError, ResourceValidationError, RuntimeUnavailableError
from backend.tests.conftest import create_node
from backend.tests.test_minister import create_minister, invoke, call
from backend.visual_observation import VisualObservers


PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


def test_visual_results_are_images_in_codex_and_keep_bytes_out_of_logs():
    result = VisualToolResult({'source': 'test'}, (ToolImage(PNG, 'image/png'),))
    content = codex_tool_content(result)
    assert content[1] == {'type': 'inputImage', 'imageUrl': 'data:image/png;base64,' + base64.b64encode(PNG).decode()}
    assert 'base64' not in content[0]['text']
    assert codex_tool_content({'message': 'ordinary result'}) == [{'type': 'inputText', 'text': '{"message": "ordinary result"}'}]
    with pytest.raises(ResourceValidationError):
        ToolImage(PNG, 'image/jpeg')
    with pytest.raises(ResourceValidationError):
        ToolImage(b'invalid image', 'image/png')


@pytest.mark.asyncio
async def test_adk_and_litellm_preserve_visual_tool_results():
    pytest.importorskip('google.adk')
    pytest.importorskip('litellm')
    from google.genai import types
    from google.adk.flows.llm_flows.functions import _extract_multimodal_parts
    from google.adk.models.lite_llm import _content_to_message_param
    result = VisualToolResult({'source': 'capture'}, (ToolImage(PNG, 'image/png'),))
    metadata, parts = _extract_multimodal_parts(adk_tool_result(result))
    assert parts[0].inline_data.data == PNG
    response = types.Part.from_function_response(name='canvas_observe', response=metadata, parts=parts)
    response.function_response.id = 'call-1'
    # Gemini receives native binary FunctionResponse parts. The actual ADK
    # LiteLLM translator must also produce a visual user message, not JSON bytes.
    messages = await _content_to_message_param(types.Content(role='user', parts=[response]), provider='openai')
    assert messages[0]['role'] == 'tool' and messages[0]['tool_call_id'] == 'call-1'
    assert messages[1]['role'] == 'user'
    assert messages[1]['content'][0]['type'] == 'image_url'
    assert messages[1]['content'][0]['image_url']['url'].startswith('data:image/png;base64,')
    assert 'base64' not in messages[0]['content']


def test_observation_requires_a_minister_and_connected_renderer(client):
    agent = create_node(client, 'agent')
    with pytest.raises(PermissionDeniedError):
        invoke(client, agent, 'observe')
    minister = create_minister(client, config={'allow_canvas_edits': False})
    with pytest.raises(RuntimeUnavailableError, match='Open the OAW canvas'):
        invoke(client, minister, 'observe')


def test_scoped_capture_and_revocation_while_waiting(client):
    minister = create_minister(client)
    card = create_node(client, 'text', position={'x': 120, 'y': 120}, size={'width': 96, 'height': 96})
    create_node(client, 'text', name='outside', position={'x': 9000, 'y': 9000})
    services = client.app.state.services
    with client.websocket_connect('/ws/visual') as ws, ThreadPoolExecutor() as pool:
        pending = pool.submit(invoke, client, minister, 'observe')
        request = ws.receive_json()
        assert {item['id'] for item in request['cards']} == {minister['id'], card['id']}
        assert request['content_ids'] == []
        assert 'outside' not in str(request)
        ws.send_json({'request_id': request['request_id'], 'data_base64': base64.b64encode(PNG).decode(), 'captured_ids': [card['id']]})
        result = pending.result(timeout=5)
        assert isinstance(result, VisualToolResult) and result.images[0].data == PNG
        assert result.metadata['captured_ids'] == [card['id']]
        pending = pool.submit(invoke, client, minister, 'observe')
        request = ws.receive_json()
        # This must complete while capture is pending: no global mutation lock.
        assert client.patch(f"/api/nodes/{minister['id']}", json={'minister': None}).status_code == 200
        ws.send_json({'request_id': request['request_id'], 'data_base64': base64.b64encode(PNG).decode(), 'captured_ids': [card['id']]})
        with pytest.raises(PermissionDeniedError):
            pending.result(timeout=5)


def test_geometry_change_discards_stale_pixels(client):
    minister = create_minister(client)
    with client.websocket_connect('/ws/visual') as ws, ThreadPoolExecutor() as pool:
        pending = pool.submit(invoke, client, minister, 'observe')
        request = ws.receive_json()
        client.patch(f"/api/nodes/{minister['id']}", json={'minister': {'control_radius': 300}})
        ws.send_json({'request_id': request['request_id'], 'data_base64': base64.b64encode(PNG).decode(), 'captured_ids': []})
        with pytest.raises(ConflictError):
            pending.result(timeout=5)


@pytest.mark.asyncio
async def test_capture_timeout_cleans_pending_requests():
    observers = VisualObservers()
    peer = {'queue': asyncio.Queue(), 'pending': {}}
    observers.peers['test'] = peer
    with pytest.raises(RuntimeUnavailableError, match='timed out'):
        await observers.capture({}, timeout=.01)
    assert peer['pending'] == {}


def test_regular_agent_views_real_image_and_revocation_still_applies(client):
    agent = create_node(client, 'agent')
    image = create_node(client, 'image', media_type='image/png', data_base64=base64.b64encode(PNG).decode())
    edge = client.post('/api/edges', json={'source': agent['id'], 'target': image['id'], 'relationship': 'view'})
    assert edge.status_code == 201, edge.text
    provider = WorldAgentCapabilityProvider(client.app.state.services)
    result = call(client, provider.invoke_tool, agent['id'], f"image.view:{image['id']}", {})
    assert result.images[0].data == PNG
    assert 'data_base64' not in result.metadata
    client.delete('/api/edges/' + edge.json()['id'])
    with pytest.raises(PermissionDeniedError):
        call(client, provider.invoke_tool, agent['id'], f"image.view:{image['id']}", {})
