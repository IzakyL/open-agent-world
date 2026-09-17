import asyncio

import pytest

from backend.agents import MockAgentRuntime, AgentEvent, AgentEventType
from backend.capabilities.provider import WorldAgentCapabilityProvider
from backend.config import Settings
from backend.conversations import ConversationSessionCreate, ConversationPost
from backend.services import create_services
from backend.world.models import CardCreate, EdgeCreate


class StreamingRuntime(MockAgentRuntime):
    async def execute(self, config, context, runtime_input):
        for key, text in [('first', 'Checking'), ('first', 'Checking resources'),
                          ('first', 'Checking resources.'), ('first', 'Checking resources.'),
                          ('second', 'Checking resources.')]:
            yield AgentEvent(context.agent_id, context.run_id, AgentEventType.MESSAGE,
                             {'text': text, 'provider_message_id': key})
        yield AgentEvent(context.agent_id, context.run_id, AgentEventType.COMPLETED, run_status='succeeded')


@pytest.mark.asyncio
async def test_stream_snapshots_share_identity_but_distinct_messages_and_runs_do_not(data_root):
    settings = Settings.for_data_root(data_root)
    services = create_services(settings)
    services.install_runtime_provider('core.mock', StreamingRuntime(WorldAgentCapabilityProvider(services)), default=True)
    try:
        agent = await services.create_card(CardCreate(type='agent', name='Writer'))
        room = await services.create_card(CardCreate(type='conversation', name='Room'))
        await services.create_edge(EdgeCreate(source=agent.id, target=room.id, relationship='participate'))
        session = await services.create_conversation_session(room.id, ConversationSessionCreate(participant_ids=[agent.id]))
        for turn in range(2):
            await services.post_conversation_message(room.id, session.id, ConversationPost(content=f'Start {turn}', mention_agent_ids=[agent.id]))
            for _ in range(200):
                await asyncio.sleep(.01)
                if len(services.conversations.list_messages(room.id, session.id)) == (turn + 1) * 2:
                    break
            timeline = services.conversations.page_messages(room.id, session.id).items
            assert len(timeline) == (turn + 1) * 3
            assert [m.content for m in timeline[-2:]] == ['Checking resources.'] * 2
            assert timeline[-2].id != timeline[-1].id
        assert len({m.id for m in timeline}) == 6
        assert [m.sequence for m in timeline] == list(range(1, 7))
        ids = [m.id for m in timeline]
    finally:
        await services.shutdown()
        services.close()
    restored = create_services(settings)
    try:
        assert [m.id for m in restored.conversations.page_messages(room.id, session.id).items] == ids
    finally:
        restored.close()
